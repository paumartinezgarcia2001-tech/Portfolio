/**
 * Supabase simulado para los e2e del panel (fase 6).
 *
 * El contenedor donde se prueban las fases no llega a `*.supabase.co`, y los
 * tests no deben tocar la base de datos de verdad. Este servidor imita lo que
 * usan la web y el panel:
 *
 * - **Auth (GoTrue)**: login con contraseña (y CAPTCHA con el token de prueba
 *   de Turnstile, como Supabase con el CAPTCHA activado), refresco, `/user`,
 *   logout y MFA TOTP (enrolar, reto, verificar —el código válido es
 *   `123456`—, quitar). Los JWT van firmados con HS256, así que `getClaims()`
 *   los valida preguntando a `/user`, como con las claves simétricas.
 * - **PostgREST** para `gigs`, `site_settings`, `mixes` y `admins`, con las
 *   mismas reglas que las políticas RLS de §7.2 (anon lee lo publicado; solo
 *   quien está en `admins` escribe; los demás, 42501 o «0 filas») y las
 *   restricciones únicas (`gigs_dedupe`, `mixes_audio_url_key` → 23505).
 * - `/__e2e/*`: estado para los tests (reiniciar, leer, fijar el reloj no).
 *
 * No es PostgREST completo: solo los filtros que usa el código (eq, neq, gt,
 * gte, lt, lte, in, is), order, limit/offset, select de columnas, count=exact,
 * return=representation, on_conflict + ignore-duplicates.
 *
 * Uso: `node tests/e2e-admin/mock-supabase.mjs --port 4324`
 */
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex === -1 ? process.env.E2E_SUPABASE_PORT || 4324 : args[portIndex + 1]);

export const JWT_SECRET = 'e2e-jwt-secret-que-no-vale-para-nada';
export const DUMMY_CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX';
export const TOTP_CODE = '123456';
const requireCaptcha = process.env.E2E_REQUIRE_CAPTCHA !== '0';

// ------------------------------------------------------------------ estado

function seed() {
  const pau = { id: '11111111-1111-4111-8111-111111111111', email: 'pau@e2e.test', password: 'contraseña-e2e-123', factors: [] };
  const intruder = { id: '22222222-2222-4222-8222-222222222222', email: 'intrusa@e2e.test', password: 'contraseña-e2e-456', factors: [] };
  const now = new Date().toISOString();
  const gig = (event_date, party_name, venue, city, lineup = [], extra = {}) => ({
    id: randomUUID(),
    event_date,
    party_name,
    venue,
    city,
    lineup,
    ticket_url: null,
    published: true,
    created_at: now,
    updated_at: now,
    updated_by: null,
    ...extra,
  });
  const gigs = [
    gig('2099-09-30', 'INSULTO CLUB', 'SIROCO', 'Madrid', ['TRAVEST15M0', 'GOTINGA']),
    gig('2099-10-02', null, 'LA2', 'Sevilla'),
    gig('2099-11-15', 'BORRADOR', 'SALA OCULTA', 'Madrid', [], { published: false }),
  ];
  // Archivo: 60 bolos pasados para probar las páginas de 50.
  for (let i = 0; i < 60; i += 1) {
    const day = new Date(Date.UTC(2021, 0, 1 + i * 3)).toISOString().slice(0, 10);
    gigs.push(gig(day, `ARCHIVO ${String(i + 1).padStart(2, '0')}`, 'SALA VIEJA', 'Madrid', ['TRAVEST15M0']));
  }
  return {
    users: [pau, intruder],
    admins: new Set([pau.id]),
    sessions: new Map(),
    refresh: new Map(),
    challenges: new Map(),
    tables: {
      gigs,
      site_settings: [
        {
          id: 1,
          ticker_text: 'travest15m0 · DJ · Madrid',
          ticker_append_next_gig: true,
          info_markdown: null,
          video: null,
          updated_at: now,
          updated_by: null,
        },
      ],
      mixes: [
        {
          id: randomUUID(),
          title: 'MIX DE PRUEBA',
          subtitle: null,
          audio_url: 'mixes/mix-de-prueba-0000aaaa.mp3',
          duration_seconds: 3600,
          artwork_url: null,
          published: true,
          sort_order: 0,
          created_at: now,
          updated_at: now,
          updated_by: null,
        },
      ],
    },
    log: [],
  };
}

let state = seed();

// --------------------------------------------------------------------- JWT

const b64url = (value) => Buffer.from(value).toString('base64url');

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token) {
  const [header, body, signature] = String(token ?? '').split('.');
  if (!header || !body || !signature) return null;
  const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (expected !== signature) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

function publicUser(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    factors: user.factors.map(({ secret: _secret, ...factor }) => factor),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
  };
}

