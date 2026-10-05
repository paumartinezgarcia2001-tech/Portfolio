/**
 * Widgets de SoundCloud e Instagram en contact (C17, D59).
 *
 * Los dos se ven nada más abrir contact (Luna ✓ 02-10-2026): el reproductor no
 * suena hasta que le dan al play, y las publicaciones se pintan solas. A cambio,
 * SoundCloud y Meta reciben la visita y pueden poner sus cookies en cuanto se
 * abre la página; está contado en /privacidad.
 *
 * Sin JavaScript quedan enlaces de verdad: el `blockquote` de cada publicación
 * lleva dentro su enlace, y `embed.js` lo sustituye por el embed cuando carga.
 *
 * Con `SOUNDCLOUD.eager: false` el reproductor vuelve a ser una fachada que no
 * carga nada hasta que se pulsa.
 */
import { INSTAGRAM_ORIGIN, SOUNDCLOUD_WIDGET_ORIGIN } from '../lib/security-headers';
import { SITE } from './site';

export { INSTAGRAM_ORIGIN, SOUNDCLOUD_WIDGET_ORIGIN };

/** Reproductor de SoundCloud (C17). */
export const SOUNDCLOUD = {
  /**
   * Qué se incrusta. **Vacío = el perfil entero** (Luna ✓ 02-10-2026: quiere el
   * feed del perfil), que es `SITE.social.soundcloud`.
   *
   * Para incrustar una pista suelta, pega aquí su URL: en SoundCloud, «Share»
   * → copia el enlace. También vale la forma
   * `https://api.soundcloud.com/tracks/<id>` que devuelve su oEmbed; la de la
   * única pista propia de Pau («VAYA PUTO CUADRO») es
   * `https://api.soundcloud.com/tracks/1670061867`.
   */
  trackUrl: '',
  /** Título que se ve en la fachada, antes de cargar nada (solo con `eager: false`). */
  trackTitle: 'travest15m0',
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
 * No hay forma de incrustar el perfil entero: el oEmbed de Meta rechaza las
 * URLs de perfil con un 400 («not embeddable»), y su API de feeds exige cuenta
 * profesional y un token que caduca cada 60 días. Lo más parecido es esta
 * selección de publicaciones.
 *
 * Para cambiarlas: en Instagram, en la publicación, «···» → «Copiar enlace», y
 * pega aquí la URL (vale con o sin los parámetros de detrás). Reels incluidos.
 * Con la lista vacía, en contact no aparece el apartado.
 */
export const INSTAGRAM_POSTS: readonly string[] = [
  // Las eligió Luna (02-10-2026). Tres, y van en una sola fila: si se añaden
  // más, la fila se desplaza en horizontal en vez de apilarlas.
  //
  // Ojo: una publicación borrada —o de una cuenta que se pone privada— deja de
  // poder incrustarse, y en su hueco queda solo el enlace. Pasó con
  // `DF3IBcjIiO5` (02-10-2026): Instagram responde «es posible que el enlace de
  // esta foto o video esté dañado, o que se haya eliminado la publicación», así
  // que se cambió por `DBjxR7uuDQ1`, la cuarta que había elegido Luna.
  'https://www.instagram.com/p/DRRYO_dDMPC/',
  'https://www.instagram.com/p/DR-gy3GCNQK/',
  'https://www.instagram.com/p/DBjxR7uuDQ1/',
];

/** Script del embed oficial (el origen ya está en la CSP, §11). */
export const INSTAGRAM_EMBED_SCRIPT = `${INSTAGRAM_ORIGIN}/embed.js`;

/** Versión del formato del embed que documenta Instagram. */
export const INSTAGRAM_EMBED_VERSION = '14';

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

/**
 * Textos de los dos apartados.
 *
 * Sin avisos de cookies debajo de cada widget (Luna ✓ 02-10-2026): los dos
 * llevan dentro los enlaces legales de SoundCloud y de Instagram, y lo que
 * hacen está explicado en /privacidad, que es donde toca.
 *
 * Debajo de cada widget va su enlace al perfil, con el nombre de la red a secas
 * y la flecha (Luna ✓ 02-10-2026); antes estaban los dos juntos al final de
 * contact.
 */
export const SOCIAL_TEXT = {
  soundcloud: {
    heading: 'escucha',
    /** Botón de la fachada (con JavaScript). Solo con `eager: false`. */
    load: 'cargar el reproductor',
    /** Enlace de la fachada (sin JavaScript). Solo con `eager: false`. */
    openLabel: 'escuchar en SoundCloud',
    frameTitle: 'Reproductor de SoundCloud',
    /** Debajo del reproductor, al perfil de SoundCloud. */
    profileLabel: 'soundcloud',
  },
  instagram: {
    heading: 'instagram',
    /** Enlace de cada publicación mientras no haya cargado el embed. */
    postLabel: (index: number) => `publicación ${index}`,
    /** Debajo de las publicaciones, al perfil de Instagram. */
    profileLabel: 'instagram',
    /**
     * Cuando el navegador no deja cargar `embed.js` (Brave con los escudos
     * puestos, bloqueadores de anuncios…). Va debajo de los marcos.
     */
    blocked: 'Tu navegador ha bloqueado las publicaciones de Instagram: ábrelas con su enlace.',
  },
} as const;
