create table if not exists public.omanx_analytics_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  destination text not null check (destination in ('us', 'uk', 'au')),
  compliance boolean not null,
  kb_matched boolean not null,
  web_searched boolean not null,
  authenticated boolean not null
);

alter table public.omanx_analytics_events enable row level security;

-- The server logs one event per chat turn (signed-in or anonymous), so
-- inserts must be allowed for both roles. No select/update/delete policy
-- exists, so nothing can read this table through the public API — only
-- via the Supabase dashboard/SQL editor.
drop policy if exists "Allow inserts from app" on public.omanx_analytics_events;
create policy "Allow inserts from app"
on public.omanx_analytics_events
for insert
to anon, authenticated
with check (true);
