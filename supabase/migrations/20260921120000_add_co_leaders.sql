-- Permite acreditar una observación a más de un líder cuando acompañan juntos al docente,
-- sin crear una segunda actividad/formulario (el docente sigue contando como observado una sola vez).
alter table public.activities add column if not exists co_leader_ids uuid[] not null default '{}';
alter table public.activities add column if not exists co_leader_names text[] not null default '{}';

alter table public.form_fo add column if not exists co_leader_ids uuid[] not null default '{}';
alter table public.form_fo add column if not exists co_leader_names text[] not null default '{}';

alter table public.form_lw add column if not exists co_leader_ids uuid[] not null default '{}';
alter table public.form_lw add column if not exists co_leader_names text[] not null default '{}';

alter table public.form_mc add column if not exists co_leader_ids uuid[] not null default '{}';
alter table public.form_mc add column if not exists co_leader_names text[] not null default '{}';

alter table public.form_fb add column if not exists co_leader_ids uuid[] not null default '{}';
alter table public.form_fb add column if not exists co_leader_names text[] not null default '{}';
