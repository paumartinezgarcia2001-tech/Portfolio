-- Dar acceso al panel (fase 6) a una cuenta que ya existe en Supabase Auth.
--
-- 1. Authentication → Users → «Add user» → «Create new user»: email y una
--    contraseña robusta, con «Auto Confirm User» marcado.
-- 2. Cambia el email de abajo por el de esa cuenta y ejecuta esto en el SQL
--    Editor (o con el MCP de Supabase). No lo guardes con el email real: el
--    repo es público.
insert into public.admins (user_id)
select id from auth.users where email = 'CAMBIA-ESTO@ejemplo.com'
on conflict (user_id) do nothing
returning user_id;

-- Para comprobarlo:
--   select a.user_id, u.email, a.created_at
--   from public.admins a join auth.users u on u.id = a.user_id;
--
-- Para quitar el acceso (la cuenta sigue existiendo, pero el panel la rechaza):
--   delete from public.admins
--   where user_id = (select id from auth.users where email = 'CAMBIA-ESTO@ejemplo.com');
