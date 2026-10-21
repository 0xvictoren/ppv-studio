-- PayPerWatch metadata schema (Supabase / Postgres).
-- Amounts are USDC base units (6 decimals) stored as numeric(78,0) — never floats.
-- Addresses and ids are stored lowercase.

create table if not exists videos (
  id               text primary key,               -- bytes32 videoId = keccak256(abi.encodePacked(creator, contentCID))
  creator          text not null,
  title            text not null,
  description      text not null default '',
  category         text not null default 'other' check (category in ('movies', 'tutorials', 'exclusive', 'other')),
  referrals_enabled boolean not null default false, -- creator opted in to "Share and earn"
  thumbnail_url    text,
  content_cid      text not null,                  -- IPFS CID or Livepeer playback id
  playback_url     text not null,
  price_per_hour   numeric(78,0) not null,         -- mirrors chain at registration; the app reads the live price on-chain
  duration_seconds integer not null default 0,
  active           boolean not null default true,
  register_tx      text,
  created_at       timestamptz not null default now()
);
create index if not exists videos_creator_idx on videos (creator);
create index if not exists videos_created_idx on videos (created_at desc);
create index if not exists videos_category_idx on videos (category);

-- Latest signed receipt per (viewer, creator, referrer). cumulative_amount only ever increases.
create table if not exists receipts (
  viewer            text not null,
  creator           text not null,
  referrer          text not null default '0x0000000000000000000000000000000000000000', -- who referred the viewer (zero = nobody)
  cumulative_amount numeric(78,0) not null,
  deadline          bigint not null,
  signature         text not null,
  signer            text not null,                 -- viewer or the session key that signed
  settled_amount    numeric(78,0) not null default 0, -- settled(viewer, creator) as of the last cron run
  updated_at        timestamptz not null default now(),
  primary key (viewer, creator, referrer)
);
create index if not exists receipts_creator_idx on receipts (creator);
create index if not exists receipts_referrer_idx on receipts (referrer);

-- One row per hourly settlement run.
create table if not exists settlement_runs (
  id             bigserial primary key,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null,                   -- 'success' | 'noop' | 'error'
  receipts_count integer not null default 0,
  total_amount   numeric(78,0) not null default 0,
  tx_hash        text,
  error          text
);
create index if not exists settlement_runs_started_idx on settlement_runs (started_at desc);

-- Watch sessions: per-video watch time and spend. Feeds views and the watch-based rating.
-- Seconds are credited only up to what the signed receipts actually paid for.
create table if not exists watch_sessions (
  id         text primary key,
  viewer     text not null,
  creator    text not null,
  referrer   text not null default '0x0000000000000000000000000000000000000000',
  video_id   text not null references videos (id) on delete cascade,
  seconds    integer not null default 0,
  amount     numeric(78,0) not null default 0,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists watch_sessions_video_idx on watch_sessions (video_id);
create index if not exists watch_sessions_viewer_idx on watch_sessions (viewer);

-- The app talks to these tables only from server route handlers using the service-role key.
alter table videos enable row level security;
alter table receipts enable row level security;
alter table settlement_runs enable row level security;
alter table watch_sessions enable row level security;
create policy "public read videos" on videos for select using (true);

-- Video storage when NEXT_PUBLIC_STORAGE_PROVIDER=supabase: a public bucket the browser uploads to via signed URLs.
insert into storage.buckets (id, name, public) values ('videos', 'videos', true) on conflict (id) do nothing;

-- Watch progress per (viewer, video) for a 30-day window: paid-second bitmap + free-replay pass.
create table if not exists watch_progress (
  viewer          text not null,
  video_id        text not null references videos (id) on delete cascade,
  window_start    timestamptz not null,
  coverage        text not null default '',     -- base64 bitmap, 1 bit per second of the video
  covered_seconds integer not null default 0,
  completed_at    timestamptz,
  pass_until      timestamptz,                  -- free replays and re-downloads until then
  downloaded_at   timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (viewer, video_id)
);
alter table watch_progress enable row level security;
alter table watch_sessions add column if not exists free_seconds integer not null default 0;
