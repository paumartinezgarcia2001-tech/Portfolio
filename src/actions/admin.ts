/**
 * Actions del panel oculto (C19): `admin.*`.
 *
 * - Todas, salvo `login`, exigen la sesión de una administradora
 *   (`requireAdmin`): sin ella responden `UNAUTHORIZED` y ningún dato.
 * - Escriben con la sesión de Pau y la clave publicable: las políticas RLS
 *   son la última barrera. La clave secreta de Supabase no se usa aquí.
 * - Tras cada escritura, purgan la caché de la web pública por etiquetas:
 *   todas las páginas llevan la barra (próxima fecha) y el reproductor.
 */
import { ActionError, defineAction } from 'astro:actions';
import { ADMIN_EMAIL, ADMIN_USERNAME } from 'astro:env/server';
import type { AstroCookies } from 'astro';
import { env } from 'cloudflare:workers';
import {
  ADMIN_LIMITS,
  ADMIN_TEXT as TEXT,
  MIX_ARTWORK_TYPES,
  MIX_AUDIO_TYPES,
  UPLOAD_URL_TTL,
} from '../config/admin';
import { CACHE_TAGS } from '../config/cache';
import { MEDIA_VIDEO } from '../config/media';
import { classifyAuthError, resolveLoginEmail } from '../lib/admin/access';
import { invalidatePublicCache, openAdminContext } from '../lib/admin/context';
import { allowLoginAttempt, waitUntilElapsed, type LoginRateLimiter } from '../lib/admin/login-guard';
import { isMixObjectKey, presignR2, uploadKey, type R2Credentials } from '../lib/admin/r2';
import { R2_MISSING, r2Credentials } from '../lib/admin/r2-config';
import { deleteObject, measureStorage, objectSize } from '../lib/admin/r2-usage';
import { fitsInStorage, noRoomMessage, type StorageStatus } from '../lib/admin/storage';
import {
  findDuplicates,
  gigBulkSchema,
  gigDeleteSchema,
  gigSchema,
  gigUpdateSchema,
  infoSchema,
  loginSchema,
  mixCreateSchema,
  mixDeleteSchema,
  mixUpdateSchema,
  mixUploadSchema,
  storageCheckSchema,
  themeRestoreSchema,
  themeSchema,
  tickerSchema,
  toGigWrite,
  venueKey,
  videoSchema,
  type ExistingGig,
  type GigWrite,
} from '../lib/admin/schemas';
import type { AdminSession } from '../lib/admin/session';
import { buildVideoConfig, parseStoredVideo, toStoredVideo } from '../lib/admin/video';
import { isDefaultTheme, toStoredTheme } from '../lib/theme';
import { formatEventDate } from '../lib/dates';
import { createSupabaseServerClient, isSupabaseConfigured, type TypedSupabaseClient } from '../lib/supabase/server';

interface RequestContext {
  request: Request;
  cookies: AstroCookies;
}

interface AuthorizedAdmin {
  supabase: TypedSupabaseClient;
  session: AdminSession;
}

/**
 * La petición tiene que venir de una administradora con sesión. Si no,
 * `UNAUTHORIZED` y ningún dato.
 */
async function requireAdmin(context: RequestContext): Promise<AuthorizedAdmin> {
  const { supabase, state } = await openAdminContext(context);
  if (!supabase || state.kind !== 'admin') {
    throw new ActionError({ code: 'UNAUTHORIZED', message: TEXT.sessionExpired });
  }
  return { supabase, session: state.session };
}

function saveFailed(label: string, error: { message?: string; code?: string } | null): never {
  console.warn(`[panel] ${label}: ${error?.code ?? ''} ${error?.message ?? 'sin detalle'}`);
  throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: TEXT.saveFailed });
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/** Resultado de guardar: el panel enseña `message` («Guardado.»). */
interface Saved {
  status: 'saved';
  message: string;
}

/** Aviso de duplicado (C19): el panel pregunta si se guarda igualmente. */
interface Duplicate {
  status: 'duplicate';
  message: string;
  duplicates: string[];
}

