/**
 * Widgets de SoundCloud e Instagram en contact (C17, D59).
 *
 * **Instagram** se carga solo si alguien lo pide: lo que se sirve es una
 * fachada con enlaces de verdad (lo que funciona sin JavaScript) y los embeds
 * llegan al pulsar el botón. Así Meta no recibe ninguna visita ni pone cookies
 * mientras nadie se lo pida.
 *
 * **SoundCloud** va puesto desde el principio (`SOUNDCLOUD.eager`, Luna ✓
 * 02-10-2026): se ve el reproductor nada más abrir contact, aunque no suena
 * hasta que le dan al play. A cambio, SoundCloud sí recibe la visita y puede
 * poner sus cookies en cuanto se abre la página; está contado en /privacidad.
 * Poniendo `eager: false` se vuelve a la fachada y no se carga nada hasta que
 * se pulsa.
 */
import { INSTAGRAM_ORIGIN, SOUNDCLOUD_WIDGET_ORIGIN } from '../lib/security-headers';
import { SITE } from './site';

export { INSTAGRAM_ORIGIN, SOUNDCLOUD_WIDGET_ORIGIN };

/** Reproductor de SoundCloud (C17). */
export const SOUNDCLOUD = {
  /**
   * Qué se incrusta. Una pista concreta (Luna ✓ 02-10-2026: el perfil solo
   * tiene un audio propio y se vería vacío) o, si se deja vacío, el perfil
   * entero.
   *
   * La forma `https://api.soundcloud.com/tracks/<id>` es la que devuelve el
   * oEmbed de SoundCloud para esa pista; vale igual la URL normal de la pista.
   * Para cambiarla: en SoundCloud, «Share» → copia el enlace y pégalo aquí.
   */
  trackUrl: 'https://api.soundcloud.com/tracks/1670061867',
  /** Título que se ve en la fachada, antes de cargar nada. */
  trackTitle: 'VAYA PUTO CUADRO',
  /**
   * `visual`: el reproductor grande, con la carátula de fondo y la cabecera de
   * artista (es el que se parece a la aplicación). El clásico es una fila baja.
   */
  visual: true,
  /** Alto del reproductor visual, en píxeles (SoundCloud ofrece 300, 450 y 600). */
  height: 450,
  /**
   * `true` = el reproductor ya está puesto al abrir contact (Luna ✓
   * 02-10-2026). Nunca arranca solo: hay que darle al play, y además la web ya
   * tiene su propia música sonando (D43).
   *
   * `false` = fachada: un enlace a SoundCloud y, al pulsarlo, el reproductor
   * sonando. Con `false`, SoundCloud no se entera de la visita hasta ese clic.
   */
  eager: true,
} as const;

/** API de JavaScript del widget (el origen ya está en la CSP, §11). */
export const SOUNDCLOUD_WIDGET_API = `${SOUNDCLOUD_WIDGET_ORIGIN}/player/api.js`;

/**
 * URL del iframe del reproductor.
 *
 * `auto_play` se pone a `true` solo al cargarlo desde la fachada: quien pulsa
 * «escuchar» quiere oírlo, y así no hace falta un segundo clic. Nunca se pinta
 * el iframe de entrada, así que nunca suena nada sin pedirlo.
 */
export function soundcloudPlayerUrl(options: { autoPlay?: boolean } = {}): string {
  const url = new URL(`${SOUNDCLOUD_WIDGET_ORIGIN}/player/`);
  url.searchParams.set('url', SOUNDCLOUD.trackUrl || SITE.social.soundcloud);
  url.searchParams.set('visual', String(SOUNDCLOUD.visual));
  url.searchParams.set('show_artwork', 'true');
  url.searchParams.set('show_user', 'true');
  url.searchParams.set('auto_play', String(options.autoPlay ?? false));
  // Nada de comentarios ni de pistas recomendadas de otra gente.
  url.searchParams.set('show_comments', 'false');
  url.searchParams.set('hide_related', 'true');
  return url.href;
}

/**
 * Publicaciones de Instagram que se destacan en contact, por su URL.
 *
 * Se incrustan con el código oficial de Instagram (`blockquote` +
 * `embed.js`), que desde junio de 2026 no necesita token ni revisión de la app.
 * Solo funciona con **publicaciones públicas**.
 *
 * Para cambiarlas: en Instagram, en la publicación, «···» → «Copiar enlace», y
 * pega aquí la URL (vale con o sin los parámetros de detrás). Reels incluidos.
 * Con la lista vacía, en contact no aparece el apartado.
 */
export const INSTAGRAM_POSTS: readonly string[] = [
  // Las eligió Luna (02-10-2026).
  'https://www.instagram.com/p/DF3IBcjIiO5/',
  'https://www.instagram.com/p/DRRYO_dDMPC/',
  'https://www.instagram.com/p/DR-gy3GCNQK/',
  'https://www.instagram.com/p/DBjxR7uuDQ1/',
];

/** Script del embed oficial (el origen ya está en la CSP, §11). */
export const INSTAGRAM_EMBED_SCRIPT = `${INSTAGRAM_ORIGIN}/embed.js`;

/**
 * Normaliza la URL de una publicación: `https://www.instagram.com/p/<código>/`,
 * sin parámetros de seguimiento (`?igsh=…`, `?utm_source=…`). Devuelve
 * `undefined` si no parece una publicación de Instagram, para no pintar basura.
 */
export function instagramPostUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (!/(^|\.)instagram\.com$/.test(url.hostname)) return undefined;
  // /p/<código>/ (publicación), /reel/<código>/ y /tv/<código>/ (vídeo).
  const match = /^\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (!match) return undefined;
  return `${INSTAGRAM_ORIGIN}/${match[1]}/${match[2]}/`;
}

/** Las publicaciones válidas de INSTAGRAM_POSTS, sin repetidas. */
export function instagramPosts(): string[] {
  const seen = new Set<string>();
  for (const raw of INSTAGRAM_POSTS) {
    const url = instagramPostUrl(raw);
    if (url) seen.add(url);
  }
  return [...seen];
}

/** Textos de los dos apartados. */
export const SOCIAL_TEXT = {
  soundcloud: {
    heading: 'escucha',
    /** Botón de la fachada (con JavaScript). Solo con `eager: false`. */
    load: 'cargar el reproductor',
    /** Enlace de la fachada (sin JavaScript) y texto del aviso. */
    openLabel: 'escuchar en SoundCloud',
    loading: 'cargando el reproductor…',
    frameTitle: 'Reproductor de SoundCloud',
    /** Debajo del reproductor, en el tamaño más pequeño de la web. */
    notice: 'El reproductor es de SoundCloud, que puede usar sus propias cookies.',
  },
  instagram: {
    heading: 'instagram',
    load: 'ver las publicaciones aquí',
    loading: 'cargando las publicaciones…',
    failed: 'No se han podido cargar. Ábrelas en Instagram.',
    notice: 'Las publicaciones se cargan desde Instagram, que puede usar cookies.',
    /** Para el enlace de cada publicación sin JavaScript: «publicación 1», etc. */
    postLabel: (index: number) => `publicación ${index}`,
  },
} as const;
