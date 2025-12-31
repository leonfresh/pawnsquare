-- Create a table for user profiles
create table if not exists profiles (
  id uuid references auth.users not null primary key,
  coins int not null default 0,
  owned_avatars jsonb not null default '[]'::jsonb,
  processed_sessions jsonb not null default '[]'::jsonb,
  equipped_avatar_url text,
  equipped_theme text,
  equipped_chess_set text,
  equipped_chess_board text
);

-- MIGRATIONS: ensure new columns exist even if the table already existed.
alter table profiles add column if not exists equipped_avatar_url text;
alter table profiles add column if not exists equipped_theme text;
alter table profiles add column if not exists equipped_chess_set text;
alter table profiles add column if not exists equipped_chess_board text;

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
  processed_sessions,
  equipped_avatar_url,
  equipped_theme,
  equipped_chess_set,
  equipped_chess_board
)
select id, 0, '[]'::jsonb, '[]'::jsonb, null, null, null, null
from auth.users
where id not in (select id from public.profiles);
