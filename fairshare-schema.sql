-- ============================================================
-- FairShare Group Currency Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. PROFILES
-- Linked to Supabase auth.users via id. 
-- public_key is nullable now, reserved for future self-custodial auth.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  public_key text,  -- future: self-custodial identity
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Anyone can read profiles (needed to display member names)
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

-- Users can insert their own profile
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 2. GROUPS
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  currency_name text not null,
  currency_symbol text not null default '$',
  fee_rate numeric not null default 0,        -- current voted fee rate (0-1)
  daily_income numeric not null default 0,    -- current voted daily income amount
  constitution text,                          -- group constitution with tagged variables
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.groups enable row level security;

-- Anyone can read groups (needed to browse/join)
create policy "Groups are viewable by everyone"
  on public.groups for select
  using (true);

-- Any authenticated user can create a group
create policy "Authenticated users can create groups"
  on public.groups for insert
  with check (auth.uid() = created_by);

-- Only the creator can update group settings (fee_rate, daily_income updated by tally function)
create policy "Group creator or tally can update group"
  on public.groups for update
  using (auth.uid() = created_by);


-- 3. MEMBERS
create table public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'removed')),
  balance numeric not null default 0,
  joined_at timestamptz default now(),
  last_income_at timestamptz,              -- last time daily income was claimed (NULL = never)
  unique(group_id, user_id)
);

alter table public.members enable row level security;

-- Helper function to check group membership (SECURITY DEFINER avoids RLS recursion)
create or replace function public.is_group_member(p_group_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.members
    where group_id = p_group_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$ language sql security definer stable;

-- Members can view their own memberships + members of groups they belong to
create policy "Group members can view members"
  on public.members for select
  using (
    user_id = auth.uid()
    or public.is_group_member(group_id)
  );

-- Users can join groups: as 'pending' for any group, or 'active' if they created the group
create policy "Users can request to join groups"
  on public.members for insert
  with check (
    auth.uid() = user_id
    and (
      status = 'pending'
      or (status = 'active' and exists (
        select 1 from public.groups
        where id = members.group_id and created_by = auth.uid()
      ))
    )
  );

-- Members can update (for balance changes via functions, status changes)
-- In practice, balance updates will go through server functions
create policy "System can update members"
  on public.members for update
  using (public.is_group_member(group_id));


-- 4. ENDORSEMENTS
create table public.endorsements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  endorser_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique(group_id, candidate_id, endorser_id)
);

alter table public.endorsements enable row level security;

-- Active members can view endorsements in their group
create policy "Group members can view endorsements"
  on public.endorsements for select
  using (public.is_group_member(group_id));

-- Active members can endorse candidates
create policy "Active members can endorse"
  on public.endorsements for insert
  with check (
    auth.uid() = endorser_id
    and public.is_group_member(group_id)
  );

-- Members can remove their own endorsements
create policy "Members can unendorse"
  on public.endorsements for delete
  using (auth.uid() = endorser_id);


-- 5. TRANSACTIONS
-- from_user is nullable: NULL means currency was minted (e.g. daily income)
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user uuid references public.profiles(id),       -- NULL = minted / daily income
  to_user uuid not null references public.profiles(id),
  amount numeric not null check (amount > 0),
  fee numeric not null default 0,
  memo text,
  created_at timestamptz default now()
);

alter table public.transactions enable row level security;

-- Members can view transactions in their group
create policy "Group members can view transactions"
  on public.transactions for select
  using (public.is_group_member(group_id));

-- Transactions are created via the send_currency function, not direct insert
-- But we allow insert for the function (runs as security definer)
create policy "Sender can create transactions"
  on public.transactions for insert
  with check (auth.uid() = from_user);


-- 6. VOTES
create table public.votes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  vote_type text not null check (vote_type in ('fee_rate', 'daily_income')),
  value numeric not null check (value >= 0),
  created_at timestamptz default now(),
  unique(group_id, user_id, vote_type)  -- one vote per type per member
);

alter table public.votes enable row level security;

