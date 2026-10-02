/**
 * C17 · `<soundcloud-embed>` — reproductor de SoundCloud en contact (D59).
 *
 * No hay iframe hasta que alguien lo pide: el elemento llega con una fachada
 * (un enlace a SoundCloud, que es lo que se usa sin JavaScript) y, al pulsarla,
 * este script la cambia por el reproductor visual oficial, ya sonando.
 *
 * Convivencia con el reproductor de mixes (C06), igual que el vídeo de Media
 * (D42): solo suena uno.
 * - Al arrancar SoundCloud se emite `MEDIA_SOUND_ON` y la música se pausa; al
 *   salir de contact, el `<mix-player>` la reanuda sola (ya no queda en la
 *   página nada que pueda sonar).
 * - Si arranca la música (`PLAYER_PLAY`), este reproductor se pausa.
 *
 * La API del widget (`api.js`) habla con el iframe por `postMessage`, no
 * necesita clave y solo se carga tras el clic.
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

export class SoundCloudEmbedElement extends HTMLElement {
  #listeners = new AbortController();
  #widget: SoundCloudWidget | undefined;
  #loading = false;

  connectedCallback(): void {
    // Sin JavaScript la fachada dice «escuchar en SoundCloud» (es un enlace);
    // con JavaScript, lo que hace de verdad: cargar el reproductor aquí.
    const action = this.querySelector<HTMLElement>('[data-action]');
    if (action && this.dataset.loadLabel) action.textContent = this.dataset.loadLabel;

    const button = this.querySelector<HTMLElement>('[data-load]');
    button?.addEventListener(
      'click',
      (event) => {
        // Sin JavaScript la fachada es un enlace a SoundCloud; con JavaScript,
        // el reproductor se abre aquí mismo.
        event.preventDefault();
        void this.#load();
      },
      { signal: this.#listeners.signal },
    );

    // Si arranca la música, este reproductor se calla.
    document.addEventListener(PLAYER_PLAY, () => this.#widget?.pause(), { signal: this.#listeners.signal });
  }

  disconnectedCallback(): void {
    this.#listeners.abort();
    this.#widget = undefined;
  }

  async #load(): Promise<void> {
    if (this.#loading || this.dataset.state === 'ready') return;
    this.#loading = true;
    this.dataset.state = 'loading';

    const src = this.dataset.playerSrc;
    if (!src) {
      this.#loading = false;
      this.dataset.state = 'error';
      console.error('[soundcloud] Falta data-player-src.');
      return;
    }

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

    // La música se pausa ya: el iframe arranca con sonido.
    document.dispatchEvent(new CustomEvent<MediaSoundOnDetail>(MEDIA_SOUND_ON, { detail: { slug: 'soundcloud' } }));

    // La API es un extra: si no carga, el reproductor sigue funcionando solo.
    try {
      await loadExternalScript(SOUNDCLOUD_WIDGET_API);
      const api = window.SC?.Widget;
      if (!api) return;
      const widget = api(frame);
      this.#widget = widget;
      widget.bind(api.Events.PLAY, () => {
        document.dispatchEvent(new CustomEvent<MediaSoundOnDetail>(MEDIA_SOUND_ON, { detail: { slug: 'soundcloud' } }));
      });
    } catch (error) {
      console.warn('[soundcloud] Sin la Widget API: la música y SoundCloud podrían sonar a la vez.', error);
    }
  }
}

if (!customElements.get('soundcloud-embed')) customElements.define('soundcloud-embed', SoundCloudEmbedElement);
