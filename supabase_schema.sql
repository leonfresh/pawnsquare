-- Create a table for user profiles
create table if not exists profiles (
  id uuid references auth.users not null primary key,
  coins int not null default 0,
  -- Legacy: array of strings (historically mixed avatar URLs + item ids).
  owned_avatars jsonb not null default '[]'::jsonb,
  -- New: array of stable item ids (recommended going forward).
  owned_items jsonb not null default '[]'::jsonb,
  processed_sessions jsonb not null default '[]'::jsonb,
  equipped_avatar_url text,
  equipped_theme text,
  equipped_chess_set text,
  equipped_chess_board text
);

-- MIGRATIONS: ensure new columns exist even if the table already existed.
alter table profiles add column if not exists owned_items jsonb not null default '[]'::jsonb;
alter table profiles add column if not exists equipped_avatar_url text;
alter table profiles add column if not exists equipped_theme text;
alter table profiles add column if not exists equipped_chess_set text;
alter table profiles add column if not exists equipped_chess_board text;

-- MIGRATION BACKFILL (safe): populate owned_items from owned_avatars.
-- This maps known avatar URLs -> stable item ids, and keeps any other strings as-is.
-- You can rerun this; it only fills rows where owned_items is still empty.
update public.profiles
set owned_items = (
  select coalesce(jsonb_agg(to_jsonb(mapped) order by mapped), '[]'::jsonb)
  from (
    select distinct
      case
        when x = '/three-avatar/avatars/default_male.vrm' then 'default_male'
        when x = '/three-avatar/asset/avatar-example/default_female.vrm' then 'default_female'
        when x = '/three-avatar/avatars/cherry_rose_optimized_5mb.vrm' then 'cherry'
        when x = '/three-avatar/avatars/fuyuki_optimized_5mb.vrm' then 'fuyuki'
        when x = '/three-avatar/avatars/kawaii_optimized_5mb.vrm' then 'kawaii'
        when x = '/three-avatar/avatars/miu_optimized_5mb.vrm' then 'miu'
        when x = '/three-avatar/avatars/ren_optimized_7mb.vrm' then 'ren'
        else x
      end as mapped
    from jsonb_array_elements_text(coalesce(public.profiles.owned_avatars, '[]'::jsonb)) as t(x)
  ) s
  where mapped is not null and mapped <> ''
)
where public.profiles.owned_items = '[]'::jsonb;

-- Enable RLS
alter table profiles enable row level security;

-- Create policies
-- Allow users to read their own data
drop policy if exists "Users can view their own profile" on profiles;
create policy "Users can view their own profile" on profiles
  for select using (auth.uid() = id);