-- Members can view votes in their group
create policy "Group members can view votes"
  on public.votes for select
  using (public.is_group_member(group_id));

-- Active members can cast votes
create policy "Active members can vote"
  on public.votes for insert
  with check (
    auth.uid() = user_id
    and public.is_group_member(group_id)
  );

-- Members can update their own votes
create policy "Members can update own votes"
  on public.votes for update
  using (auth.uid() = user_id);

-- Members can delete their own votes
create policy "Members can delete own votes"
  on public.votes for delete
  using (auth.uid() = user_id);


-- 7. SPONSORSHIPS (invite-only membership)
create table public.sponsorships (
  id uuid primary key default gen_random_uuid(),
  token text unique not null default encode(gen_random_bytes(16), 'hex'),
  group_id uuid not null references public.groups(id) on delete cascade,
  sponsor_id uuid not null references public.profiles(id),
  message text,                       -- sponsor's description of the candidate
  candidate_id uuid references public.profiles(id),  -- filled when claimed
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'expired', 'revoked')),
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days')
);

alter table public.sponsorships enable row level security;

-- Sponsors can see their own sponsorships; group members can see group sponsorships
create policy "Sponsors and group members can view sponsorships"
  on public.sponsorships for select
  using (
    sponsor_id = auth.uid()
    or public.is_group_member(group_id)
  );

-- Active group members can create sponsorships
create policy "Active members can sponsor"
  on public.sponsorships for insert
  with check (
    auth.uid() = sponsor_id
    and public.is_group_member(group_id)
  );

-- Sponsors can revoke their own pending sponsorships
create policy "Sponsors can update own sponsorships"
  on public.sponsorships for update
  using (auth.uid() = sponsor_id and status = 'pending');


-- 8. AMENDMENTS (constitution changes)
create table public.amendments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  proposed_by uuid not null references public.profiles(id),
  title text not null,            -- short summary, e.g. "Rename group to XYZ"
  old_text text not null,         -- constitution at time of proposal
  new_text text not null,         -- proposed new constitution
  status text not null default 'voting'
    check (status in ('voting', 'passed', 'failed', 'withdrawn')),
  threshold numeric not null,     -- snapshot of $AMENDMENT_PERCENTAGE at proposal time (0-1)
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days'),
  resolved_at timestamptz
);

alter table public.amendments enable row level security;

-- Group members can view amendments
create policy "Group members can view amendments"
  on public.amendments for select
  using (public.is_group_member(group_id));

-- Active members can propose amendments
create policy "Active members can propose amendments"
  on public.amendments for insert
  with check (
    auth.uid() = proposed_by
    and public.is_group_member(group_id)
  );

-- Proposers can withdraw their own voting amendments
create policy "Proposers can withdraw amendments"
  on public.amendments for update
  using (auth.uid() = proposed_by and status = 'voting')
  with check (true);


-- 9. AMENDMENT VOTES
create table public.amendment_votes (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.amendments(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  vote boolean not null,          -- true = approve, false = reject
  created_at timestamptz default now(),
  unique(amendment_id, user_id)
);

alter table public.amendment_votes enable row level security;

-- Group members can view amendment votes (join through amendments to get group_id)
create policy "Members can view amendment votes"
  on public.amendment_votes for select
  using (
    exists (
      select 1 from public.amendments a
      where a.id = amendment_votes.amendment_id
        and public.is_group_member(a.group_id)
    )
  );

-- Active group members can cast a vote on an amendment
create policy "Active members can vote on amendments"
  on public.amendment_votes for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.amendments a
      where a.id = amendment_votes.amendment_id
        and a.status = 'voting'
        and public.is_group_member(a.group_id)
    )
  );

-- Members can change their vote
create policy "Members can update own amendment votes"
  on public.amendment_votes for update
  using (auth.uid() = user_id);

-- Members can remove their vote
create policy "Members can delete own amendment votes"
  on public.amendment_votes for delete
  using (auth.uid() = user_id);


