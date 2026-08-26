-- Stash v2: run this once in the SQL editor of the Supabase project you sync to.
-- Safe to re-run: everything is guarded.

create table if not exists public.stash_goals (
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id           text not null check (char_length(id) between 1 and 40),
  name         text not null default 'My goal' check (char_length(name) <= 60),
  target       numeric(14,2) not null check (target > 0),
  currency     text not null default '$' check (char_length(currency) between 1 and 3),
  celebrated   boolean not null default false,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.stash_entries (
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id         text not null check (char_length(id) between 1 and 40),
  goal_id    text not null check (char_length(goal_id) between 1 and 40),
  amount     numeric(14,2) not null check (amount <> 0),
  note       text not null default '' check (char_length(note) <= 200),
  source     text not null default '' check (char_length(source) <= 40),
  ts         timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, goal_id) references public.stash_goals(user_id, id) on delete cascade
);

create index if not exists stash_entries_goal_ts_idx on public.stash_entries (user_id, goal_id, ts desc);

-- money you expect regularly, e.g. "allowance, 140, every Friday"
create table if not exists public.stash_incomes (
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id         text not null check (char_length(id) between 1 and 40),
  label      text not null default '' check (char_length(label) <= 40),
  amount     numeric(14,2) not null check (amount > 0),
  every      text not null default 'week' check (every in ('week','month')),
  currency   text not null default '$' check (char_length(currency) between 1 and 3),
  dow        smallint check (dow between 0 and 6),
  dom        smallint check (dom between 1 and 31),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.stash_incomes
  add column if not exists currency text not null default '$'
  check (char_length(currency) between 1 and 3);

-- keep updated_at honest so a stale device cannot overwrite a newer edit
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
create trigger stash_goals_touch   before update on public.stash_goals
  for each row execute function public.stash_touch_updated_at();
drop trigger if exists stash_entries_touch on public.stash_entries;
create trigger stash_entries_touch before update on public.stash_entries
  for each row execute function public.stash_touch_updated_at();
drop trigger if exists stash_incomes_touch on public.stash_incomes;
create trigger stash_incomes_touch before update on public.stash_incomes
  for each row execute function public.stash_touch_updated_at();

alter table public.stash_goals   enable row level security;
alter table public.stash_entries enable row level security;
alter table public.stash_incomes enable row level security;

drop policy if exists "own goals" on public.stash_goals;
create policy "own goals" on public.stash_goals
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own entries" on public.stash_entries;
create policy "own entries" on public.stash_entries
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own incomes" on public.stash_incomes;
create policy "own incomes" on public.stash_incomes
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- live updates between devices
do $$
begin
  alter publication supabase_realtime add table public.stash_goals;
  alter publication supabase_realtime add table public.stash_entries;
  alter publication supabase_realtime add table public.stash_incomes;
exception when duplicate_object then null;
end $$;
