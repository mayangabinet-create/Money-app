-- Stash: run this once in the SQL editor of the Supabase project you want to sync to.
-- It creates the two tables the app uses and locks them to their owner.

create table if not exists public.stash_goals (
  user_id     uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  name        text not null default 'My goal' check (char_length(name) <= 60),
  target      numeric(14,2) not null check (target > 0),
  currency    text not null default '$' check (char_length(currency) between 1 and 3),
  celebrated  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.stash_entries (
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id         text not null check (char_length(id) between 1 and 40),
  amount     numeric(14,2) not null check (amount <> 0),
  note       text not null default '' check (char_length(note) <= 200),
  ts         timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists stash_entries_user_ts_idx on public.stash_entries (user_id, ts desc);

-- keep updated_at honest so the newer side wins when a second device syncs
create or replace function public.stash_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stash_goals_touch on public.stash_goals;
create trigger stash_goals_touch
  before update on public.stash_goals
  for each row execute function public.stash_touch_updated_at();

alter table public.stash_goals   enable row level security;
alter table public.stash_entries enable row level security;

drop policy if exists "own goal" on public.stash_goals;
create policy "own goal" on public.stash_goals
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own entries" on public.stash_entries;
create policy "own entries" on public.stash_entries
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
