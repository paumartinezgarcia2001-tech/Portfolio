/**
 * Cabeceras de seguridad (§11), las mismas para toda la web.
 *
 * Tienen que ser idénticas en todas las páginas: con el ClientRouter, la web
 * no vuelve a cargar el documento al navegar, así que la CSP de la primera
 * página que se abre es la que manda en todas las demás. Si la de Info no
 * dejara cargar Turnstile, el formulario fallaría al llegar a contact desde el
 * menú; si la de contact no dejara cargar el vídeo, fallaría Media.
 *
 * Dónde se aplican:
 * - respuestas del Worker (páginas, 404 y Actions): src/middleware.ts;
 * - archivos estáticos (páginas prerenderizadas, como las legales): `_headers`,
 *   que escribe la integración de astro.config.mjs al compilar.
 *
 * La CSP de Astro (`security.csp`) no sirve aquí: no es compatible con el
 * ClientRouter. Tampoco se puede usar en GitHub Pages (no deja poner
 * cabeceras); allí la web es provisional (D37).
 */

/** Turnstile: su script y el iframe del widget (C17). */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export interface SecurityHeadersOptions {
  /** PUBLIC_MEDIA_BASE_URL: vídeo (HLS), mixes y pósters (R2). */
  mediaBaseUrl?: string | undefined;
  /** PUBLIC_SUPABASE_URL (por si el navegador llega a hablar con Supabase). */
  supabaseUrl?: string | undefined;
  /**
   * Orígenes extra para `connect-src`. Solo el panel (fase 6, sin
   * ClientRouter, así que puede tener su propia CSP): la subida directa de
   * mixes al endpoint S3 de R2.
   */
  connectSources?: Array<string | undefined> | undefined;
}

/** Origen (`https://host[:puerto]`) de una URL, o `undefined` si no es válida. */
export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

export function buildContentSecurityPolicy(options: SecurityHeadersOptions = {}): string {
  const media = originOf(options.mediaBaseUrl);
  const supabase = originOf(options.supabaseUrl);
  const directives: Array<[string, Array<string | undefined>]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", TURNSTILE_ORIGIN]],
    // Astro mete estilos en línea (hojas pequeñas, `style=""`, transiciones).
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', media]],
    ['font-src', ["'self'"]],
    // hls.js reproduce desde `blob:` (Media Source Extensions).
    ['media-src', ["'self'", 'blob:', media]],
    ['connect-src', ["'self'", media, supabase, ...(options.connectSources ?? []).map(originOf)]],
    ['frame-src', [TURNSTILE_ORIGIN]],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives
    .map(([name, sources]) => `${name} ${[...new Set(sources.filter(Boolean))].join(' ')}`)
    .join('; ');
}

/** Funciones del navegador que la web no usa. Autoplay y pantalla completa, sí. */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()';

export function buildSecurityHeaders(options: SecurityHeadersOptions = {}): Record<string, string> {
  return {
    'Content-Security-Policy': buildContentSecurityPolicy(options),
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': PERMISSIONS_POLICY,
  };
}

/** Añade las cabeceras a una respuesta (si sus cabeceras son inmutables, la copia). */
export function withSecurityHeaders(response: Response, headers: Record<string, string>): Response {
  try {
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
    return copy;
  }
}

/**
 * Bloque para el archivo `_headers` de Cloudflare (archivos estáticos): una
 * regla para todo, con las mismas cabeceras.
 */
export function buildHeadersFileBlock(headers: Record<string, string>): string {
  return ['/*', ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)].join('\n') + '\n';
}
