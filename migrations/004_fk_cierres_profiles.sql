-- Migración 004: FK cierres.user_id -> profiles(id)
-- El histórico embebe profiles(full_name) (columna "Quien") vía PostgREST,
-- pero no existía relación entre cierres y profiles, así que la consulta
-- fallaba con PGRST200 y mostraba "0 cierres" aunque sí estuvieran guardados.
-- cierres.user_id ya referencia auth.users(id); añadimos además la FK a
-- profiles(id) (que es el mismo id) para que PostgREST pueda resolver el embed.

do $$ begin
  alter table cierres
    add constraint cierres_user_id_profiles_fkey
    foreign key (user_id) references profiles(id);
exception when duplicate_object then null;
end $$;
