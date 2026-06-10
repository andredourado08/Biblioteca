-- Correção do modo prático.
-- Use se aparecer erro de foreign key em libraries_owner_id_fkey.
-- Este ajuste deixa a biblioteca controlada pelo código compartilhado,
-- sem depender de email/senha nem de vínculo rígido com auth.users.

alter table public.libraries alter column owner_id drop not null;
alter table public.libraries drop constraint if exists libraries_owner_id_fkey;
alter table public.library_members drop constraint if exists library_members_user_id_fkey;
alter table public.books drop constraint if exists books_uploaded_by_fkey;
alter table public.reading_progress drop constraint if exists reading_progress_user_id_fkey;
alter table public.annotations drop constraint if exists annotations_user_id_fkey;
alter table public.profiles drop constraint if exists profiles_id_fkey;

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
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Ative Anonymous sign-ins no Supabase e recarregue a página.';
  end if;

  insert into public.profiles (id, email, display_name)
  values (current_user_id, null, coalesce(nullif(trim(p_display_name), ''), 'Leitor'))
  on conflict (id) do update
    set display_name = excluded.display_name;

  loop
    new_code := public.generate_library_code();
    exit when not exists (select 1 from public.libraries where share_code = new_code);
  end loop;

  insert into public.libraries (owner_id, name, share_code)
  values (current_user_id, coalesce(nullif(trim(p_name), ''), 'Biblioteca Compartilhada'), new_code)
  returning * into new_library;

  insert into public.library_members (library_id, user_id, role)
  values (new_library.id, current_user_id, 'owner')
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
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Ative Anonymous sign-ins no Supabase e recarregue a página.';
  end if;

  select * into found_library
  from public.libraries
  where share_code = upper(regexp_replace(coalesce(p_share_code, ''), '[^A-Z0-9]', '', 'g'))
  limit 1;

  if found_library.id is null then
    raise exception 'Código de biblioteca não encontrado.';
  end if;

  insert into public.profiles (id, email, display_name)
  values (current_user_id, null, coalesce(nullif(trim(p_display_name), ''), 'Leitor'))
  on conflict (id) do update
    set display_name = excluded.display_name;

  insert into public.library_members (library_id, user_id, role)
  values (found_library.id, current_user_id, 'member')
  on conflict (library_id, user_id) do nothing;

  return found_library;
end;
$$;

grant execute on function public.create_library_quick(text, text) to authenticated;
grant execute on function public.join_library_by_code(text, text) to authenticated;
