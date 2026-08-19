-- Flotillas para la capacitación de Aprendizaje Activo (Lecciones Atractivas),
-- independientes de la academia (colegiado) del docente.
alter table public.teachers
  add column if not exists flotilla text
  check (flotilla is null or flotilla in ('Flota Ancla','Flota Vela','Flota Timón','Flota Faro'));