-- 10. GROUP EVENTS (activity log + realtime notifications)
create table public.group_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  event_type text not null,
  summary text not null,
  actor_id uuid references public.profiles(id),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

alter table public.group_events enable row level security;

-- Group members can read events
create policy "Group members can view events"
  on public.group_events for select
  using (public.is_group_member(group_id));

-- Events are inserted by SECURITY DEFINER functions, but allow client insert
-- for amendment_proposed (logged client-side via RPC)
create policy "Active members can log events"
  on public.group_events for insert
  with check (
    auth.uid() = actor_id
    and public.is_group_member(group_id)
  );


-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Look up a sponsorship by its token (bypasses RLS for invite landing page)
-- Returns sponsor name, group name, message -- safe public info only
create or replace function public.get_sponsorship_by_token(p_token text)
returns json as $$
declare
  v_record record;
begin
  select
    s.id,
    s.token,
    s.group_id,
    s.status,
    s.message,
    s.expires_at,
    p.display_name as sponsor_name,
    g.name as group_name,
    g.currency_name,
    g.currency_symbol
  into v_record
  from public.sponsorships s
  join public.profiles p on p.id = s.sponsor_id
  join public.groups g on g.id = s.group_id
  where s.token = p_token;

  if not found then
    return json_build_object('error', 'Invitation not found');
  end if;

  if v_record.status != 'pending' then
    return json_build_object('error', 'This invitation has already been used');
  end if;

  if v_record.expires_at < now() then
    return json_build_object('error', 'This invitation has expired');
  end if;

  return json_build_object(
    'id', v_record.id,
    'group_id', v_record.group_id,
    'sponsor_name', v_record.sponsor_name,
    'group_name', v_record.group_name,
    'currency_name', v_record.currency_name,
    'currency_symbol', v_record.currency_symbol,
    'message', v_record.message
  );
end;
$$ language plpgsql security definer;


-- Claim a sponsorship: validate token, create pending member, auto-endorse from sponsor
create or replace function public.claim_sponsorship(p_token text)
returns json as $$
declare
  v_user_id uuid := auth.uid();
  v_sponsorship record;
begin
  if v_user_id is null then
    raise exception 'You must be logged in to claim a sponsorship';
  end if;

  -- Lock the row to prevent double-claim
  select * into v_sponsorship
  from public.sponsorships
  where token = p_token
  for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if v_sponsorship.status != 'pending' then
    raise exception 'This invitation has already been used';
  end if;

  if v_sponsorship.expires_at < now() then
    -- Mark as expired
    update public.sponsorships set status = 'expired' where id = v_sponsorship.id;
    raise exception 'This invitation has expired';
  end if;

  -- Check user isn't already a member (active or pending)
  if exists (
    select 1 from public.members
    where group_id = v_sponsorship.group_id
      and user_id = v_user_id
      and status in ('active', 'pending')
  ) then
    raise exception 'You are already a member or pending candidate of this group';
  end if;

  -- Mark sponsorship as claimed
  update public.sponsorships
  set candidate_id = v_user_id, status = 'claimed'
  where id = v_sponsorship.id;

  -- Create pending membership
  insert into public.members (group_id, user_id, status, balance)
  values (v_sponsorship.group_id, v_user_id, 'pending', 0);

  -- Log member_sponsored event
  insert into public.group_events (group_id, event_type, summary, actor_id, metadata)
  values (
    v_sponsorship.group_id,
    'member_sponsored',
    'New candidate '
      || (select display_name from public.profiles where id = v_user_id)
      || ', sponsored by '
      || (select display_name from public.profiles where id = v_sponsorship.sponsor_id),
    v_sponsorship.sponsor_id,
    json_build_object('sponsor_id', v_sponsorship.sponsor_id, 'candidate_id', v_user_id)::jsonb
  );

  -- Auto-endorse from the sponsor
  insert into public.endorsements (group_id, candidate_id, endorser_id)
  values (v_sponsorship.group_id, v_user_id, v_sponsorship.sponsor_id);

  -- Immediately check if this endorsement meets the threshold
  perform public.check_endorsements(v_sponsorship.group_id, v_user_id);

  -- Return result; check if candidate was admitted
  return json_build_object(
    'success', true,
    'group_id', v_sponsorship.group_id,
    'group_name', (select name from public.groups where id = v_sponsorship.group_id),
    'admitted', (select status = 'active' from public.members
                 where group_id = v_sponsorship.group_id and user_id = v_user_id)
  );
