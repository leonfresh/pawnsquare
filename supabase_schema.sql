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
