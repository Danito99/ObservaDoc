-- Correo de felicitación al validar un hito en Aprendizaje Activo y Clases
-- Atractivas (programa_id = 'aprendizaje') o Talleres Innovation Lab
-- (programa_id = 'lab'). El envío lo dispara la propia app (ver
-- saveHitoValidation en index.html) llamando a la Edge Function
-- notify-hito-validado justo después de guardar; esta migración solo agrega
-- el campo de correo del docente, que la función necesita para saber a
-- quién escribir.
alter table public.teachers
  add column if not exists email text;