end;
$$ language plpgsql security definer;

-- Send currency from one member to another within a group
create or replace function public.send_currency(
  p_group_id uuid,
  p_to_user uuid,
  p_amount numeric,
  p_memo text default null
)
returns json as $$
declare
  v_from_user uuid := auth.uid();
  v_fee_rate numeric;
  v_fee numeric;
  v_net numeric;
  v_sender_balance numeric;
begin
  -- Get the group's fee rate
  select fee_rate into v_fee_rate from public.groups where id = p_group_id;
  if not found then
    raise exception 'Group not found';
  end if;

  -- Calculate fee
  v_fee := p_amount * v_fee_rate;
  v_net := p_amount - v_fee;

  -- Check sender is active member with sufficient balance
  select balance into v_sender_balance
  from public.members
  where group_id = p_group_id and user_id = v_from_user and status = 'active';

  if not found then
    raise exception 'You are not an active member of this group';
  end if;

  if v_sender_balance < p_amount then
    raise exception 'Insufficient balance';
  end if;

  -- Check recipient is active member
  if not exists (
    select 1 from public.members
    where group_id = p_group_id and user_id = p_to_user and status = 'active'
  ) then
    raise exception 'Recipient is not an active member of this group';
  end if;

  -- Deduct from sender
  update public.members
  set balance = balance - p_amount
  where group_id = p_group_id and user_id = v_from_user;

  -- Add net amount to recipient
  update public.members
  set balance = balance + v_net
  where group_id = p_group_id and user_id = p_to_user;

  -- The fee is destroyed (reduces money supply) -- or could go to a group fund
  -- For now, fee simply disappears from circulation

  -- Record the transaction
  insert into public.transactions (group_id, from_user, to_user, amount, fee, memo)
  values (p_group_id, v_from_user, p_to_user, p_amount, v_fee, p_memo);

  -- Log event so the recipient gets a realtime notification
  insert into public.group_events (group_id, event_type, summary, actor_id, metadata)
  values (
    p_group_id,
    'payment_received',
    (select display_name from public.profiles where id = v_from_user)
      || ' sent '
      || (select currency_symbol from public.groups where id = p_group_id)
      || ' ' || round(v_net, 2) || ' to '
      || (select display_name from public.profiles where id = p_to_user),
    v_from_user,
    json_build_object('from_user', v_from_user, 'to_user', p_to_user,
      'amount', p_amount, 'fee', v_fee, 'net', v_net)::jsonb
  );

  return json_build_object(
    'success', true,
    'amount', p_amount,
    'fee', v_fee,
    'net', v_net
  );
end;
$$ language plpgsql security definer;


-- Check endorsements and admit candidate if threshold met
-- Reads $NEW_MEMBER_PERCENTAGE from group constitution (default 100%)
create or replace function public.check_endorsements(
  p_group_id uuid,
  p_candidate_id uuid
)
returns json as $$
declare
  v_active_count int;
  v_endorsement_count int;
  v_threshold int;
  v_constitution text;
  v_pct_match text[];
  v_pct numeric;
  v_sponsor_name text;
