/**
 * Actions del panel oculto (C19, fase 6): `admin.*`.
 *
 * - Todas, salvo `login`, exigen la sesión de una administradora
 *   (`requireAdmin`): sin ella responden `UNAUTHORIZED` y ningún dato.
 * - Escriben con la sesión de Pau y la clave publicable: las políticas RLS
 *   (§7.2) son la última barrera. La clave secreta de Supabase no se usa aquí.
 * - Tras cada escritura, purgan la caché de la web pública por etiquetas
 *   (§6): todas las páginas llevan la barra (próxima fecha) y el reproductor.
 * - Solo funcionan con servidor (Cloudflare). En el build estático de GitHub
 *   Pages no hay Actions (astro.config.pages.mjs).
 */
import { ActionError, defineAction } from 'astro:actions';
import { PUBLIC_TURNSTILE_SITE_KEY } from 'astro:env/client';
import {
  ADMIN_EMAIL,
  ADMIN_USERNAME,
  R2_ACCESS_KEY_ID,
  R2_ACCOUNT_ID,
  R2_BUCKET,
  R2_SECRET_ACCESS_KEY,
} from 'astro:env/server';
import type { AstroCookies } from 'astro';
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
import { isMixObjectKey, presignR2, uploadKey, type R2Credentials } from '../lib/admin/r2';
import {
  findDuplicates,
  gigBulkSchema,
  gigDeleteSchema,
  gigSchema,
  gigUpdateSchema,
  infoSchema,
  loginSchema,
  mfaCodeSchema,
  mixCreateSchema,
  mixDeleteSchema,
  mixUpdateSchema,
  mixUploadSchema,
  tickerSchema,
  toGigWrite,
  venueKey,
  videoSchema,
  type ExistingGig,
  type GigWrite,
} from '../lib/admin/schemas';
import type { AdminSession } from '../lib/admin/session';
import { buildVideoConfig, parseStoredVideo, toStoredVideo } from '../lib/admin/video';
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
 * La petición tiene que venir de una administradora con la sesión completa
 * (con TOTP, si lo tiene). Si no, `UNAUTHORIZED` y ningún dato.
 */
