-- ============================================================================
-- ProVeri cloud schema — run once in the Supabase SQL editor
-- project: https://srwdtguxdjsjlkaydhet.supabase.co · bucket: photos
--
-- The Node server mirrors every marketplace post (job or published work) into
-- `posts`, and the PWA uploads phone photos straight into the `photos` bucket.
-- The app authenticates people with Firebase, so Supabase never sees a
-- Supabase JWT: the anon (publishable) key writes under the policies below,
-- and `author_uid` carries the Firebase uid for ownership.
-- ============================================================================

create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  uid         text unique,                 -- Firebase uid
  email       text,
  full_name   text,
  role        text not null default 'customer',
  created_at  timestamptz not null default now()
);

create table if not exists public.posts (
  id             text primary key,         -- marketplace id (job_… / pf_…)
  kind           text not null check (kind in ('job', 'work')),
  reference      text,
  author_uid     text,                     -- Firebase uid of the poster
  author_name    text,
  title          text,
  description    text,
  category_id    text,
  category_label text,
  suburb         text,
  metro          text,
  price_cents    bigint,
  photos         jsonb not null default '[]',
  created_at     timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_kind_idx       on public.posts (kind);
create index if not exists posts_author_uid_idx on public.posts (author_uid);

alter table public.profiles enable row level security;
alter table public.posts    enable row level security;

-- Public read: the marketplace feed is a shop window.
create policy "posts are readable by everyone"
  on public.posts for select to anon, authenticated using (true);

-- Public write of new posts: posting must work from the app with the
-- publishable key. Rows are append-only mirrors; updates and deletes stay
-- with the service role (dashboard / server-side moderation).
create policy "new posts can be mirrored"
  on public.posts for insert to anon, authenticated with check (true);

create policy "profiles are readable by everyone"
  on public.profiles for select to anon, authenticated using (true);

create policy "profiles can be created"
  on public.profiles for insert to anon, authenticated with check (true);

-- ----------------------------------------------------------------------------
-- Storage: the "photos" bucket (public read, app-side upload)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

create policy "photos are readable by everyone"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'photos');

create policy "the app can upload photos"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos');

-- Uploaded bytes are never served back as executable content.
-- (Supabase serves the public bucket from its own CDN host.)