begin
  -- Count active members
  select count(*) into v_active_count
  from public.members
  where group_id = p_group_id and status = 'active';

  -- Count endorsements for this candidate
  select count(*) into v_endorsement_count
  from public.endorsements
  where group_id = p_group_id and candidate_id = p_candidate_id;

  -- Read threshold from constitution ($NEW_MEMBER_PERCENTAGE), default 100%
  select constitution into v_constitution
  from public.groups
  where id = p_group_id;

  v_pct := 1.0; -- default 100%
  if v_constitution is not null then
    v_pct_match := regexp_match(v_constitution, ':\s*(\d+)%\s*members?\s*\$NEW_MEMBER_PERCENTAGE');
    if v_pct_match is not null then
      v_pct := v_pct_match[1]::numeric / 100.0;
    end if;
  end if;

  v_threshold := greatest(1, ceil(v_active_count * v_pct));

  if v_endorsement_count >= v_threshold then
    -- Admit the candidate
    update public.members
    set status = 'active', joined_at = now()
    where group_id = p_group_id and user_id = p_candidate_id and status = 'pending';

    -- Clean up endorsements
    delete from public.endorsements
    where group_id = p_group_id and candidate_id = p_candidate_id;

    -- Look up the sponsor's name
    select p.display_name into v_sponsor_name
    from public.sponsorships s
    join public.profiles p on p.id = s.sponsor_id
    where s.group_id = p_group_id
      and s.candidate_id = p_candidate_id
      and s.status = 'claimed'
    limit 1;

    -- Log member_joined event
    insert into public.group_events (group_id, event_type, summary, actor_id, metadata)
    values (
      p_group_id,
      'member_joined',
      'New member '
        || (select display_name from public.profiles where id = p_candidate_id)
        || ' accepted'
        || case when v_sponsor_name is not null then ', sponsored by ' || v_sponsor_name else '' end,
      p_candidate_id,
      json_build_object('user_id', p_candidate_id)::jsonb
    );

    return json_build_object(
      'admitted', true,
      'endorsements', v_endorsement_count,
      'threshold', v_threshold
    );
  end if;

  return json_build_object(
    'admitted', false,
    'endorsements', v_endorsement_count,
    'threshold', v_threshold
  );
end;
$$ language plpgsql security definer;


-- Compute tally (median) of votes and update group settings
-- Reads $CHANGE_CURRENCY_RATES_PERCENTAGE from constitution (default 66%)
-- Only applies the change when enough active members have voted
create or replace function public.compute_tally(
  p_group_id uuid,
  p_vote_type text
)
returns json as $$
declare
  v_median numeric;
  v_vote_count int;
  v_active_count int;
  v_constitution text;
  v_pct_match text[];
  v_pct numeric;
  v_threshold int;
  v_applied boolean := false;
begin
  -- Count votes for this type
  select count(*) into v_vote_count
  from public.votes
  where group_id = p_group_id and vote_type = p_vote_type;

  if v_vote_count = 0 then
    return json_build_object('median', 0, 'vote_count', 0, 'applied', false, 'reason', 'No votes cast');
  end if;

  -- Count active members
  select count(*) into v_active_count
  from public.members
  where group_id = p_group_id and status = 'active';

  -- Read threshold from constitution ($CHANGE_CURRENCY_RATES_PERCENTAGE), default 66%
  select constitution into v_constitution
  from public.groups
  where id = p_group_id;

  v_pct := 0.66; -- default 66%
  if v_constitution is not null then
    v_pct_match := regexp_match(v_constitution, ':\s*(\d+)%\s*members?\s*\$CHANGE_CURRENCY_RATES_PERCENTAGE');
    if v_pct_match is not null then
      v_pct := v_pct_match[1]::numeric / 100.0;
    end if;
  end if;

  v_threshold := greatest(1, ceil(v_active_count * v_pct));

  -- Only apply if enough members have voted
  if v_vote_count >= v_threshold then
    -- Compute median
    select percentile_cont(0.5) within group (order by value)
    into v_median
    from public.votes
    where group_id = p_group_id and vote_type = p_vote_type;

    -- Update the group setting
    if p_vote_type = 'fee_rate' then
      update public.groups set fee_rate = v_median where id = p_group_id;
    elsif p_vote_type = 'daily_income' then
      update public.groups set daily_income = v_median where id = p_group_id;
    end if;

    -- Clear all votes for this type so a fresh round is needed
    delete from public.votes
    where group_id = p_group_id and vote_type = p_vote_type;

    -- Log the rate change event
    insert into public.group_events (group_id, event_type, summary, metadata)
    values (
      p_group_id,
      'rate_change',
      case p_vote_type
        when 'fee_rate' then 'Fee rate changed to ' || round(v_median * 100, 1) || '%'
        when 'daily_income' then 'Daily income changed to ' || round(v_median, 2)
        else 'Rate changed'
      end,
      json_build_object('vote_type', p_vote_type, 'new_value', v_median, 'vote_count', v_vote_count)::jsonb
    );

    v_applied := true;
  else
    -- Still compute median for display, but don't apply
    select percentile_cont(0.5) within group (order by value)
    into v_median
    from public.votes
    where group_id = p_group_id and vote_type = p_vote_type;
  end if;

  return json_build_object(
    'median', v_median,
    'vote_count', v_vote_count,
    'active_members', v_active_count,
    'threshold', v_threshold,
    'applied', v_applied
  );
