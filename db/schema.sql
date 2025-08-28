
-- Supabase schema for Audio Arcade
create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  handle text unique not null,
  display_name text,
  bio text,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists posts (
  id bigserial primary key,
  author_id uuid references profiles(id) on delete cascade,
  text text,
  audio_url text,
  waveform jsonb,
  created_at timestamptz default now()
);

create table if not exists follows (
  follower uuid references profiles(id) on delete cascade,
  followee uuid references profiles(id) on delete cascade,
  primary key (follower, followee)
);

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  lat double precision,
  lng double precision,
  geohash text,
  radius_m int default 1000,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index if not exists channels_geohash_idx on channels(geohash);

create table if not exists channel_members (
  channel_id uuid references channels(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text check (role in ('owner','mod','member')) default 'member',
  primary key (channel_id, user_id)
);

create table if not exists channel_control_sessions (
  id bigserial primary key,
  channel_id uuid references channels(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table if not exists channel_control_queue (
  channel_id uuid references channels(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  position int,
  requested_at timestamptz default now(),
  primary key (channel_id, user_id)
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references channels(id) on delete cascade,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table if not exists event_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  artist_id uuid references profiles(id),
  status text check (status in ('open','pending','confirmed')) default 'open'
);

create table if not exists likes (
  user_id uuid references profiles(id) on delete cascade,
  post_id bigint references posts(id) on delete cascade,
  primary key (user_id, post_id)
);

create table if not exists comments (
  id bigserial primary key,
  post_id bigint references posts(id) on delete cascade,
  author_id uuid references profiles(id),
  text text not null,
  created_at timestamptz default now()
);
