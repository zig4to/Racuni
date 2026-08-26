-- Shema za sinhronizacijo računov.
-- Prilepi v Supabase → SQL Editor → New query → Run.
-- Skripta je varna za večkratni zagon.

-- ---------------------------------------------------------------- metapodatki
create table if not exists public.racuni (
  id          bigint primary key,             -- Date.now(), enak kot v IndexedDB
  user_id     uuid        not null references auth.users(id) on delete cascade,
  created     timestamptz not null default now(),
  w           int         not null,
  h           int         not null,
  size        int         not null,
  path        text        not null,           -- <user_id>/<id>.jpg (prva stran)
  thumb_path  text        not null,           -- <user_id>/<id>_thumb.jpg (prva stran)
  pages       int         not null default 1, -- stevilo strani; 2+ so <user_id>/<id>_p<n>.jpg

  -- Podatki, ki jih vpiše uporabnik. Vsi so neobvezni: račun se da shraniti
  -- takoj ob nakupu in dopolniti pozneje.
  trgovina      text,                         -- kje je bilo kupljeno
  izdelek       text,                         -- kaj je bilo kupljeno
  znamka        text,                         -- znamka izdelka
  model         text,                         -- model izdelka
  kupljeno      date,                         -- datum nakupa
  garancija_let numeric(4,1)                  -- leta garancije (dopušča 0,5)
);

-- Za projekte, kjer je bila tabela ustvarjena, preden so bili ti stolpci
-- dodani — "create table if not exists" zgoraj obstoječe tabele ne spremeni.
alter table public.racuni add column if not exists trgovina      text;
alter table public.racuni add column if not exists izdelek       text;
alter table public.racuni add column if not exists znamka        text;
alter table public.racuni add column if not exists model         text;
alter table public.racuni add column if not exists kupljeno      date;
alter table public.racuni add column if not exists garancija_let numeric(4,1);
alter table public.racuni add column if not exists pages         int not null default 1;

create index if not exists racuni_user_created_idx
  on public.racuni (user_id, created desc);

-- Iskanje po trgovini, izdelku, znamki in modelu, ko se jih nabere veliko.
create index if not exists racuni_iskanje_idx
  on public.racuni (user_id, trgovina, izdelek, znamka, model);

alter table public.racuni enable row level security;

-- Pravice na tabeli so ločena plast od pravil RLS: pravila določajo, katere
-- vrstice so vidne, vloga pa potrebuje še osnovno pravico, sicer vsaka zahteva
-- pade z "permission denied for table". V tem projektu je nastavitev
-- "Automatically expose new tables" izklopljena, zato je treba pravico
-- podeliti izrecno.
-- UPDATE je potreben, ker se trgovina, izdelek, datum in garancija lahko
-- vpišejo ali popravijo pozneje, ko je zapis že v oblaku.
grant select, insert, update, delete on table public.racuni to authenticated;

-- Vsak vidi in ureja samo svoje zapise. Brez teh pravil bi bili računi
-- dostopni komurkoli, ki pozna javni ključ anon.
drop policy if exists "racuni_select_own" on public.racuni;
create policy "racuni_select_own" on public.racuni
  for select using (auth.uid() = user_id);

drop policy if exists "racuni_insert_own" on public.racuni;
create policy "racuni_insert_own" on public.racuni
  for insert with check (auth.uid() = user_id);

drop policy if exists "racuni_update_own" on public.racuni;
create policy "racuni_update_own" on public.racuni
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "racuni_delete_own" on public.racuni;
create policy "racuni_delete_own" on public.racuni
  for delete using (auth.uid() = user_id);

-- -------------------------------------------------------------------- shramba
-- Zaseben vedro (bucket) za slike JPG; datoteke so v mapi z ID-jem uporabnika.
insert into storage.buckets (id, name, public)
values ('racuni', 'racuni', false)
on conflict (id) do nothing;

drop policy if exists "racuni_files_select_own" on storage.objects;
create policy "racuni_files_select_own" on storage.objects
  for select using (
    bucket_id = 'racuni' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "racuni_files_insert_own" on storage.objects;
create policy "racuni_files_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'racuni' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Nalaganje uporablja x-upsert, da ponovni poskus po prekinjeni sinhronizaciji
-- prepise nedokoncano datoteko. Upsert v shrambi je UPDATE, zato to pravilo.
drop policy if exists "racuni_files_update_own" on storage.objects;
create policy "racuni_files_update_own" on storage.objects
  for update using (
    bucket_id = 'racuni' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'racuni' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "racuni_files_delete_own" on storage.objects;
create policy "racuni_files_delete_own" on storage.objects
  for delete using (
    bucket_id = 'racuni' and (storage.foldername(name))[1] = auth.uid()::text
  );

