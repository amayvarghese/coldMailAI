-- Run in Supabase → SQL Editor (once), or use Supabase CLI migrations.

create table if not exists public.leads (
  email text primary key,
  name text default '' not null,
  company text default '' not null,
  role text default '' not null,
  subject text default '' not null,
  body text default '' not null,
  sent boolean default false not null,
  opened boolean default false not null,
  clicked boolean default false not null,
  replied boolean default false not null,
  bounced boolean default false not null,
  bounce_note text,
  reply_content text,
  reply_content_full text,
  reply_at timestamptz,
  message_id text,
  send_error text,
  reply_source text,
  sent_at timestamptz,
  updated_at timestamptz default now() not null
);

create index if not exists leads_sent_at_idx on public.leads (sent_at desc nulls last);

alter table public.leads enable row level security;

-- No policies: the backend uses the service role key, which bypasses RLS.
-- Do not expose SUPABASE_SERVICE_ROLE_KEY to the browser.

comment on table public.leads is 'Cold outreach leads; accessed only from server (service role).';