function saved(message: string = TEXT.saved): Saved {
  return { status: 'saved', message };
}

function describeGig(gig: ExistingGig): string {
  return `${formatEventDate(gig.event_date)} · ${gig.party_name || 'TBA'} · ${gig.venue}`;
}

/** Bolos de esas fechas en esa sala (para el aviso de duplicado). */
async function gigsAt(supabase: TypedSupabaseClient, dates: string[], venue: string): Promise<ExistingGig[]> {
  const { data, error } = await supabase
    .from('gigs')
    .select('id, event_date, party_name, venue')
    .in('event_date', dates)
    .eq('venue_key', venueKey(venue));
  if (error) saveFailed('comprobar duplicados', error);
  return data ?? [];
}

/** Binding de Rate Limiting del login (wrangler.jsonc); no existe en `astro dev` sin wrangler. */
function loginRateLimiter(): LoginRateLimiter | undefined {
  try {
    return (env as { LOGIN_RATE_LIMIT?: LoginRateLimiter }).LOGIN_RATE_LIMIT;
  } catch {
    return undefined;
  }
}

/** IP de quien intenta entrar (`CF-Connecting-IP` en Cloudflare). */
function clientIp(context: { clientAddress: string }): string | undefined {
  try {
    return context.clientAddress;
  } catch {
    return undefined;
  }
}

function requireR2(): R2Credentials {
  const credentials = r2Credentials();
  if (!credentials) throw new ActionError({ code: 'BAD_REQUEST', message: R2_MISSING });
  return credentials;
}

/**
 * Lo que ocupa R2 ahora mismo (D64). Si no se puede medir, no se sube nada:
 * sin medida no hay forma de saber si cabe.
 */
async function currentStorage(credentials: R2Credentials): Promise<StorageStatus> {
  try {
    return await measureStorage(credentials);
  } catch (error) {
    console.warn(`[panel] medir R2: ${(error as Error).message}`);
    throw new ActionError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'No se ha podido medir el espacio de R2, así que no se sube nada. Inténtalo en un rato.',
    });
  }
}

/** Respuesta de `storageUsage` (la barra del panel). */
export interface StorageReport {
  configured: boolean;
  status: StorageStatus | null;
  fits: boolean;
  message?: string;
}

/**
 * Tras subir (D64): los archivos nuevos de `mixes/` tienen que estar en R2,
 * no pasar del tamaño máximo y caber en el límite. Si algo falla, se borran
 * y no se crea el mix. Las rutas que no son de `mixes/` (URLs o archivos de
 * los scripts) no se comprueban.
 */
async function verifyUploads(keys: string[], audioKey: string): Promise<void> {
  const own = keys.filter((key) => isMixObjectKey(key));
  if (own.length === 0) return;
  const credentials = requireR2();
  const cleanUp = async (message: string): Promise<never> => {
    for (const key of own) await deleteObject(credentials, key);
    throw new ActionError({ code: 'BAD_REQUEST', message });
  };
  for (const key of own) {
    let size: number | null;
    try {
      size = await objectSize(credentials, key);
    } catch (error) {
      console.warn(`[panel] comprobar ${key}: ${(error as Error).message}`);
      throw new ActionError({ code: 'SERVICE_UNAVAILABLE', message: 'No se ha podido comprobar la subida en R2. Inténtalo de nuevo.' });
    }
    if (size === null) return cleanUp('El archivo no ha llegado a R2. Vuelve a subirlo.');
    const max = key === audioKey ? ADMIN_LIMITS.mixMaxBytes : ADMIN_LIMITS.artworkMaxBytes;
    if (size > max) return cleanUp(`El archivo subido pasa de ${Math.round(max / 1024 / 1024)} MB: se ha borrado.`);
  }
  const status = await currentStorage(credentials);
  if (status.level === 'full' && status.usedBytes > status.limitBytes) {
    return cleanUp(`Con esto R2 pasaría de ${Math.round(status.limitBytes / 1e9)} GB: se ha borrado la subida.`);
  }
}

