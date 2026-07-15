-- Estrategias de aula y Clínicas de capacitación
-- Ejecutar una vez en el SQL Editor de Supabase (Dashboard → SQL Editor → Run).
--
-- 1) Checklist "Estrategias observadas" al final de Learning Walk y Formal Observation:
alter table form_lw
  add column if not exists estrategias jsonb not null default '[]'::jsonb;
alter table form_fo
  add column if not exists estrategias jsonb not null default '[]'::jsonb;

-- 2) Programa "Clínicas de Estrategias de Aula" (programa_id = 'clinicas' en badge_validations):
--    Sesión 1 (clínica de capacitación) → hito_n = 1..16 (número de la clínica)
--    Sesión 2 (observación en el aula)  → hito_n = 21..36 (clínica + 20)
--    La sesión 2 guarda la(s) fecha(s) en implementation_dates y el tipo de
--    observación agendada (learning walk / formal / modelaje) en observacion_tipo:
alter table badge_validations
  add column if not exists observacion_tipo text;
