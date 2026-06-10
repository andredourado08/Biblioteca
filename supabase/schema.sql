-- Execute este arquivo no SQL Editor do Supabase.
-- Ele cria autenticação ligada a perfis, bibliotecas compartilhadas,
-- livros, progresso de leitura, grifos/anotações, storage e realtime.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.libraries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Biblioteca Compartilhada',
  created_at timestamptz not null default now()
);

create table if not exists public.library_members (
  library_id uuid not null references public.libraries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (library_id, user_id)
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  title text not null,
  author text,
  categories text[] not null default '{}',
  file_type text not null check (file_type in ('pdf', 'epub')),
  file_path text not null,
  cover_path text,
  file_size bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reading_progress (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  location jsonb not null default '{}'::jsonb,
  progress_percent numeric(5,2) not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  updated_at timestamptz not null default now(),
  unique (book_id, user_id)
);

create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  format text not null check (format in ('pdf', 'epub')),
  page_number integer,
  selected_text text not null,
  note text,
  color text not null default '#f8e16c',
  selector jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists books_library_id_created_at_idx on public.books(library_id, created_at desc);
create index if not exists reading_progress_book_user_idx on public.reading_progress(book_id, user_id);
create index if not exists annotations_book_created_idx on public.annotations(book_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists books_touch_updated_at on public.books;
create trigger books_touch_updated_at
before update on public.books
for each row execute function public.touch_updated_at();

drop trigger if exists annotations_touch_updated_at on public.annotations;
create trigger annotations_touch_updated_at
before update on public.annotations
for each row execute function public.touch_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create or replace function public.is_library_member(p_library_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.library_members lm
    where lm.library_id = p_library_id
      and lm.user_id = auth.uid()
  );
$$;

create or replace function public.is_library_admin(p_library_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.library_members lm
    where lm.library_id = p_library_id
      and lm.user_id = auth.uid()
      and lm.role in ('owner', 'admin')
  );
$$;

create or replace function public.invite_member_by_email(
  p_library_id uuid,
  p_email text,
  p_role text default 'member'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_user_id uuid;
begin
  if not public.is_library_admin(p_library_id) then
    raise exception 'Você não tem permissão para convidar membros.';
  end if;

  select id into invited_user_id
  from public.profiles
  where email = lower(p_email)
  limit 1;

  if invited_user_id is null then
    raise exception 'Esse email ainda não criou conta na aplicação.';
  end if;

  insert into public.library_members (library_id, user_id, role)
  values (p_library_id, invited_user_id, coalesce(p_role, 'member'))
  on conflict (library_id, user_id) do update
    set role = excluded.role;
end;
$$;

alter table public.profiles enable row level security;
alter table public.libraries enable row level security;
alter table public.library_members enable row level security;
alter table public.books enable row level security;
alter table public.reading_progress enable row level security;
alter table public.annotations enable row level security;

drop policy if exists "profiles are visible to authenticated users" on public.profiles;
create policy "profiles are visible to authenticated users"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "members can view libraries" on public.libraries;
create policy "members can view libraries"
on public.libraries for select
to authenticated
using (public.is_library_member(id));

drop policy if exists "authenticated users can create libraries" on public.libraries;
create policy "authenticated users can create libraries"
on public.libraries for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "admins can update libraries" on public.libraries;
create policy "admins can update libraries"
on public.libraries for update
to authenticated
using (public.is_library_admin(id))
with check (public.is_library_admin(id));

drop policy if exists "members can view memberships" on public.library_members;
create policy "members can view memberships"
on public.library_members for select
to authenticated
using (public.is_library_member(library_id));

drop policy if exists "owners can create initial or invited memberships" on public.library_members;
create policy "owners can create initial or invited memberships"
on public.library_members for insert
to authenticated
with check (
  exists (
    select 1 from public.libraries l
    where l.id = library_id
      and l.owner_id = auth.uid()
  )
  or public.is_library_admin(library_id)
);

drop policy if exists "admins can update memberships" on public.library_members;
create policy "admins can update memberships"
on public.library_members for update
to authenticated
using (public.is_library_admin(library_id))
with check (public.is_library_admin(library_id));

drop policy if exists "admins can delete memberships" on public.library_members;
create policy "admins can delete memberships"
on public.library_members for delete
to authenticated
using (public.is_library_admin(library_id));

drop policy if exists "members can view books" on public.books;
create policy "members can view books"
on public.books for select
to authenticated
using (public.is_library_member(library_id));

drop policy if exists "members can create books" on public.books;
create policy "members can create books"
on public.books for insert
to authenticated
with check (public.is_library_member(library_id) and uploaded_by = auth.uid());

drop policy if exists "members can update books" on public.books;
create policy "members can update books"
on public.books for update
to authenticated
using (public.is_library_member(library_id))
with check (public.is_library_member(library_id));

drop policy if exists "members can delete books" on public.books;
create policy "members can delete books"
on public.books for delete
to authenticated
using (public.is_library_member(library_id));

drop policy if exists "users can view own progress" on public.reading_progress;
create policy "users can view own progress"
on public.reading_progress for select
to authenticated
using (
  user_id = auth.uid()
  and exists (select 1 from public.books b where b.id = book_id and public.is_library_member(b.library_id))
);

drop policy if exists "users can upsert own progress" on public.reading_progress;
create policy "users can upsert own progress"
on public.reading_progress for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (select 1 from public.books b where b.id = book_id and public.is_library_member(b.library_id))
);

drop policy if exists "users can update own progress" on public.reading_progress;
create policy "users can update own progress"
on public.reading_progress for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "members can view annotations" on public.annotations;
create policy "members can view annotations"
on public.annotations for select
to authenticated
using (
  exists (select 1 from public.books b where b.id = book_id and public.is_library_member(b.library_id))
);

drop policy if exists "members can create own annotations" on public.annotations;
create policy "members can create own annotations"
on public.annotations for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (select 1 from public.books b where b.id = book_id and public.is_library_member(b.library_id))
);

drop policy if exists "users can update own annotations" on public.annotations;
create policy "users can update own annotations"
on public.annotations for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "users can delete own annotations" on public.annotations;
create policy "users can delete own annotations"
on public.annotations for delete
to authenticated
using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'book-files',
  'book-files',
  false,
  104857600,
  array['application/pdf', 'application/epub+zip', 'application/octet-stream', 'application/x-zip-compressed']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'book-covers',
  'book-covers',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members can read book files" on storage.objects;
create policy "members can read book files"
on storage.objects for select
to authenticated
using (
  bucket_id in ('book-files', 'book-covers')
  and public.is_library_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "members can upload book files" on storage.objects;
create policy "members can upload book files"
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('book-files', 'book-covers')
  and public.is_library_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "members can update book files" on storage.objects;
create policy "members can update book files"
on storage.objects for update
to authenticated
using (
  bucket_id in ('book-files', 'book-covers')
  and public.is_library_member((storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id in ('book-files', 'book-covers')
  and public.is_library_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "members can delete book files" on storage.objects;
create policy "members can delete book files"
on storage.objects for delete
to authenticated
using (
  bucket_id in ('book-files', 'book-covers')
  and public.is_library_member((storage.foldername(name))[1]::uuid)
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'books'
  ) then
    alter publication supabase_realtime add table public.books;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'annotations'
  ) then
    alter publication supabase_realtime add table public.annotations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reading_progress'
  ) then
    alter publication supabase_realtime add table public.reading_progress;
  end if;
end $$;

-- Modo prático: acesso anônimo por código de biblioteca.
-- Execute este bloco no SQL Editor se você já rodou o schema antigo.

alter table public.profiles alter column email drop not null;
alter table public.libraries add column if not exists share_code text;
create unique index if not exists libraries_share_code_key on public.libraries(share_code);

create or replace function public.generate_library_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..8 loop
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  end loop;
  return result;
end;
$$;

update public.libraries
set share_code = public.generate_library_code()
where share_code is null;

alter table public.libraries alter column share_code set not null;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    nullif(lower(coalesce(new.email, '')), ''),
    coalesce(new.raw_user_meta_data->>'display_name', 'Leitor')
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        display_name = coalesce(excluded.display_name, public.profiles.display_name);
  return new;
end;
$$;

create or replace function public.create_library_quick(
  p_name text default 'Biblioteca Compartilhada',
  p_display_name text default 'Leitor'
)
returns public.libraries
language plpgsql
security definer
set search_path = public
as $$
declare
  new_library public.libraries;
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'Entre anonimamente antes de criar a biblioteca.';
  end if;

  update public.profiles
  set display_name = coalesce(nullif(trim(p_display_name), ''), display_name, 'Leitor')
  where id = auth.uid();

  loop
    new_code := public.generate_library_code();
    exit when not exists (select 1 from public.libraries where share_code = new_code);
  end loop;

  insert into public.libraries (owner_id, name, share_code)
  values (auth.uid(), coalesce(nullif(trim(p_name), ''), 'Biblioteca Compartilhada'), new_code)
  returning * into new_library;

  insert into public.library_members (library_id, user_id, role)
  values (new_library.id, auth.uid(), 'owner')
  on conflict (library_id, user_id) do update set role = excluded.role;

  return new_library;
end;
$$;

create or replace function public.join_library_by_code(
  p_share_code text,
  p_display_name text default 'Leitor'
)
returns public.libraries
language plpgsql
security definer
set search_path = public
as $$
declare
  found_library public.libraries;
begin
  if auth.uid() is null then
    raise exception 'Entre anonimamente antes de acessar a biblioteca.';
  end if;

  select * into found_library
  from public.libraries
  where share_code = upper(regexp_replace(coalesce(p_share_code, ''), '[^A-Z0-9]', '', 'g'))
  limit 1;

  if found_library.id is null then
    raise exception 'Código de biblioteca não encontrado.';
  end if;

  update public.profiles
  set display_name = coalesce(nullif(trim(p_display_name), ''), display_name, 'Leitor')
  where id = auth.uid();

  insert into public.library_members (library_id, user_id, role)
  values (found_library.id, auth.uid(), 'member')
  on conflict (library_id, user_id) do nothing;

  return found_library;
end;
$$;

grant execute on function public.create_library_quick(text, text) to authenticated;
grant execute on function public.join_library_by_code(text, text) to authenticated;
