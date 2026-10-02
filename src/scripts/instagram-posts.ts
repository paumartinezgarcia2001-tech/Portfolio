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
 */
import { INSTAGRAM_EMBED_SCRIPT } from '../config/social';
import { loadExternalScript } from './external-script';

declare global {
  interface Window {
    instgrm?: { Embeds?: { process(): void } };
  }
}

export class InstagramPostsElement extends HTMLElement {
  connectedCallback(): void {
    void this.#load();
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
      // Quedan los enlaces de dentro de cada `blockquote`.
      console.error('[instagram] No se ha podido cargar el embed; quedan los enlaces.', error);
      this.dataset.state = 'error';
    }
  }
}

if (!customElements.get('instagram-posts')) customElements.define('instagram-posts', InstagramPostsElement);