async function requireAdmin(context: RequestContext, options: { allowPendingMfa?: boolean } = {}): Promise<AuthorizedAdmin> {
  const { supabase, state } = await openAdminContext(context);
  if (!supabase || state.kind !== 'admin' || (state.session.needsMfa && !options.allowPendingMfa)) {
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

function r2Credentials(): R2Credentials | null {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return { accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET };
}

export const admin = {
  // ------------------------------------------------------------------ acceso
  login: defineAction({
    accept: 'form',
    input: loginSchema,
    handler: async (input, context) => {
      if (!isSupabaseConfigured()) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: TEXT.notConfigured });
      const captchaToken = input['cf-turnstile-response']?.trim() || undefined;
      if (PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) {
        throw new ActionError({ code: 'BAD_REQUEST', message: TEXT.captchaMissing });
      }
      const failed = () => new ActionError({ code: 'UNAUTHORIZED', message: TEXT.loginFailed });

      const email = resolveLoginEmail(input.usuario, { username: ADMIN_USERNAME, email: ADMIN_EMAIL });
      if (!email) throw failed();

      const { supabase } = createSupabaseServerClient(context);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: input.password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      if (error || !data.user) {
        const kind = error ? classifyAuthError(error) : 'credentials';
        if (kind === 'captcha') throw new ActionError({ code: 'BAD_REQUEST', message: TEXT.captchaFailed });
        if (kind === 'rate-limit') throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: TEXT.tooManyAttempts });
        if (kind === 'unavailable') saveFailed('login', error);
        throw failed();
      }

      // Una cuenta que no está en `admins` no entra (y no se le dice por qué).
      const { data: row } = await supabase.from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
      if (!row) {
        await supabase.auth.signOut({ scope: 'local' });
        throw failed();
      }

      return { status: 'signed-in' as const, mfa: data.user.factors?.some((factor) => factor.status === 'verified') ?? false };
    },
  }),

  verifyMfa: defineAction({
    accept: 'form',
    input: mfaCodeSchema,
    handler: async (input, context) => {
      const { supabase } = await requireAdmin(context, { allowPendingMfa: true });
      const { data: factors, error } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp.find((item) => item.status === 'verified');
      if (error || !factor) throw new ActionError({ code: 'BAD_REQUEST', message: TEXT.mfaFailed });
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: input.codigo });
      if (verifyError) throw new ActionError({ code: 'BAD_REQUEST', message: TEXT.mfaFailed });
      return { status: 'signed-in' as const, mfa: false };
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

  // ----------------------------------------------------------- MFA (TOTP)
  mfaEnroll: defineAction({
    accept: 'form',
    handler: async (_input, context) => {
      const { supabase } = await requireAdmin(context);
      // Los intentos a medias (sin verificar) estorban: se quitan antes.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const factor of factors?.all ?? []) {
        if (factor.factor_type === 'totp' && factor.status !== 'verified') {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `panel ${Date.now()}` });
      if (error || !data) saveFailed('activar TOTP', error);
      // supabase-js devuelve `data:image/svg+xml;utf-8,<svg…>` sin codificar: un «#» del
      // SVG cortaría la URL. Se vuelve a codificar para el <img>.
      const svg = data.totp.qr_code.replace(/^data:image\/svg\+xml;[^,]*,/, '');
      const qr = svg.startsWith('<') ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : data.totp.qr_code;
      return { factorId: data.id, qr, secret: data.totp.secret };
    },
  }),

  mfaConfirm: defineAction({
    accept: 'form',
    input: mfaCodeSchema,
    handler: async (input, context) => {
      const { supabase } = await requireAdmin(context);
      if (!input.factorId) throw new ActionError({ code: 'BAD_REQUEST', message: TEXT.mfaFailed });
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: input.factorId, code: input.codigo });
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: TEXT.mfaFailed });
      return saved('Verificación en dos pasos activada.');
    },
  }),

  mfaRemove: defineAction({
    accept: 'form',
    handler: async (_input, context) => {
      const { supabase } = await requireAdmin(context);
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const factor of factors?.all ?? []) {
        if (factor.factor_type !== 'totp') continue;
        const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (error) saveFailed('quitar TOTP', error);
      }
      await supabase.auth.refreshSession();
      return saved('Verificación en dos pasos desactivada.');
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

  // ------------------------------------------------------------ Info (P2)
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

  // ------------------------------------------------------------ vídeo (P2)
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

  // ------------------------------------------------------------ mixes (P2)
  mixUploadUrl: defineAction({
    accept: 'form',
    input: mixUploadSchema,
    handler: async (input, context) => {
      await requireAdmin(context);
      const credentials = r2Credentials();
      if (!credentials) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'Falta configurar R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET).',
        });
      }
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
      const key = uploadKey(input.tipo === 'audio' ? input.titulo : `${input.titulo} caratula`, ext);
      const url = await presignR2(credentials, 'PUT', key, UPLOAD_URL_TTL);
      return {
        key,
        url,
        headers: { 'Content-Type': input.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
      };
    },
  }),

  createMix: defineAction({
    accept: 'form',
    input: mixCreateSchema,
    handler: async (input, context) => {
      const { supabase } = await requireAdmin(context);
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
            try {
              const url = await presignR2(credentials, 'DELETE', key, 60);
              const response = await fetch(url, { method: 'DELETE' });
              if (!response.ok && response.status !== 404) filesLeft = true;
            } catch {
              filesLeft = true;
            }
          }
        } else if (keys.length > 0) {
          filesLeft = true;
        }
      }
      return saved(filesLeft ? `${TEXT.deleted} El archivo sigue en R2: bórralo desde Cloudflare.` : TEXT.deleted);
    },
  }),
};
