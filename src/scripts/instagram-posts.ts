/**
 * C17 · `<instagram-posts>` — publicaciones destacadas de Instagram (D59).
 *
 * Igual que el reproductor de SoundCloud: lo que llega del servidor son
 * **enlaces de verdad** a cada publicación, y solo al pulsar «ver las
 * publicaciones aquí» se carga `embed.js` de Instagram y se cambian por los
 * embeds oficiales. Hasta ese clic, Meta no recibe ninguna visita ni pone
 * ninguna cookie, que es lo que permite que la web no tenga banner (§11).
 *
 * El embed oficial no necesita token ni revisión de la app desde junio de 2026,
 * pero solo funciona con **publicaciones públicas**; si la cuenta se pone
 * privada o se desactivan los embeds, el script no pinta nada y se vuelve a los
 * enlaces.
 */
import { INSTAGRAM_EMBED_SCRIPT, SOCIAL_TEXT } from '../config/social';
import { loadExternalScript } from './external-script';

/** Versión del formato del embed que documenta Instagram. */
const EMBED_VERSION = '14';

declare global {
  interface Window {
    instgrm?: { Embeds?: { process(): void } };
  }
}

export class InstagramPostsElement extends HTMLElement {
  #listeners = new AbortController();
  #loading = false;

  connectedCallback(): void {
    this.querySelector<HTMLElement>('[data-load]')?.addEventListener(
      'click',
      () => void this.#load(),
      { signal: this.#listeners.signal },
    );
  }

  disconnectedCallback(): void {
    this.#listeners.abort();
  }

  /** Permalinks, leídos de los enlaces que ya están en la página. */
  #permalinks(): string[] {
    return [...this.querySelectorAll<HTMLAnchorElement>('[data-post]')].map((link) => link.href).filter(Boolean);
  }

  async #load(): Promise<void> {
    if (this.#loading || this.dataset.state === 'ready') return;
    const permalinks = this.#permalinks();
    if (permalinks.length === 0) return;

    this.#loading = true;
    this.dataset.state = 'loading';
    const button = this.querySelector<HTMLButtonElement>('[data-load]');
    if (button) {
      button.disabled = true;
      button.textContent = SOCIAL_TEXT.instagram.loading;
    }

    const holder = this.querySelector<HTMLElement>('[data-embeds]');
    if (!holder) {
      this.#loading = false;
      return;
    }
    for (const permalink of permalinks) {
      const quote = document.createElement('blockquote');
      quote.className = 'instagram-media';
      quote.dataset.instgrmPermalink = permalink;
      quote.dataset.instgrmVersion = EMBED_VERSION;
      holder.appendChild(quote);
    }

    try {
      // Si ya estaba cargado (otra visita sin recargar), hay que pedirle que
      // procese los `blockquote` nuevos; al cargarlo la primera vez lo hace solo.
      const alreadyLoaded = Boolean(window.instgrm?.Embeds);
      await loadExternalScript(INSTAGRAM_EMBED_SCRIPT);
      if (alreadyLoaded) window.instgrm?.Embeds?.process();
      this.dataset.state = 'ready';
      // Los enlaces y el botón ya no hacen falta: están los embeds.
      this.querySelector<HTMLElement>('[data-posts]')?.setAttribute('hidden', '');
      button?.remove();
    } catch (error) {
      console.error('[instagram] No se ha podido cargar el embed.', error);
      this.dataset.state = 'error';
      holder.replaceChildren();
      if (button) {
        button.disabled = false;
        button.textContent = SOCIAL_TEXT.instagram.failed;
      }
    } finally {
      this.#loading = false;
    }
  }
}

if (!customElements.get('instagram-posts')) customElements.define('instagram-posts', InstagramPostsElement);
