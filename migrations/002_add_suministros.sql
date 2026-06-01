-- Migración 002: suministros (internet, teléfono, gastos varios)

alter table cierres
  add column if not exists tot_suministros numeric(10,2) not null default 0;

create table if not exists suministros (
  id bigserial primary key,
  cierre_id bigint not null references cierres(id) on delete cascade,
  descripcion text,
  importe numeric(10,2) not null,
  orden int default 0
);

create index if not exists suministros_cierre_idx on suministros (cierre_id);

alter table suministros enable row level security;

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
