-- Migración 005: Cuaderno (proveedores, notas, facturas con foto)
-- Ejecutar en Supabase SQL Editor.

-- ===== Proveedores (agenda de contactos) =====
create table if not exists proveedores (
  id bigserial primary key,
  nombre text not null,
  telefono text,
  email text,
  notas text,
  created_at timestamptz default now()
);

-- ===== Notas sueltas =====
create table if not exists notas (
  id bigserial primary key,
  texto text not null,
  user_id uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ===== Facturas con foto (la imagen vive en Storage, aquí guardamos la ruta) =====
create table if not exists facturas_foto (
  id bigserial primary key,
  fecha date,
  descripcion text,
  importe numeric(10,2),
  path text not null,
  user_id uuid references auth.users(id),
  created_at timestamptz default now()
);

create index if not exists facturas_foto_fecha_idx on facturas_foto (fecha desc);

-- ===== RLS (equipo pequeño y de confianza: cualquier usuario autenticado gestiona) =====
alter table proveedores   enable row level security;
alter table notas         enable row level security;
alter table facturas_foto enable row level security;

drop policy if exists proveedores_all on proveedores;
create policy proveedores_all on proveedores for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists notas_all on notas;
create policy notas_all on notas for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists facturas_foto_all on facturas_foto;
create policy facturas_foto_all on facturas_foto for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ===== Storage: políticas para el bucket 'facturas' (créalo antes en el panel, privado) =====
drop policy if exists facturas_storage_select on storage.objects;
create policy facturas_storage_select on storage.objects for select
  using (bucket_id = 'facturas' and auth.role() = 'authenticated');

drop policy if exists facturas_storage_insert on storage.objects;
create policy facturas_storage_insert on storage.objects for insert
  with check (bucket_id = 'facturas' and auth.role() = 'authenticated');

drop policy if exists facturas_storage_delete on storage.objects;
create policy facturas_storage_delete on storage.objects for delete
  using (bucket_id = 'facturas' and auth.role() = 'authenticated');
