create table if not exists public.omanx_chat_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chats jsonb not null default '[]'::jsonb,
  active_chat_id text,
  updated_at timestamptz not null default now(),
  constraint omanx_chat_sync_chats_array check (jsonb_typeof(chats) = 'array')
);

alter table public.omanx_chat_sync enable row level security;

create or replace function public.set_omanx_chat_sync_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_omanx_chat_sync_updated_at on public.omanx_chat_sync;
create trigger set_omanx_chat_sync_updated_at
before update on public.omanx_chat_sync
for each row
execute function public.set_omanx_chat_sync_updated_at();

drop policy if exists "Users can read their OmanX chat history" on public.omanx_chat_sync;
create policy "Users can read their OmanX chat history"
on public.omanx_chat_sync
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their OmanX chat history" on public.omanx_chat_sync;
create policy "Users can insert their OmanX chat history"
on public.omanx_chat_sync
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their OmanX chat history" on public.omanx_chat_sync;
create policy "Users can update their OmanX chat history"
on public.omanx_chat_sync
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their OmanX chat history" on public.omanx_chat_sync;
create policy "Users can delete their OmanX chat history"
on public.omanx_chat_sync
for delete
to authenticated
using (auth.uid() = user_id);
