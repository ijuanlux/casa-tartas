-- Migración 001: añadir pagos por banco a proveedores
alter table cierres
  add column if not exists pagos_banco numeric(10,2) not null default 0;
