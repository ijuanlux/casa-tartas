-- La Casa de las Tartas — schema Supabase
-- Pega esto entero en el SQL Editor del proyecto Supabase y dale a Run.

-- ============ TABLAS ============

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'usuario' check (role in ('admin', 'usuario')),
  created_at timestamptz default now()
);

create table if not exists locales (
  id bigserial primary key,
  nombre text not null unique,
  activo boolean default true,
  created_at timestamptz default now()
);

create table if not exists cierres (
  id bigserial primary key,
  fecha date not null,
  local_id bigint not null references locales(id),
  tot_facturas numeric(10,2) not null default 0,
  tarjetas numeric(10,2) not null default 0,
  efectivo numeric(10,2) not null default 0,
  pagos_banco numeric(10,2) not null default 0,
  tot_suministros numeric(10,2) not null default 0,
  tot_caja numeric(10,2) generated always as (tot_facturas + tarjetas + efectivo) stored,
  notas text,
  user_id uuid not null references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists cierres_fecha_idx on cierres (fecha desc);
create index if not exists cierres_local_idx on cierres (local_id);

-- FK extra a profiles para que PostgREST pueda embeber profiles(full_name) en el histórico
do $$ begin
  alter table cierres
    add constraint cierres_user_id_profiles_fkey
    foreign key (user_id) references profiles(id);
exception when duplicate_object then null;
end $$;

create table if not exists facturas (
  id bigserial primary key,
  cierre_id bigint not null references cierres(id) on delete cascade,
  descripcion text,
  importe numeric(10,2) not null,
  orden int default 0
);

create index if not exists facturas_cierre_idx on facturas (cierre_id);

create table if not exists suministros (
  id bigserial primary key,
  cierre_id bigint not null references cierres(id) on delete cascade,
  descripcion text,
  importe numeric(10,2) not null,
  orden int default 0
);

create index if not exists suministros_cierre_idx on suministros (cierre_id);

-- ============ TRIGGER: crear profile al registrarse ============

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============ FUNCIÓN is_admin (evita recursión en RLS) ============

create or replace function is_admin()
returns boolean language sql security definer stable as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
$$;

-- ============ RLS ============

alter table profiles    enable row level security;
alter table locales     enable row level security;
alter table cierres     enable row level security;
alter table facturas    enable row level security;
alter table suministros enable row level security;

-- Profiles
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (auth.uid() = id or is_admin());

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (auth.uid() = id);

drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles for all
  using (is_admin()) with check (is_admin());

-- Locales
drop policy if exists locales_select on locales;
create policy locales_select on locales for select
  using (auth.role() = 'authenticated');

drop policy if exists locales_admin_write on locales;
create policy locales_admin_write on locales for all
  using (is_admin()) with check (is_admin());

-- Cierres
drop policy if exists cierres_select on cierres;
create policy cierres_select on cierres for select
  using (auth.role() = 'authenticated');

drop policy if exists cierres_insert on cierres;
create policy cierres_insert on cierres for insert
  with check (auth.uid() = user_id);

drop policy if exists cierres_update on cierres;
create policy cierres_update on cierres for update
  using (auth.uid() = user_id or is_admin());

drop policy if exists cierres_delete on cierres;
create policy cierres_delete on cierres for delete
  using (is_admin());

-- Facturas (heredan permisos del cierre padre)
drop policy if exists facturas_select on facturas;
create policy facturas_select on facturas for select
  using (auth.role() = 'authenticated');

drop policy if exists facturas_insert on facturas;
create policy facturas_insert on facturas for insert
  with check (exists (
    select 1 from cierres c where c.id = cierre_id and (c.user_id = auth.uid() or is_admin())
  ));

drop policy if exists facturas_update on facturas;
create policy facturas_update on facturas for update
  using (exists (
    select 1 from cierres c where c.id = cierre_id and (c.user_id = auth.uid() or is_admin())
  ));

drop policy if exists facturas_delete on facturas;
create policy facturas_delete on facturas for delete
  using (exists (
    select 1 from cierres c where c.id = cierre_id and (c.user_id = auth.uid() or is_admin())
  ));

-- Suministros (mismo patrón que facturas)
drop policy if exists suministros_select on suministros;
create policy suministros_select on suministros for select
  using (auth.role() = 'authenticated');

drop policy if exists suministros_insert on suministros;
create policy suministros_insert on suministros for insert
  with check (exists (
    select 1 from cierres c where c.id = cierre_id and (c.user_id = auth.uid() or is_admin())
  ));

drop policy if exists suministros_update on suministros;
create policy suministros_update on suministros for update
  using (exists (
    select 1 from cierres c where c.id = cierre_id and (c.user_id = auth.uid() or is_admin())
  ));

drop policy if exists suministros_delete on suministros;
create policy suministros_delete on suministros for delete
  using (exists (
    select 1 from cierres c where c.id = cierre_id and (c.user_id = auth.uid() or is_admin())
  ));

-- ============ SEED inicial ============

insert into locales (nombre) values ('Oporto') on conflict do nothing;
