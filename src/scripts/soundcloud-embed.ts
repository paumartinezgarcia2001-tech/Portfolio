/**
 * C17 · `<soundcloud-embed>` — reproductor de SoundCloud en contact (D59).
 *
 * Dos formas de llegar, según `SOUNDCLOUD.eager` (src/config/social.ts):
 * - **puesto desde el principio** (así está ahora): el iframe viene del
 *   servidor y no suena hasta que le dan al play. Este script solo se engancha
 *   a él para coordinarlo con la música.
 * - **con fachada**: lo que hay es un enlace a SoundCloud (lo que se usa sin
 *   JavaScript) y, al pulsarlo, se cambia por el reproductor ya sonando.
 *
 * Convivencia con el reproductor de mixes (C06), igual que el vídeo de Media
 * (D42): solo suena uno.
 * - Cuando SoundCloud empieza a sonar se emite `MEDIA_SOUND_ON` y la música se
 *   pausa; al salir de contact, el `<mix-player>` la reanuda sola (ya no queda
 *   en la página nada que pueda sonar).
 * - Si arranca la música (`PLAYER_PLAY`), este reproductor se pausa.
 *
 * La API del widget (`api.js`) habla con el iframe por `postMessage` y no
 * necesita clave.
 */
import { SOUNDCLOUD_WIDGET_API } from '../config/social';
import { MEDIA_SOUND_ON, PLAYER_PLAY, type MediaSoundOnDetail } from '../lib/media-events';
import { loadExternalScript } from './external-script';

/** Lo poco que usamos de la Widget API de SoundCloud. */
interface SoundCloudWidget {
  bind(event: string, listener: () => void): void;
  pause(): void;
}

interface SoundCloudApi {
  (frame: HTMLIFrameElement): SoundCloudWidget;
  Events: { PLAY: string; PAUSE: string; FINISH: string };
}

declare global {
  interface Window {
    SC?: { Widget?: SoundCloudApi };
  }
}

/** La música de la web se pausa: va a sonar SoundCloud. */
function announceSound(): void {
  document.dispatchEvent(new CustomEvent<MediaSoundOnDetail>(MEDIA_SOUND_ON, { detail: { slug: 'soundcloud' } }));
}

export class SoundCloudEmbedElement extends HTMLElement {
  #listeners = new AbortController();
  #widget: SoundCloudWidget | undefined;
  #loading = false;

  connectedCallback(): void {
    // Si arranca la música, este reproductor se calla.
    document.addEventListener(PLAYER_PLAY, () => this.#widget?.pause(), { signal: this.#listeners.signal });

    const frame = this.querySelector<HTMLIFrameElement>('iframe');
    if (frame) {
      // Ya puesto desde el servidor: nada que cargar, solo coordinarlo. No se
      // avisa de nada todavía porque no está sonando.
      void this.#bind(frame);
      return;
    }

    // Fachada: sin JavaScript dice «escuchar en SoundCloud» (es un enlace);
    // con JavaScript, lo que hace de verdad.
    const action = this.querySelector<HTMLElement>('[data-action]');
    if (action && this.dataset.loadLabel) action.textContent = this.dataset.loadLabel;

    this.querySelector<HTMLElement>('[data-load]')?.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
        void this.#load();
      },
      { signal: this.#listeners.signal },
    );
  }

  disconnectedCallback(): void {
    this.#listeners.abort();
    this.#widget = undefined;
  }

  /** Engancha la Widget API al iframe. Es un extra: si falla, el reproductor funciona igual. */
  async #bind(frame: HTMLIFrameElement): Promise<void> {
    try {
      await loadExternalScript(SOUNDCLOUD_WIDGET_API);
      const api = window.SC?.Widget;
      if (!api || !this.isConnected) return;
      const widget = api(frame);
      this.#widget = widget;
      widget.bind(api.Events.PLAY, announceSound);
    } catch (error) {
      console.warn('[soundcloud] Sin la Widget API: la música y SoundCloud podrían sonar a la vez.', error);
    }
  }

  /** Solo con fachada: cambia el enlace por el reproductor, ya sonando. */
  async #load(): Promise<void> {
    if (this.#loading || this.dataset.state === 'ready') return;
    const src = this.dataset.playerSrc;
    if (!src) {
      this.dataset.state = 'error';
      console.error('[soundcloud] Falta data-player-src.');
      return;
    }
    this.#loading = true;
    this.dataset.state = 'loading';

    const frame = document.createElement('iframe');
    frame.src = src;
    frame.title = this.dataset.frameTitle ?? 'SoundCloud';
    frame.width = '100%';
    frame.height = this.dataset.frameHeight ?? '450';
    frame.loading = 'lazy';
    // `allow="autoplay"` solo aquí: el iframe se crea después del clic, así que
    // no hay forma de que suene nada sin pedirlo.
    frame.allow = 'autoplay; encrypted-media';
    frame.setAttribute('frameborder', 'no');
    frame.setAttribute('scrolling', 'no');

    const facade = this.querySelector<HTMLElement>('[data-facade]');
    facade?.replaceChildren(frame);
    facade?.removeAttribute('href');
    facade?.removeAttribute('target');
    facade?.removeAttribute('rel');
    this.dataset.state = 'ready';
    this.#loading = false;

    // Este arranca con sonido: la música se pausa ya.
    announceSound();
    await this.#bind(frame);
  }
}

if (!customElements.get('soundcloud-embed')) customElements.define('soundcloud-embed', SoundCloudEmbedElement);
