-- Comprobación de RLS (fases 2 y 6). Se puede pegar tal cual en el SQL Editor
-- de Supabase o ejecutar con el MCP: no deja rastro (crea un bolo sin publicar
-- para la prueba y lo borra al final; lo que hace como administradora se
-- deshace antes de terminar).
--
-- Todos los resultados deben decir «correcto», «sin efecto (correcto)»,
-- «permitido (correcto)» o «bloqueado (42501)». La parte de administradora
-- solo se comprueba si ya hay alguien en `admins` (fase 6).
create or replace function pg_temp.rls_check() returns table(prueba text, resultado text) language plpgsql as $fn$
declare
  v_count int;
  v_test_id uuid;
  v_admin uuid;
begin
  insert into public.gigs (event_date, party_name, venue, city, published)
  values ('2099-01-01', 'PRUEBA RLS', 'SALA PRUEBA', 'Madrid', false)
  returning id into v_test_id;

  -- ---------- anon ----------
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';

  select count(*) into v_count from public.gigs;
  prueba := 'anon: select gigs'; resultado := v_count::text || ' filas visibles'; return next;

  select count(*) into v_count from public.gigs where id = v_test_id;
  prueba := 'anon: ve el bolo sin publicar'; resultado := case when v_count = 0 then 'NO (correcto)' else 'SÍ (mal)' end; return next;

  select count(*) into v_count from public.site_settings;
  prueba := 'anon: select site_settings'; resultado := v_count::text || ' filas'; return next;

  begin
    insert into public.gigs (event_date, venue, city) values ('2099-02-02', 'X', 'Y');
    prueba := 'anon: insert gigs'; resultado := 'PERMITIDO (mal)';
  exception when others then
    prueba := 'anon: insert gigs'; resultado := 'bloqueado (' || sqlstate || ')';
  end;
  return next;

  begin
    update public.gigs set city = 'HACK' where true;
    prueba := 'anon: update gigs'; resultado := 'PERMITIDO (mal)';
  exception when others then
    prueba := 'anon: update gigs'; resultado := 'bloqueado (' || sqlstate || ')';
  end;
  return next;

  begin
    delete from public.gigs where true;
    prueba := 'anon: delete gigs'; resultado := 'PERMITIDO (mal)';
  exception when others then
    prueba := 'anon: delete gigs'; resultado := 'bloqueado (' || sqlstate || ')';
  end;
  return next;

  begin
    update public.site_settings set ticker_text = 'HACK' where id = 1;
    prueba := 'anon: update site_settings'; resultado := 'PERMITIDO (mal)';
  exception when others then
    prueba := 'anon: update site_settings'; resultado := 'bloqueado (' || sqlstate || ')';
  end;
  return next;

  begin
    select count(*) into v_count from public.admins;
    prueba := 'anon: select admins'; resultado := 'PERMITIDO (mal): ' || v_count::text;
  exception when others then
    prueba := 'anon: select admins'; resultado := 'bloqueado (' || sqlstate || ')';
  end;
  return next;

  -- ---------- authenticated que no está en `admins` ----------
  reset role;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';

  select count(*) into v_count from public.gigs where id = v_test_id;
  prueba := 'auth no admin: ve el bolo sin publicar'; resultado := case when v_count = 0 then 'NO (correcto)' else 'SÍ (mal)' end; return next;

  begin
    insert into public.gigs (event_date, venue, city) values ('2099-03-03', 'X', 'Y');
    prueba := 'auth no admin: insert gigs'; resultado := 'PERMITIDO (mal)';
  exception when others then
    prueba := 'auth no admin: insert gigs'; resultado := 'bloqueado (' || sqlstate || ')';
  end;
  return next;

  begin
    update public.site_settings set ticker_text = 'HACK' where id = 1;
    get diagnostics v_count = row_count;
    prueba := 'auth no admin: update site_settings'; resultado := case when v_count = 0 then 'sin efecto (correcto)' else 'PERMITIDO (mal)' end;
  exception when others then
    prueba := 'auth no admin: update site_settings'; resultado := 'bloqueado (' || sqlstate || ')';
  end;
  return next;

  update public.gigs set city = 'HACK' where id = v_test_id;
  get diagnostics v_count = row_count;
  prueba := 'auth no admin: update gigs'; resultado := case when v_count = 0 then 'sin efecto (correcto)' else 'PERMITIDO (mal)' end; return next;

  delete from public.gigs where true;
  get diagnostics v_count = row_count;
  prueba := 'auth no admin: delete gigs'; resultado := case when v_count = 0 then 'sin efecto (correcto)' else 'PERMITIDO (mal)' end; return next;

  begin
    insert into public.mixes (title, audio_url) values ('HACK', 'mixes/hack.mp3');
    prueba := 'auth no admin: insert mixes'; resultado := 'PERMITIDO (mal)';
  exception when others then
    prueba := 'auth no admin: insert mixes'; resultado := 'bloqueado (' || sqlstate || ')';
  end;
  return next;

  update public.mixes set title = 'HACK' where true;
  get diagnostics v_count = row_count;
  prueba := 'auth no admin: update mixes'; resultado := case when v_count = 0 then 'sin efecto (correcto)' else 'PERMITIDO (mal)' end; return next;

  delete from public.mixes where true;
  get diagnostics v_count = row_count;
  prueba := 'auth no admin: delete mixes'; resultado := case when v_count = 0 then 'sin efecto (correcto)' else 'PERMITIDO (mal)' end; return next;

  select count(*) into v_count from public.admins;
  prueba := 'auth no admin: select admins'; resultado := case when v_count = 0 then 'nada visible (correcto)' else 'VE FILAS (mal)' end; return next;

  -- ---------- administradora (fase 6; solo si ya hay alguien en `admins`) ----------
  reset role;
  select a.user_id into v_admin from public.admins a order by a.created_at limit 1;
  if v_admin is null then
    prueba := 'admin'; resultado := 'sin comprobar: todavía no hay nadie en admins'; return next;
  else
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

      select count(*) into v_count from public.gigs where id = v_test_id;
      prueba := 'admin: ve el bolo sin publicar'; resultado := case when v_count = 1 then 'SÍ (correcto)' else 'NO (mal)' end; return next;

      update public.gigs set city = 'Sevilla' where id = v_test_id;
      get diagnostics v_count = row_count;
      prueba := 'admin: update gigs'; resultado := case when v_count = 1 then 'permitido (correcto)' else 'sin efecto (mal)' end; return next;

      select count(*) into v_count from public.gigs where id = v_test_id and updated_by = v_admin;
      prueba := 'admin: updated_by automático (0005)'; resultado := case when v_count = 1 then 'correcto' else 'mal (¿falta la migración 0005?)' end; return next;

      update public.site_settings set ticker_text = ticker_text where id = 1;
      get diagnostics v_count = row_count;
      prueba := 'admin: update site_settings'; resultado := case when v_count = 1 then 'permitido (correcto)' else 'sin efecto (mal)' end; return next;

      select count(*) into v_count from public.admins;
      prueba := 'admin: select admins'; resultado := case when v_count = 1 then 'solo su fila (correcto)' else v_count::text || ' filas (mal)' end; return next;

      delete from public.gigs where id = v_test_id;
      get diagnostics v_count = row_count;
      prueba := 'admin: delete gigs'; resultado := case when v_count = 1 then 'permitido (correcto)' else 'sin efecto (mal)' end; return next;

      -- Deshace todo lo de este bloque (el ajuste tocado y el bolo borrado).
      raise exception using errcode = 'P0001', message = 'deshacer';
    exception when sqlstate 'P0001' then
      null;
    end;
  end if;

  reset role;
  delete from public.gigs where id = v_test_id;
  prueba := 'limpieza'; resultado := 'bolo de prueba borrado'; return next;
end
$fn$;

select * from pg_temp.rls_check();
