/**
 * C17 · `<instagram-posts>` — publicaciones destacadas de Instagram (D59).
 *
 * Los `blockquote` del embed oficial ya vienen del servidor, cada uno con su
 * enlace dentro; esto solo carga `embed.js`, que es quien los convierte en las
 * publicaciones de verdad. Si no carga (o si la cuenta se pone privada o
 * desactiva los embeds), se quedan los enlaces, que funcionan igual.
 *
 * El embed oficial no necesita token ni revisión de la app desde junio de 2026,
 * pero solo vale para **publicaciones públicas**.
 *
 * Cuando una publicación concreta no se puede incrustar —borrada, o de una
 * cuenta que se ha puesto privada—, `embed.js` deja a medias lo suyo: mete un
 * iframe vacío (de alto 0) justo antes del `blockquote` y nunca quita el
 * `blockquote`. Eso se veía como un hueco roto en mitad de la fila, así que
 * pasado `FALLBACK_MS` se tira ese iframe y el enlace se queda dentro de un
 * marco del tamaño de las demás (`.ig__fallback`).
 *
 * Si el navegador no deja cargar `embed.js` (Brave con los escudos puestos,
 * bloqueadores de anuncios…), no hay nada que esperar: los marcos salen al
 * momento y aparece el aviso `[data-ig-blocked]` (Luna, 05-10-2026: en Brave
 * se veían solo los enlaces sueltos y, pasados 8 s, los marcos vacíos).
 */
import { INSTAGRAM_EMBED_SCRIPT } from '../config/social';
import { loadExternalScript } from './external-script';

declare global {
  interface Window {
    instgrm?: { Embeds?: { process(): void } };
  }
}

/** Margen que se le da a cada embed antes de dar su hueco por perdido. */
export const FALLBACK_MS = 8_000;

export class InstagramPostsElement extends HTMLElement {
  #timer: ReturnType<typeof setTimeout> | undefined;

  connectedCallback(): void {
    void this.#load();
  }

  disconnectedCallback(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #load(): Promise<void> {
    if (this.dataset.state === 'ready') return;
    this.dataset.state = 'loading';
    try {
      // Si ya estaba cargado (otra visita a contact sin recargar la web), hay
      // que pedirle que procese estos `blockquote`; la primera vez lo hace solo.
      const alreadyLoaded = Boolean(window.instgrm?.Embeds);
      await loadExternalScript(INSTAGRAM_EMBED_SCRIPT);
      if (!this.isConnected) return;
      if (alreadyLoaded) window.instgrm?.Embeds?.process();
      this.dataset.state = 'ready';
    } catch (error) {
      // Quedan los enlaces de dentro de cada `blockquote`, ya en su marco.
      console.warn('[instagram] El navegador no ha dejado cargar el embed; quedan los enlaces.', error);
      this.dataset.state = 'error';
      this.tidyUnrendered();
      const notice = this.parentElement?.querySelector<HTMLElement>('[data-ig-blocked]');
      if (notice) notice.hidden = false;
      return;
    }
    this.#timer = setTimeout(() => this.tidyUnrendered(), FALLBACK_MS);
  }

  /**
   * Recoge lo que `embed.js` haya dejado a medias: por cada `blockquote` que
   * siga en pie, tira el iframe vacío que le precede y marca el hueco para que
   * el enlace se vea dentro de un marco, no como una línea suelta.
   */
  tidyUnrendered(): number {
    let caidas = 0;
    for (const quote of this.querySelectorAll('blockquote')) {
      const frame = quote.previousElementSibling;
      // `embed.js` mete su iframe justo antes del `blockquote` y solo quita el
      // `blockquote` cuando el embed responde con su alto.
      if (frame instanceof HTMLIFrameElement && !frame.classList.contains('instagram-media-rendered')) frame.remove();
      quote.classList.add('ig__fallback');
      caidas += 1;
    }
    if (caidas > 0) this.dataset.fallback = String(caidas);
    return caidas;
  }
}

if (!customElements.get('instagram-posts')) customElements.define('instagram-posts', InstagramPostsElement);