function createSession(user, aal = 'aal1', sessionId = randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const amr = [{ method: 'password', timestamp: now }];
  if (aal === 'aal2') amr.push({ method: 'totp', timestamp: now });
  const access_token = signJwt({
    sub: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    aal,
    amr,
    session_id: sessionId,
    iat: now,
    exp: now + 3600,
  });
  const refresh_token = randomUUID();
  state.refresh.set(refresh_token, { userId: user.id, aal, sessionId });
  state.sessions.set(sessionId, { userId: user.id, aal });
  return {
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token,
    user: publicUser(user),
  };
}

/** Quién hace la petición: `null` (anon) o `{ user, claims }`. */
function requester(request) {
  const auth = request.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const claims = verifyJwt(token);
  if (!claims || claims.role !== 'authenticated') return null;
  if (!state.sessions.has(claims.session_id)) return null;
  const user = state.users.find((item) => item.id === claims.sub);
  return user ? { user, claims } : null;
}

// ------------------------------------------------------------------ HTTP

function send(response, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-expose-headers': 'content-range',
    ...headers,
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
    request.on('error', reject);
  });
}

const authError = (response, status, code, message) =>
  send(response, status, { code: status, error_code: code, msg: message, message });

// ------------------------------------------------------------------ Auth

async function handleAuth(request, response, url, path) {
  const body = await readBody(request);

  if (path === '/token' && request.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const captcha = body?.gotrue_meta_security?.captcha_token;
      if (requireCaptcha && captcha !== DUMMY_CAPTCHA) {
        return authError(response, 400, 'captcha_failed', 'captcha protection: request disallowed');
      }
      const user = state.users.find((item) => item.email === String(body?.email ?? '').toLowerCase());
      state.log.push({ type: 'login', email: body?.email, ok: Boolean(user && user.password === body?.password) });
      if (!user || user.password !== body?.password) {
        return authError(response, 400, 'invalid_credentials', 'Invalid login credentials');
      }
      return send(response, 200, createSession(user));
    }
    if (grant === 'refresh_token') {
      const entry = state.refresh.get(body?.refresh_token);
      if (!entry) return authError(response, 400, 'refresh_token_not_found', 'Invalid Refresh Token');
      state.refresh.delete(body.refresh_token);
      const user = state.users.find((item) => item.id === entry.userId);
      if (!user || !state.sessions.has(entry.sessionId)) return authError(response, 400, 'session_not_found', 'Session not found');
      return send(response, 200, createSession(user, entry.aal, entry.sessionId));
    }
    return authError(response, 400, 'unsupported_grant_type', 'unsupported grant');
  }

  const who = requester(request);

  if (path === '/user' && request.method === 'GET') {
    if (!who) return authError(response, 401, 'bad_jwt', 'invalid JWT');
    return send(response, 200, publicUser(who.user));
  }

  if (path === '/logout' && request.method === 'POST') {
    if (who) state.sessions.delete(who.claims.session_id);
    response.writeHead(204, { 'access-control-allow-origin': '*' });
    return response.end();
  }

  if (!who) return authError(response, 401, 'bad_jwt', 'invalid JWT');

  if (path === '/factors' && request.method === 'POST') {
    const factor = {
      id: randomUUID(),
      friendly_name: body?.friendly_name ?? 'totp',
      factor_type: 'totp',
      status: 'unverified',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      secret: 'JBSWY3DPEHPK3PXP',
    };
    who.user.factors.push(factor);
    return send(response, 200, {
      id: factor.id,
      type: 'totp',
      friendly_name: factor.friendly_name,
      totp: {
        qr_code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/></svg>',
        secret: factor.secret,
        uri: `otpauth://totp/e2e:${who.user.email}?secret=${factor.secret}`,
      },
    });
  }

  const factorMatch = /^\/factors\/([^/]+)(?:\/(challenge|verify))?$/.exec(path);
  if (factorMatch) {
    const [, factorId, step] = factorMatch;
    const factor = who.user.factors.find((item) => item.id === factorId);
    if (!factor) return authError(response, 404, 'mfa_factor_not_found', 'Factor not found');
    if (!step && request.method === 'DELETE') {
      if (factor.status === 'verified' && who.claims.aal !== 'aal2') {
        return authError(response, 403, 'insufficient_aal', 'AAL2 required');
      }
      who.user.factors = who.user.factors.filter((item) => item.id !== factorId);
      return send(response, 200, { id: factorId });
    }
    if (step === 'challenge' && request.method === 'POST') {
      const id = randomUUID();
      state.challenges.set(id, factorId);
      return send(response, 200, { id, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
    }
    if (step === 'verify' && request.method === 'POST') {
      if (state.challenges.get(body?.challenge_id) !== factorId || body?.code !== TOTP_CODE) {
        return authError(response, 422, 'mfa_verification_failed', 'Invalid TOTP code entered');
      }
      state.challenges.delete(body.challenge_id);
      factor.status = 'verified';
      return send(response, 200, createSession(who.user, 'aal2', who.claims.session_id));
    }
  }

  return authError(response, 404, 'not_found', `No simulado: ${request.method} ${path}`);
}

// -------------------------------------------------------------- PostgREST

const TABLES = new Set(['gigs', 'site_settings', 'mixes', 'admins']);

function pgError(response, status, code, message) {
  send(response, status, { code, message, details: null, hint: null });
}

const isAdmin = (who) => Boolean(who && state.admins.has(who.user.id));

function rowsOf(table) {
  if (table === 'admins') return [...state.admins].map((user_id) => ({ user_id, created_at: '2026-01-01T00:00:00Z' }));
  return state.tables[table];
}

/** Lo que cada rol puede ver (políticas `*_public_read` y `admins_self_read`). */
function visibleRows(table, who) {
  const rows = rowsOf(table);
  if (table === 'admins') return rows.filter((row) => who && row.user_id === who.user.id);
  if (table === 'gigs' || table === 'mixes') return rows.filter((row) => row.published || isAdmin(who));
  return rows;
}

function parseValue(raw) {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

function venueKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function computed(table, row) {
  if (table !== 'gigs') return row;
  return { ...row, venue_key: venueKey(row.venue), party_key: venueKey(row.party_name) };
}

function matches(table, row, filters) {
  const full = computed(table, row);
  return filters.every(([column, op, raw]) => {
    const value = full[column];
    if (op === 'in') {
      const list = raw.replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, ''));
      return list.includes(String(value));
    }
    const target = parseValue(raw);
    switch (op) {
      case 'eq':
        return String(value) === String(target);
      case 'neq':
        return String(value) !== String(target);
      case 'gt':
        return compare(value, target) > 0;
      case 'gte':
        return compare(value, target) >= 0;
      case 'lt':
        return compare(value, target) < 0;
      case 'lte':
        return compare(value, target) <= 0;
      case 'is':
        return value === target;
      default:
        throw new Error(`Filtro no simulado: ${op}`);
    }
  });
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function parseFilters(url) {
  const filters = [];
  for (const [key, value] of url.searchParams) {
    if (RESERVED.has(key)) continue;
    const dot = value.indexOf('.');
    filters.push([key, value.slice(0, dot), value.slice(dot + 1)]);
  }
  return filters;
}

function project(table, row, select) {
  const full = computed(table, row);
  if (!select || select === '*') return { ...row };
  const out = {};
  for (const column of select.split(',').map((item) => item.trim()).filter(Boolean)) out[column] = full[column] ?? null;
  return out;
}

function applyOrder(rows, order) {
  if (!order) return rows;
  const keys = order.split(',').map((part) => {
    const [column, direction] = part.split('.');
    return { column, desc: direction === 'desc' };
  });
  return [...rows].sort((a, b) => {
    for (const { column, desc } of keys) {
      const result = compare(a[column], b[column]);
      if (result !== 0) return desc ? -result : result;
    }
    return 0;
  });
}

function prefer(request) {
  return String(request.headers.prefer ?? '');
}

function defaults(table, input, who) {
  const now = new Date().toISOString();
  if (table === 'gigs') {
    return {
      id: randomUUID(),
      party_name: null,
      lineup: [],
      ticket_url: null,
      published: true,
      created_at: now,
      ...input,
      updated_at: now,
      updated_by: who?.user.id ?? input.updated_by ?? null,
    };
  }
  if (table === 'mixes') {
    return {
      id: randomUUID(),
      subtitle: null,
      duration_seconds: null,
      artwork_url: null,
      published: false,
      sort_order: 0,
      created_at: now,
      ...input,
      updated_at: now,
      updated_by: who?.user.id ?? null,
    };
  }
  return { ...input };
}

/** Restricciones de §7.1: gigs_dedupe, mixes_audio_url_key, longitudes y https. */
function violation(table, row, others) {
  if (table === 'gigs') {
    if (!row.venue || !row.city || !row.event_date) return ['23502', 'null value violates not-null constraint'];
    if (row.ticket_url && !/^https:\/\//i.test(row.ticket_url)) return ['23514', 'gigs_ticket_url_check'];
    const key = (gig) => `${gig.event_date}|${venueKey(gig.venue)}|${venueKey(gig.party_name)}`;
    if (others.some((other) => other.id !== row.id && key(other) === key(row))) {
      return ['23505', 'duplicate key value violates unique constraint "gigs_dedupe"'];
    }
  }
  if (table === 'mixes' && others.some((other) => other.id !== row.id && other.audio_url === row.audio_url)) {
    return ['23505', 'duplicate key value violates unique constraint "mixes_audio_url_key"'];
  }
  if (table === 'site_settings' && [...String(row.ticker_text ?? '')].length > 500) {
    return ['23514', 'site_settings_ticker_text_check'];
  }
  return null;
}

async function handleRest(request, response, url, table) {
  if (!TABLES.has(table)) return pgError(response, 404, 'PGRST205', `Could not find the table 'public.${table}'`);
  if (!request.headers.apikey) return pgError(response, 401, 'PGRST301', 'No API key found in request');
  const who = requester(request);
  const filters = parseFilters(url);
  const select = url.searchParams.get('select');
  const wantsRows = prefer(request).includes('return=representation');

  if (table === 'admins' && !who) return pgError(response, 401, '42501', 'permission denied for table admins');
  if (table === 'admins' && request.method !== 'GET') return pgError(response, 403, '42501', 'permission denied for table admins');

  if (request.method === 'GET' || request.method === 'HEAD') {
    let rows = visibleRows(table, who).filter((row) => matches(table, row, filters));
    const total = rows.length;
    rows = applyOrder(rows, url.searchParams.get('order'));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : rows.length;
    rows = rows.slice(offset, offset + limit);
    const headers = {};
    if (prefer(request).includes('count=exact')) {
      headers['content-range'] = rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`;
    }
    return send(response, 200, rows.map((row) => project(table, row, select)), headers);
  }

  const body = await readBody(request);
  const rowsTable = state.tables[table];

  if (request.method === 'POST') {
    if (!who) return pgError(response, 401, '42501', `permission denied for table ${table}`);
    if (table === 'site_settings' || !isAdmin(who)) {
      return pgError(response, 403, '42501', `new row violates row-level security policy for table "${table}"`);
    }
    const inputs = Array.isArray(body) ? body : [body];
    const ignoreDuplicates = prefer(request).includes('resolution=ignore-duplicates');
    const created = [];
    const pending = [...rowsTable];
    for (const input of inputs) {
      const row = defaults(table, input, who);
      const problem = violation(table, row, pending);
      if (problem) {
        if (problem[0] === '23505' && ignoreDuplicates) continue;
        return pgError(response, 409, problem[0], problem[1]);
      }
      pending.push(row);
      created.push(row);
    }
    rowsTable.push(...created);
    return send(response, 201, wantsRows ? created.map((row) => project(table, row, select)) : undefined);
  }

  if (request.method === 'PATCH') {
    if (!who) return pgError(response, 401, '42501', `permission denied for table ${table}`);
    // RLS: quien no está en `admins` no ve filas que actualizar (0 filas, sin error).
    const targets = isAdmin(who) ? rowsTable.filter((row) => matches(table, row, filters)) : [];
    const updated = [];
    for (const row of targets) {
      const next = { ...row, ...body, updated_at: new Date().toISOString() };
      if ('updated_by' in row) next.updated_by = who.user.id;
      const problem = violation(table, next, rowsTable);
      if (problem) return pgError(response, problem[0] === '23505' ? 409 : 400, problem[0], problem[1]);
      updated.push([row, next]);
    }
    for (const [row, next] of updated) Object.assign(row, next);
    return send(response, 200, wantsRows ? updated.map(([, next]) => project(table, next, select)) : []);
  }

  if (request.method === 'DELETE') {
    if (!who) return pgError(response, 401, '42501', `permission denied for table ${table}`);
    const targets = isAdmin(who) ? rowsTable.filter((row) => matches(table, row, filters)) : [];
    state.tables[table] = rowsTable.filter((row) => !targets.includes(row));
    return send(response, 200, wantsRows ? targets.map((row) => project(table, row, select)) : []);
  }

  return pgError(response, 405, 'PGRST000', 'method not allowed');
}

// ------------------------------------------------------------------ e2e

async function handleE2e(request, response, path) {
  if (path === '/health') return send(response, 200, { ok: true });
  if (path === '/reset' && request.method === 'POST') {
    state = seed();
    return send(response, 200, { ok: true });
  }
  if (path === '/state' && request.method === 'GET') {
    return send(response, 200, {
      tables: state.tables,
      admins: [...state.admins],
      users: state.users.map(publicUser),
      log: state.log,
    });
  }
  return send(response, 404, { error: 'not-found' });
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  if (request.method === 'OPTIONS') return send(response, 204);
  const run = async () => {
    if (url.pathname.startsWith('/__e2e')) return handleE2e(request, response, url.pathname.slice('/__e2e'.length));
    if (url.pathname.startsWith('/auth/v1')) return handleAuth(request, response, url, url.pathname.slice('/auth/v1'.length));
    const rest = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (rest) return handleRest(request, response, url, rest[1]);
    return send(response, 404, { error: 'not-found', path: url.pathname });
  };
  run().catch((error) => {
    console.error('[mock-supabase]', error);
    send(response, 500, { code: 'XX000', message: String(error?.message ?? error) });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[e2e] Supabase simulado en http://127.0.0.1:${port}`);
});