end;
$$ language plpgsql security definer;


-- Claim daily income for the calling user in a group
-- Only succeeds if 24+ hours since last claim (or never claimed)
create or replace function public.claim_daily_income(p_group_id uuid)
returns json as $$
declare
  v_user_id uuid := auth.uid();
  v_daily_income numeric;
  v_last_income timestamptz;
  v_balance numeric;
begin
  -- Get the group's daily income setting
  select daily_income into v_daily_income
  from public.groups where id = p_group_id;

  if v_daily_income is null or v_daily_income <= 0 then
    return json_build_object('claimed', false, 'reason', 'No daily income set for this group');
  end if;

  -- Get the member's last income timestamp and current balance
  select last_income_at, balance into v_last_income, v_balance
  from public.members
  where group_id = p_group_id and user_id = v_user_id and status = 'active';

  if not found then
    return json_build_object('claimed', false, 'reason', 'Not an active member');
  end if;

  -- Check if 24 hours have passed since last claim
  if v_last_income is not null and v_last_income > now() - interval '24 hours' then
    return json_build_object('claimed', false, 'reason', 'Too soon',
      'next_claim_at', v_last_income + interval '24 hours');
  end if;

  -- Update balance and last_income_at
  update public.members
  set balance = balance + v_daily_income,
      last_income_at = now()
  where group_id = p_group_id and user_id = v_user_id and status = 'active';

  -- Record the minting transaction (from_user = NULL means minted)
  insert into public.transactions (group_id, from_user, to_user, amount, fee, memo)
  values (p_group_id, null, v_user_id, v_daily_income, 0, 'Daily income');

  return json_build_object(
    'claimed', true,
    'amount', v_daily_income,
    'new_balance', v_balance + v_daily_income
  );
end;
$$ language plpgsql security definer;


-- Resolve an amendment: either early (threshold already met) or after voting expires
-- Counts approvals vs active members, applies if threshold met
create or replace function public.resolve_amendment(p_amendment_id uuid)
returns json as $$
declare
  v_amendment record;
  v_active_count int;
  v_approve_count int;
  v_ratio numeric;
  v_passed boolean;
  v_line text;
  v_tag text;
  v_value text;
  v_parts text[];