export const admin = {
  // ------------------------------------------------------------------ acceso
  login: defineAction({
    accept: 'form',
    input: loginSchema,
    handler: async (input, context) => {
      if (!isSupabaseConfigured()) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: TEXT.notConfigured });
      const startedAt = Date.now();
      // Todo fallo tarda lo mismo (src/lib/admin/login-guard.ts).
      const failed = async () => {
        await waitUntilElapsed(startedAt);
        return new ActionError({ code: 'UNAUTHORIZED', message: TEXT.loginFailed });
      };

      // 5 intentos por minuto y por IP, antes de preguntar nada a Supabase.
      if (!(await allowLoginAttempt(loginRateLimiter(), clientIp(context)))) {
        throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: TEXT.tooManyAttempts });
      }

      const email = resolveLoginEmail(input.usuario, { username: ADMIN_USERNAME, email: ADMIN_EMAIL });
      if (!email) throw await failed();

      const { supabase } = createSupabaseServerClient(context);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: input.password });
      if (error || !data.user) {
        const kind = error ? classifyAuthError(error) : 'credentials';
        if (kind === 'rate-limit') throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: TEXT.tooManyAttempts });
        if (kind === 'unavailable') saveFailed('login', error);
        throw await failed();
      }

      // Una cuenta que no está en `admins` no entra (y no se le dice por qué).
      const { data: row } = await supabase.from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
      if (!row) {
        await supabase.auth.signOut({ scope: 'local' });
        throw await failed();
      }

      return { status: 'signed-in' as const };
    },
  }),

  logout: defineAction({
    accept: 'form',
    handler: async (_input, context) => {
      if (!isSupabaseConfigured()) return { status: 'signed-out' as const };
      const { supabase } = createSupabaseServerClient(context);
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      return { status: 'signed-out' as const };
    },
  }),

  // ------------------------------------------------------ barra de noticias
  updateTicker: defineAction({
    accept: 'form',
    input: tickerSchema,
    handler: async (input, context) => {
      const { supabase, session } = await requireAdmin(context);
      const { data, error } = await supabase
        .from('site_settings')
        .update({ ticker_text: input.texto, ticker_append_next_gig: input.proximaFecha, updated_by: session.userId })
        .eq('id', 1)
        .select('id');
      if (error || !data?.length) saveFailed('guardar la barra', error);
      await invalidatePublicCache(context, [CACHE_TAGS.settings]);
      return saved();
    },
  }),

  // ------------------------------------------------------------------ bolos
  createGig: defineAction({
    accept: 'form',
    input: gigSchema,
    handler: async (input, context): Promise<Saved | Duplicate> => {
      const { supabase, session } = await requireAdmin(context);
      const row = toGigWrite(input.fecha, input);
      const report = findDuplicates(await gigsAt(supabase, [row.event_date], row.venue), [row]);
      if (report.exact.length > 0) throw new ActionError({ code: 'CONFLICT', message: TEXT.exactDuplicate });
      if (report.sameVenue.length > 0 && !input.forzar) {
        return { status: 'duplicate', message: TEXT.duplicate, duplicates: report.sameVenue.map(describeGig) };
      }
      const { error } = await supabase.from('gigs').insert({ ...row, updated_by: session.userId });
      if (isUniqueViolation(error)) throw new ActionError({ code: 'CONFLICT', message: TEXT.exactDuplicate });
      if (error) saveFailed('crear bolo', error);
      await invalidatePublicCache(context, [CACHE_TAGS.gigs]);
      return saved();
    },
  }),

  createGigsBulk: defineAction({
    accept: 'form',
    input: gigBulkSchema,
    handler: async (input, context): Promise<Saved | Duplicate> => {
      const { supabase, session } = await requireAdmin(context);
      const rows: GigWrite[] = input.fechas.map((date) => toGigWrite(date, input));
      const report = findDuplicates(await gigsAt(supabase, input.fechas, input.sala), rows);
      const clashes = [...report.exact, ...report.sameVenue];
      if (clashes.length > 0 && !input.forzar) {
        return {
          status: 'duplicate',
          message: TEXT.duplicateBulk,
          duplicates: clashes.sort((a, b) => a.event_date.localeCompare(b.event_date)).map(describeGig),
        };
      }
      // Las fechas en las que ya está exactamente este bolo se saltan.
      const exactDates = new Set(report.exact.map((gig) => gig.event_date));
      const toInsert = rows.filter((row) => !exactDates.has(row.event_date)).map((row) => ({ ...row, updated_by: session.userId }));
      if (toInsert.length > 0) {
        const { error } = await supabase
          .from('gigs')
          .upsert(toInsert, { onConflict: 'event_date,venue_key,party_key', ignoreDuplicates: true });
        if (error) saveFailed('crear bolos', error);
        await invalidatePublicCache(context, [CACHE_TAGS.gigs]);
      }
      const skipped = rows.length - toInsert.length;
      const count = `${toInsert.length} ${toInsert.length === 1 ? 'fecha' : 'fechas'}`;
      return saved(
        skipped > 0
          ? `${TEXT.saved} ${count} (${skipped} ya ${skipped === 1 ? 'existía' : 'existían'}).`
          : `${TEXT.saved} ${count}.`,
      );
    },
  }),

  updateGig: defineAction({
    accept: 'form',
    input: gigUpdateSchema,
    handler: async (input, context): Promise<Saved | Duplicate> => {
      const { supabase, session } = await requireAdmin(context);
      const row = toGigWrite(input.fecha, input);
      const report = findDuplicates(await gigsAt(supabase, [row.event_date], row.venue), [row], input.id);
      if (report.exact.length > 0) throw new ActionError({ code: 'CONFLICT', message: TEXT.exactDuplicate });
      if (report.sameVenue.length > 0 && !input.forzar) {
        return { status: 'duplicate', message: TEXT.duplicate, duplicates: report.sameVenue.map(describeGig) };
      }
      const { data, error } = await supabase
        .from('gigs')
        .update({ ...row, updated_by: session.userId })
        .eq('id', input.id)
        .select('id');
      if (isUniqueViolation(error)) throw new ActionError({ code: 'CONFLICT', message: TEXT.exactDuplicate });
      if (error) saveFailed('editar bolo', error);
      if (!data?.length) throw new ActionError({ code: 'NOT_FOUND', message: 'Ese bolo ya no existe.' });
      await invalidatePublicCache(context, [CACHE_TAGS.gigs]);
      return saved();
    },
  }),

  deleteGig: defineAction({
    accept: 'form',
    input: gigDeleteSchema,
    handler: async (input, context) => {
      const { supabase } = await requireAdmin(context);
      const { data, error } = await supabase.from('gigs').delete().eq('id', input.id).select('id');
      if (error) saveFailed('borrar bolo', error);
      if (!data?.length) throw new ActionError({ code: 'NOT_FOUND', message: 'Ese bolo ya no existe.' });
      await invalidatePublicCache(context, [CACHE_TAGS.gigs]);
      return saved(TEXT.deleted);
    },
  }),

  // ------------------------------------------------------------ Info
  updateInfo: defineAction({
    accept: 'form',
    input: infoSchema,
    handler: async (input, context) => {
      const { supabase, session } = await requireAdmin(context);
      const markdown = input.restaurar ? null : input.markdown || null;
      const { data, error } = await supabase
        .from('site_settings')
        .update({ info_markdown: markdown, updated_by: session.userId })
        .eq('id', 1)
        .select('id');
      if (error || !data?.length) saveFailed('guardar info', error);
      await invalidatePublicCache(context, [CACHE_TAGS.settings]);
      return saved(input.restaurar ? 'Vuelve a estar el texto original.' : TEXT.saved);
    },
  }),

  // ------------------------------------------------------------ vídeo
  updateVideo: defineAction({
    accept: 'form',
    input: videoSchema,
    handler: async (input, context) => {
      const { supabase, session } = await requireAdmin(context);
      let video: Record<string, unknown> | null = null;
      if (!input.restaurar) {
        const { data: current, error: readError } = await supabase.from('site_settings').select('video').eq('id', 1).maybeSingle();
        if (readError) saveFailed('leer el vídeo', readError);
        video = toStoredVideo(buildVideoConfig(input, parseStoredVideo(current?.video) ?? MEDIA_VIDEO));
      }
      const { data, error } = await supabase
        .from('site_settings')
        .update({ video: video as never, updated_by: session.userId })
        .eq('id', 1)
        .select('id');
      if (error || !data?.length) saveFailed('guardar el vídeo', error);
      await invalidatePublicCache(context, [CACHE_TAGS.settings]);
      return saved(input.restaurar ? 'Vuelve a estar el vídeo del código.' : TEXT.saved);
    },
  }),

  // -------------------------------------------- colores (Luna, 06-10-2026)
  updateTheme: defineAction({
    accept: 'form',
    input: themeSchema,
    handler: async (input, context) => {
      const { supabase, session } = await requireAdmin(context);
      const { reproductorSigueSeccion, ...colors } = input;
      const theme = { ...colors, playerFollowsSection: reproductorSigueSeccion };
      // Si coincide con los del código, se guarda vacío (la web usa tokens.css).
      const stored = isDefaultTheme(theme) ? null : toStoredTheme(theme);
      const { data, error } = await supabase
        .from('site_settings')
        .update({ theme: stored as never, updated_by: session.userId })
        .eq('id', 1)
        .select('id');
      if (error || !data?.length) saveFailed('guardar los colores', error);
      await invalidatePublicCache(context, [CACHE_TAGS.settings]);
      return saved();
    },
  }),

  resetTheme: defineAction({
    accept: 'form',
    input: themeRestoreSchema,
    handler: async (_input, context) => {
      const { supabase, session } = await requireAdmin(context);
      const { data, error } = await supabase
        .from('site_settings')
        .update({ theme: null, updated_by: session.userId })
        .eq('id', 1)
        .select('id');
      if (error || !data?.length) saveFailed('restaurar los colores', error);
      await invalidatePublicCache(context, [CACHE_TAGS.settings]);
      return saved('Vuelven a estar los colores originales.');
    },
  }),

  // ------------------------------------------------------------ mixes
  /** Lo que ocupa R2 (la barra de todas las páginas) y, con `bytes`, si eso cabe. */
  storageUsage: defineAction({
    accept: 'form',
    input: storageCheckSchema,
    handler: async (input, context): Promise<StorageReport> => {
      await requireAdmin(context);
      const credentials = r2Credentials();
      if (!credentials) return { configured: false, status: null, fits: false, message: R2_MISSING };
      let status: StorageStatus;
      try {
        status = await currentStorage(credentials);
      } catch (error) {
        return { configured: true, status: null, fits: false, message: (error as ActionError).message };
      }
      const bytes = input.bytes ?? 0;
      const fits = fitsInStorage(status, bytes);
      return { configured: true, status, fits, ...(fits ? {} : { message: noRoomMessage(status, bytes) }) };
    },
  }),

  mixUploadUrl: defineAction({
    accept: 'form',
    input: mixUploadSchema,
    handler: async (input, context) => {
      await requireAdmin(context);
      const credentials = requireR2();
      const types: Record<string, string> = input.tipo === 'audio' ? MIX_AUDIO_TYPES : MIX_ARTWORK_TYPES;
      const ext = types[input.contentType];
      if (!ext) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: input.tipo === 'audio' ? 'El audio tiene que ser MP3 o M4A.' : 'La carátula tiene que ser JPG, WebP o PNG.',
        });
      }
      const max = input.tipo === 'audio' ? ADMIN_LIMITS.mixMaxBytes : ADMIN_LIMITS.artworkMaxBytes;
      if (input.size > max) {
        throw new ActionError({ code: 'BAD_REQUEST', message: `El archivo pasa de ${Math.round(max / 1024 / 1024)} MB.` });
      }
      // D64: antes de firmar nada, se mide R2 de nuevo y se comprueba que cabe
      // lo de esta tanda (el audio y, si viene, la carátula).
      const status = await currentStorage(credentials);
      const incoming = input.size + (input.reserva ?? 0);
      if (!fitsInStorage(status, incoming)) {
        throw new ActionError({ code: 'CONFLICT', message: noRoomMessage(status, incoming) });
      }
      const key = uploadKey(input.tipo === 'audio' ? input.titulo : `${input.titulo} caratula`, ext);
      // El tipo va firmado: R2 rechaza la subida si el navegador manda otro.
      const url = await presignR2(credentials, 'PUT', key, UPLOAD_URL_TTL, {
        headers: { 'content-type': input.contentType },
      });
      return {
        key,
        url,
        headers: { 'Content-Type': input.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
        status,
      };
    },
  }),

  createMix: defineAction({
    accept: 'form',
    input: mixCreateSchema,
    handler: async (input, context) => {
      const { supabase } = await requireAdmin(context);
      await verifyUploads(
        [input.audio, input.caratula].filter((key): key is string => Boolean(key)),
        input.audio,
      );
      const { error } = await supabase.from('mixes').insert({
        title: input.titulo,
        subtitle: input.subtitulo || null,
        audio_url: input.audio,
        artwork_url: input.caratula || null,
        duration_seconds: input.duracion ?? null,
        sort_order: input.orden ?? 0,
        published: input.publicado,
      });
      if (isUniqueViolation(error)) throw new ActionError({ code: 'CONFLICT', message: 'Ese archivo ya está en otro mix.' });
      if (error) saveFailed('crear mix', error);
      await invalidatePublicCache(context, [CACHE_TAGS.mixes]);
      return saved();
    },
  }),

  updateMix: defineAction({
    accept: 'form',
    input: mixUpdateSchema,
    handler: async (input, context) => {
      const { supabase } = await requireAdmin(context);
      const changes: {
        title: string;
        subtitle: string | null;
        sort_order: number;
        published: boolean;
        artwork_url?: string | null;
      } = {
        title: input.titulo,
        subtitle: input.subtitulo || null,
        sort_order: input.orden ?? 0,
        published: input.publicado,
      };
      if (input.quitarCaratula) changes.artwork_url = null;
      else if (input.caratula) changes.artwork_url = input.caratula;
      const { data, error } = await supabase.from('mixes').update(changes).eq('id', input.id).select('id');
      if (error) saveFailed('editar mix', error);
      if (!data?.length) throw new ActionError({ code: 'NOT_FOUND', message: 'Ese mix ya no existe.' });
      await invalidatePublicCache(context, [CACHE_TAGS.mixes]);
      return saved();
    },
  }),

  deleteMix: defineAction({
    accept: 'form',
    input: mixDeleteSchema,
    handler: async (input, context) => {
      const { supabase } = await requireAdmin(context);
      const { data, error } = await supabase
        .from('mixes')
        .delete()
        .eq('id', input.id)
        .select('audio_url, artwork_url');
      if (error) saveFailed('borrar mix', error);
      const row = data?.[0];
      if (!row) throw new ActionError({ code: 'NOT_FOUND', message: 'Ese mix ya no existe.' });
      await invalidatePublicCache(context, [CACHE_TAGS.mixes]);

      // Los archivos subidos por el panel o por scripts/add-mix.mjs (mixes/…).
      const credentials = r2Credentials();
      let filesLeft = false;
      if (input.borrarArchivos) {
        const keys = [row.audio_url, row.artwork_url].filter((key): key is string => Boolean(key && isMixObjectKey(key)));
        if (credentials) {
          for (const key of keys) {
            if (!(await deleteObject(credentials, key))) filesLeft = true;
          }
        } else if (keys.length > 0) {
          filesLeft = true;
        }
      }
      return saved(filesLeft ? `${TEXT.deleted} El archivo sigue en R2: bórralo desde Cloudflare.` : TEXT.deleted);
    },
  }),
};