-- Allow users to update their own data (for buying avatars client-side)
-- Note: In a production app, you might want to move purchases to a server action
drop policy if exists "Users can update their own profile" on profiles;
create policy "Users can update their own profile" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- Create a trigger to create a profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (
    id,
    coins,
    owned_avatars,
    owned_items,
    processed_sessions,
    equipped_avatar_url,
    equipped_theme,
    equipped_chess_set,
    equipped_chess_board
  )
  values (
    new.id,
    0,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    null,
    null,
    null,
    null
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger the function every time a user is created
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- BACKFILL: Run this once to create profiles for users who signed up BEFORE this script existed
insert into public.profiles (
  id,
  coins,
  owned_avatars,
  owned_items,
  processed_sessions,
  equipped_avatar_url,
  equipped_theme,
  equipped_chess_set,
  equipped_chess_board
)
select id, 0, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null, null, null
from auth.users
where id not in (select id from public.profiles);

-- =========================================
-- USERNAMES (public)
--
-- Store usernames separately from profiles so we can expose them publicly
-- without exposing profile fields like coins, purchases, etc.
-- =========================================

create table if not exists public.usernames (
  user_id uuid references auth.users not null primary key,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enforce case-insensitive uniqueness.
create unique index if not exists usernames_username_lower_unique
  on public.usernames (lower(username));

alter table public.usernames enable row level security;

drop policy if exists "Anyone can view usernames" on public.usernames;
create policy "Anyone can view usernames" on public.usernames
  for select using (true);

drop policy if exists "Users can insert their username" on public.usernames;
create policy "Users can insert their username" on public.usernames
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their username" on public.usernames;
create policy "Users can update their username" on public.usernames
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_updated_at_usernames()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists usernames_set_updated_at on public.usernames;
create trigger usernames_set_updated_at
  before update on public.usernames
  for each row execute procedure public.set_updated_at_usernames();

-- RPC: set username for the currently-authenticated user.
create or replace function public.set_username(p_username text)
returns void
language plpgsql
security definer
as $$
declare
  cleaned text;
begin
  cleaned := trim(coalesce(p_username, ''));
  if cleaned = '' then
    raise exception 'Username required';
  end if;
  if length(cleaned) > 24 then
    cleaned := left(cleaned, 24);
  end if;

  insert into public.usernames (user_id, username)
  values (auth.uid(), cleaned)
  on conflict (user_id) do update
    set username = excluded.username,
        updated_at = now();
end;
$$;

revoke all on function public.set_username(text) from public;
grant execute on function public.set_username(text) to authenticated;

-- RPC: check if a username is available (case-insensitive).
-- Returns true if not used by another user, or if used by the caller.
create or replace function public.is_username_available(p_username text)
returns boolean
language plpgsql
security definer
as $$
declare
  cleaned text;
  existing_user uuid;
begin
  cleaned := trim(coalesce(p_username, ''));
  if cleaned = '' then
    return false;
  end if;

  select user_id into existing_user
  from public.usernames
  where lower(username) = lower(cleaned)
  limit 1;

  if existing_user is null then
    return true;
  end if;

  return existing_user = auth.uid();
end;
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to authenticated;

-- =========================================
-- PLAYER STATS (public leaderboard)
-- =========================================

create table if not exists public.player_stats (
  user_id uuid references auth.users not null primary key,
  moves_total bigint not null default 0,
  play_ms_total bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.player_stats enable row level security;

drop policy if exists "Anyone can view player stats" on public.player_stats;
create policy "Anyone can view player stats" on public.player_stats
  for select using (true);

drop policy if exists "Users can insert their stats" on public.player_stats;
create policy "Users can insert their stats" on public.player_stats
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their stats" on public.player_stats;
create policy "Users can update their stats" on public.player_stats
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_updated_at_player_stats()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists player_stats_set_updated_at on public.player_stats;
create trigger player_stats_set_updated_at
  before update on public.player_stats
  for each row execute procedure public.set_updated_at_player_stats();

-- RPC: atomically increment the current user's stats.
create or replace function public.increment_my_stats(
  p_moves_delta bigint,
  p_play_ms_delta bigint
)
returns void
language plpgsql
security definer
as $$
declare
  moves_inc bigint;
  play_inc bigint;
begin
  moves_inc := greatest(0, coalesce(p_moves_delta, 0));
  play_inc := greatest(0, coalesce(p_play_ms_delta, 0));

  insert into public.player_stats (user_id, moves_total, play_ms_total)
  values (auth.uid(), moves_inc, play_inc)
  on conflict (user_id) do update
    set moves_total = public.player_stats.moves_total + excluded.moves_total,
        play_ms_total = public.player_stats.play_ms_total + excluded.play_ms_total,
        updated_at = now();
end;
$$;

revoke all on function public.increment_my_stats(bigint, bigint) from public;
grant execute on function public.increment_my_stats(bigint, bigint) to authenticated;

-- Convenience view for the client to fetch leaderboard entries.
create or replace view public.leaderboard_entries as
select
  s.user_id as id,
  coalesce(u.username, 'Anonymous') as name,
  s.moves_total as moves,
  s.play_ms_total as play_ms,
  (s.moves_total::double precision / greatest(1::double precision, (s.play_ms_total::double precision / 60000.0))) as score
from public.player_stats s
left join public.usernames u on u.user_id = s.user_id;

-- Quests: claim history (daily/weekly bonuses for now)
create table if not exists public.quest_claims (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  quest_id text not null,
  period text not null check (period in ('daily','weekly')),
  period_start date not null,
  coins_awarded int not null,
  claimed_at timestamptz not null default now(),
  unique (user_id, quest_id, period_start)
);

alter table public.quest_claims enable row level security;

-- Intentionally no RLS policies: clients cannot read/write claims directly.
-- Server uses the service role key, which bypasses RLS.

-- Server-side: atomic coin increment.
create or replace function public.increment_profile_coins(
  target_user_id uuid,
  delta int
)
returns int
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set coins = coins + greatest(0, coalesce(delta, 0))
  where id = target_user_id
  returning coins;
$$;

revoke all on function public.increment_profile_coins(uuid, int) from public;

-- Quests: assignments (randomized per user per period, generated server-side)
create table if not exists public.quest_assignments (
  user_id uuid not null references auth.users(id) on delete cascade,
  quest_id text not null,
  period text not null check (period in ('daily','weekly')),
  period_start date not null,
  title text not null,
  target int not null,
  reward_coins int not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, quest_id, period_start)
);

alter table public.quest_assignments enable row level security;

-- Quests: progress counters
create table if not exists public.quest_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  quest_id text not null,
  period_start date not null,
  progress int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, quest_id, period_start)
);

alter table public.quest_progress enable row level security;

-- Quests: event de-dupe (prevents double-counting)
create table if not exists public.quest_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.quest_events enable row level security;

-- Server-side: atomic claim+award in one transaction.
create or replace function public.claim_quest(
  p_user_id uuid,
  p_quest_id text,
  p_period_start date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  p record;
  new_coins int;
begin
  select period, reward_coins, target, title
    into a
  from public.quest_assignments
  where user_id = p_user_id
    and quest_id = p_quest_id
    and period_start = p_period_start
  limit 1;

  if a is null then
    raise exception 'unknown quest';
  end if;

  select progress
    into p
  from public.quest_progress
  where user_id = p_user_id
    and quest_id = p_quest_id
    and period_start = p_period_start
  limit 1;

  if p is null then
    -- treat missing as zero
    if a.target > 0 then
      raise exception 'not complete';
    end if;
  else
    if coalesce(p.progress, 0) < a.target then
      raise exception 'not complete';
    end if;
  end if;

  insert into public.quest_claims (user_id, quest_id, period, period_start, coins_awarded)
  values (p_user_id, p_quest_id, a.period, p_period_start, a.reward_coins);

  update public.profiles
  set coins = coins + greatest(0, coalesce(a.reward_coins, 0))
  where id = p_user_id
  returning coins into new_coins;

  if new_coins is null then
    raise exception 'profile missing';
  end if;

  return new_coins;
end;
$$;

revoke all on function public.claim_quest(uuid, text, date) from public;

-- Internal helper: additive upsert for quest_progress.
create or replace function public._quests_increment_progress(
  p_user_id uuid,
  p_quest_id text,
  p_period_start date,
  p_delta int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.quest_progress (user_id, quest_id, period_start, progress)
  values (p_user_id, p_quest_id, p_period_start, greatest(0, coalesce(p_delta, 0)))
  on conflict (user_id, quest_id, period_start) do update
    set progress = public.quest_progress.progress + excluded.progress,
        updated_at = now();
end;
$$;

revoke all on function public._quests_increment_progress(uuid, text, date, int) from public;
