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
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user uuid not null references public.profiles(id),
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

  -- Auto-endorse from the sponsor
  insert into public.endorsements (group_id, candidate_id, endorser_id)
  values (v_sponsorship.group_id, v_user_id, v_sponsorship.sponsor_id);

  return json_build_object(
    'success', true,
    'group_id', v_sponsorship.group_id,
    'group_name', (select name from public.groups where id = v_sponsorship.group_id)
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

  return json_build_object(
    'success', true,
    'amount', p_amount,
    'fee', v_fee,
    'net', v_net
  );
end;
$$ language plpgsql security definer;


-- Check endorsements and admit candidate if threshold met
create or replace function public.check_endorsements(
  p_group_id uuid,
  p_candidate_id uuid
)
returns json as $$
declare
  v_active_count int;
  v_endorsement_count int;
  v_threshold int;
begin
  -- Count active members
  select count(*) into v_active_count
  from public.members
  where group_id = p_group_id and status = 'active';

  -- Count endorsements for this candidate
  select count(*) into v_endorsement_count
  from public.endorsements
  where group_id = p_group_id and candidate_id = p_candidate_id;

  -- Threshold: >50% of active members
  v_threshold := (v_active_count / 2) + 1;

  if v_endorsement_count >= v_threshold then
    -- Admit the candidate
    update public.members
    set status = 'active', joined_at = now()
    where group_id = p_group_id and user_id = p_candidate_id and status = 'pending';

    -- Clean up endorsements
    delete from public.endorsements
    where group_id = p_group_id and candidate_id = p_candidate_id;

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
create or replace function public.compute_tally(
  p_group_id uuid,
  p_vote_type text
)
returns json as $$
declare
  v_median numeric;
  v_count int;
begin
  -- Get vote count
  select count(*) into v_count
  from public.votes
  where group_id = p_group_id and vote_type = p_vote_type;

  if v_count = 0 then
    return json_build_object('median', 0, 'vote_count', 0);
  end if;

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

  return json_build_object('median', v_median, 'vote_count', v_count);
end;
$$ language plpgsql security definer;


-- Distribute daily income to all active members of a group
create or replace function public.distribute_daily_income(
  p_group_id uuid
)
returns json as $$
declare
  v_daily_income numeric;
  v_member_count int;
begin
  select daily_income into v_daily_income
  from public.groups where id = p_group_id;

  if v_daily_income <= 0 then
    return json_build_object('distributed', false, 'reason', 'No daily income set');
  end if;

  -- Add daily income to all active members (new currency is minted)
  update public.members
  set balance = balance + v_daily_income
  where group_id = p_group_id and status = 'active';

  select count(*) into v_member_count
  from public.members
  where group_id = p_group_id and status = 'active';

  return json_build_object(
    'distributed', true,
    'amount_per_member', v_daily_income,
    'member_count', v_member_count,
    'total_minted', v_daily_income * v_member_count
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
            -- AMENDMENT_PERCENTAGE is read from constitution text at proposal time,
            -- no separate column to update
            -- Future tags can be added here:
            -- when 'ENDORSEMENT_THRESHOLD' then ...
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
  else
    -- Mark as failed
    update public.amendments
    set status = 'failed', resolved_at = now()
    where id = p_amendment_id;
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
