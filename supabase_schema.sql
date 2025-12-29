-- Create a table for user profiles
create table if not exists profiles (
  id uuid references auth.users not null primary key,
  coins int not null default 0,
  owned_avatars jsonb not null default '[]'::jsonb,
  processed_sessions jsonb not null default '[]'::jsonb
);

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
  for update using (auth.uid() = id);

-- Create a trigger to create a profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, coins, owned_avatars, processed_sessions)
  values (new.id, 0, '[]'::jsonb, '[]'::jsonb);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger the function every time a user is created
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- BACKFILL: Run this once to create profiles for users who signed up BEFORE this script existed
insert into public.profiles (id, coins, owned_avatars, processed_sessions)
select id, 0, '[]'::jsonb, '[]'::jsonb
from auth.users
where id not in (select id from public.profiles);