begin
  -- Fetch the amendment
  select * into v_amendment
  from public.amendments
  where id = p_amendment_id
  for update;

  if not found then
    raise exception 'Amendment not found';
  end if;

  if v_amendment.status != 'voting' then
    raise exception 'Amendment is not in voting status';
  end if;

  -- Verify caller is an active member of this group
  if not public.is_group_member(v_amendment.group_id) then
    raise exception 'You are not an active member of this group';
  end if;

  -- Count active members
  select count(*) into v_active_count
  from public.members
  where group_id = v_amendment.group_id and status = 'active';

  -- Count approval votes
  select count(*) into v_approve_count
  from public.amendment_votes
  where amendment_id = p_amendment_id and vote = true;

  -- Calculate ratio
  if v_active_count = 0 then
    v_ratio := 0;
  else
    v_ratio := v_approve_count::numeric / v_active_count::numeric;
  end if;

  v_passed := v_ratio >= v_amendment.threshold;

  -- If threshold not met and voting hasn't expired, don't resolve yet
  if not v_passed and v_amendment.expires_at > now() then
    return json_build_object(
      'resolved', false,
      'approve_count', v_approve_count,
      'active_members', v_active_count,
      'ratio', round(v_ratio * 100, 1),
      'threshold', round(v_amendment.threshold * 100, 1)
    );
  end if;

  if v_passed then
    -- Update the constitution
    update public.groups
    set constitution = v_amendment.new_text
    where id = v_amendment.group_id;

    -- Parse tagged variables from new_text and apply changes
    -- Format: each line may end with $TAG_NAME
    -- The value is everything between the colon and the tag
    foreach v_line in array string_to_array(v_amendment.new_text, E'\n')
    loop
      -- Match lines ending with $IDENTIFIER
      if v_line ~ '\$[A-Z_]+\s*$' then
        -- Extract the tag name (last $WORD on the line)
        v_tag := (regexp_match(v_line, '\$([A-Z_]+)\s*$'))[1];
        -- Extract the value: everything after first colon, before the $TAG
        v_parts := regexp_match(v_line, ':\s*(.*?)\s*\$[A-Z_]+\s*$');
        if v_parts is not null then
          v_value := v_parts[1];

          -- Apply known tags
          case v_tag
            when 'GROUP_NAME' then
              update public.groups set name = v_value where id = v_amendment.group_id;
            when 'CURRENCY_NAME' then
              update public.groups set currency_name = v_value where id = v_amendment.group_id;
            when 'CURRENCY_SYMBOL' then
              update public.groups set currency_symbol = v_value where id = v_amendment.group_id;
            -- AMENDMENT_PERCENTAGE, NEW_MEMBER_PERCENTAGE, and
            -- CHANGE_CURRENCY_RATES_PERCENTAGE are read from constitution text
            -- at runtime, no separate column to update
            -- Future tags can be added here:
            else
              null; -- Unknown tag, ignore
          end case;
        end if;
      end if;
    end loop;

    -- Mark as passed
    update public.amendments
    set status = 'passed', resolved_at = now()
    where id = p_amendment_id;

    -- Log amendment_passed event
    insert into public.group_events (group_id, event_type, summary, actor_id, metadata)
    values (
      v_amendment.group_id,
      'amendment_passed',
      'Amendment passed: ' || v_amendment.title,
      v_amendment.proposed_by,
      json_build_object('amendment_id', p_amendment_id, 'title', v_amendment.title,
        'approve_count', v_approve_count, 'active_members', v_active_count)::jsonb
    );
  else
    -- Mark as failed
    update public.amendments
    set status = 'failed', resolved_at = now()
    where id = p_amendment_id;

    -- Log amendment_failed event
    insert into public.group_events (group_id, event_type, summary, actor_id, metadata)
    values (
      v_amendment.group_id,
      'amendment_failed',
      'Amendment failed: ' || v_amendment.title,
      v_amendment.proposed_by,
      json_build_object('amendment_id', p_amendment_id, 'title', v_amendment.title,
        'approve_count', v_approve_count, 'active_members', v_active_count)::jsonb
    );
  end if;

  return json_build_object(
    'passed', v_passed,
    'approve_count', v_approve_count,
    'active_members', v_active_count,
    'ratio', round(v_ratio * 100, 1),
    'threshold', round(v_amendment.threshold * 100, 1)
  );
end;
$$ language plpgsql security definer;


-- Log a group event from the client (for events not triggered by DEFINER functions)
create or replace function public.log_group_event(
  p_group_id uuid,
  p_event_type text,
  p_summary text,
  p_metadata jsonb default '{}'
)
returns void as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'You are not an active member of this group';
  end if;

  insert into public.group_events (group_id, event_type, summary, actor_id, metadata)
  values (p_group_id, p_event_type, p_summary, auth.uid(), p_metadata);
end;
$$ language plpgsql security definer;
