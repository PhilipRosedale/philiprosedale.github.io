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

-- Members of a group can see all members in that group
create policy "Group members can view members"
  on public.members for select
  using (
    exists (
      select 1 from public.members m
      where m.group_id = members.group_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
    or members.user_id = auth.uid()  -- can always see own memberships
  );

-- Authenticated users can request to join (insert with status='pending')
create policy "Users can request to join groups"
  on public.members for insert
  with check (auth.uid() = user_id and status = 'pending');

-- Members can update (for balance changes via functions, status changes)
-- In practice, balance updates will go through server functions
create policy "System can update members"
  on public.members for update
  using (
    exists (
      select 1 from public.members m
      where m.group_id = members.group_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );


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
  using (
    exists (
      select 1 from public.members m
      where m.group_id = endorsements.group_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- Active members can endorse candidates
create policy "Active members can endorse"
  on public.endorsements for insert
  with check (
    auth.uid() = endorser_id
    and exists (
      select 1 from public.members m
      where m.group_id = endorsements.group_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
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
  using (
    exists (
      select 1 from public.members m
      where m.group_id = transactions.group_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

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
  using (
    exists (
      select 1 from public.members m
      where m.group_id = votes.group_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- Active members can cast votes
create policy "Active members can vote"
  on public.votes for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.members m
      where m.group_id = votes.group_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- Members can update their own votes
create policy "Members can update own votes"
  on public.votes for update
  using (auth.uid() = user_id);

-- Members can delete their own votes
create policy "Members can delete own votes"
  on public.votes for delete
  using (auth.uid() = user_id);


-- ============================================================
-- FUNCTIONS
-- ============================================================

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
