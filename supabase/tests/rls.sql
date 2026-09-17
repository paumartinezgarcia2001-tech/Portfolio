-- Comprobación de RLS (fase 2). Se puede pegar tal cual en el SQL Editor de
-- Supabase o ejecutar con el MCP: no deja rastro (crea un bolo sin publicar
-- para la prueba y lo borra al final).
--
-- Todos los resultados deben decir «correcto» o «bloqueado (42501)».
create or replace function pg_temp.rls_check() returns table(prueba text, resultado text) language plpgsql as $fn$
declare
  v_count int;
  v_test_id uuid;
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

  reset role;
  delete from public.gigs where id = v_test_id;
  prueba := 'limpieza'; resultado := 'bolo de prueba borrado'; return next;
end
$fn$;

select * from pg_temp.rls_check();
