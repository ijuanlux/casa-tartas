-- Migración 003: Tot. Caja = facturas + tarjetas + efectivo
-- Antes era (tarjetas + efectivo) y aparte se restaban las facturas en un aviso.
-- Olga lo quiere SUMADO todo, sin restar. Como tot_caja es columna generada,
-- hay que eliminarla y recrearla con la nueva fórmula.
-- Nota: esto recalcula también los cierres antiguos (mantienen sus importes,
-- solo cambia el total derivado para que la definición sea consistente).

alter table cierres drop column if exists tot_caja;

alter table cierres
  add column tot_caja numeric(10,2)
  generated always as (tot_facturas + tarjetas + efectivo) stored;
