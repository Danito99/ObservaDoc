-- Talleres Innovation Lab: sesión 2 (proyecto e implementación)
-- Ejecutar una vez en el SQL Editor de Supabase (Dashboard → SQL Editor → Run).
--
-- Convención de hito_n en badge_validations para programa_id = 'lab':
--   Sesión 1 (práctica en la estación)     → hito_n = 1..5  (número del taller)
--   Sesión 2 (proyecto e implementación)   → hito_n = 11..15 (taller + 10)
--   Sesión 3 (implementación en el aula)   → hito_n = 21..25 (taller + 20)
-- La inscripción a un taller es la existencia del registro de la sesión 1
-- (validated = false hasta que se complete el checklist).

alter table badge_validations
  add column if not exists project_plan text,
  add column if not exists implementation_dates jsonb not null default '[]'::jsonb;
