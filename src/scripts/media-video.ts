/**
 * `<media-video>` — vídeo a sangre de Media (C15). Sin pixelado (D40): el
 * `<video>` se ve tal cual, con `object-fit: cover` y el punto focal.
 *
 * - Elige al iniciar la versión 4:5 o la 9:16 según la proporción del panel
 *   (`data-narrow-query`, la misma media query que usa el póster).
 * - HLS nativo si el navegador lo trae (Safari); si no, carga hls.js (build
 *   «light») solo en ese momento; sin MSE o si el HLS falla, el MP4 de respaldo.
 * - Sin autoplay con `prefers-reduced-motion` o `Save-Data`: póster + botón.
 * - Arranca con sonido (D42). Los navegadores solo lo dejan si la persona ya
 *   ha tocado la página (p. ej., ha llegado desde el menú); si no, arranca
 *   silenciado y «sonido» queda apagado. Si está sonando un mix, también
 *   arranca silenciado, para no cortarlo. Si lo arranca la persona con
 *   «reproducir», suena (y la música se pausa).
 * - Cuando empieza a sonar emite `media:sound-on` (el reproductor de mixes se
 *   pausa); `player:play` lo vuelve a silenciar.
 * - Se pausa fuera de la vista (IntersectionObserver), con la pestaña oculta
 *   y con el menú móvil abierto.
 * - Todo se libera en `astro:before-swap` (hls.js, red, decodificador).
 * - Se monta en una microtarea, no en el propio `connectedCallback`: al
 *   navegar, Astro recrea los <video> justo después de conectar el elemento.
 */
import type HlsType from 'hls.js';
import type { ErrorData } from 'hls.js';
import { DESKTOP_MEDIA_QUERY } from '../config/site';
import { MEDIA_SOUND_ON, PLAYER_PLAY, isPlayerPlaying, type MediaSoundOnDetail } from '../lib/media-events';

type HlsConstructor = typeof HlsType;

type State = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

let hlsLoader: Promise<HlsConstructor> | undefined;

/** hls.js se descarga una sola vez y solo si hace falta. */
function loadHls(): Promise<HlsConstructor> {
  hlsLoader ??= import('hls.js/light').then((module) => module.default);
  return hlsLoader;
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const desktop = window.matchMedia(DESKTOP_MEDIA_QUERY);

function prefersSavingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

function hasMediaSource(): boolean {
  return 'ManagedMediaSource' in window || 'MediaSource' in window;
}

const LABEL_PAUSE = 'pausa';
const LABEL_RESUME = 'reanudar';

export class MediaVideoElement extends HTMLElement {
  static readonly #live = new Set<MediaVideoElement>();

  /** Instancias montadas y cuántas tienen hls.js vivo (lo comprueban los e2e). */
  static get stats(): { elements: number; hls: number } {
    let hls = 0;
    for (const element of MediaVideoElement.#live) if (element.#hls) hls++;
    return { elements: MediaVideoElement.#live.size, hls };
  }

  /** Desmonta todas las instancias (al cambiar de página). */
  static teardownAll(): void {
    for (const element of [...MediaVideoElement.#live]) element.teardown();
  }

  #video: HTMLVideoElement | null = null;
  #hls: HlsType | null = null;
  #abort: AbortController | null = null;
  #intersection: IntersectionObserver | null = null;
  #viewObserver: MutationObserver | null = null;
  #childObserver: MutationObserver | null = null;
  #source: { hls: string; mp4: string } | null = null;
  /** Se ha pedido reproducir: la fuente está (o se está) cargando. */
  #started = false;
  #userPaused = false;
  #inView = true;
  #usingFallback = false;
  #retried = { network: false, media: false };

  connectedCallback(): void {
    // Al navegar con el ClientRouter, Astro conecta este elemento y, justo
    // después y en la misma tarea, cambia cada <video> nuevo por una copia
    // hecha en el documento vivo (`reifyMediaElements`, withastro/astro#17603).
    // Si se montara ya, el vídeo sonaría fuera de la página y solo se vería el
    // póster: se monta en una microtarea, cuando el <video> ya es el definitivo.
    queueMicrotask(() => {
      if (this.isConnected) this.#setup();
    });
  }

  disconnectedCallback(): void {
    this.teardown();
  }

  #setup(): void {
    if (this.#abort) return;
    const video = this.querySelector<HTMLVideoElement>('video[data-video]');
    const hls = this.dataset.hls;
    const mp4 = this.dataset.mp4;
    if (!video || !hls || !mp4) return;

    this.#video = video;
    this.#abort = new AbortController();
    this.#started = false;
    this.#userPaused = false;
    this.#inView = true;
    this.#usingFallback = false;
    this.#retried = { network: false, media: false };
    MediaVideoElement.#live.add(this);
    const { signal } = this.#abort;

    // Versión estrecha (9:16) si el panel se le parece más; se decide una vez.
    const narrowQuery = this.dataset.narrowQuery;
    const narrow = Boolean(narrowQuery && window.matchMedia(narrowQuery).matches);
    this.#source = narrow && this.dataset.narrowHls && this.dataset.narrowMp4
      ? { hls: this.dataset.narrowHls, mp4: this.dataset.narrowMp4 }
      : { hls, mp4 };

    this.addEventListener('click', (event) => this.#onClick(event), { signal });
    video.addEventListener('playing', () => this.#setState('playing'), { signal });
    video.addEventListener('pause', () => {
      if (this.#started && this.dataset.state !== 'error' && this.dataset.state !== 'idle') this.#setState('paused');
    }, { signal });
    video.addEventListener('loadeddata', () => this.toggleAttribute('data-ready', true), { signal });
    video.addEventListener('volumechange', () => this.#syncSoundButton(), { signal });
    video.addEventListener('error', () => this.#onVideoError(), { signal });
    document.addEventListener('visibilitychange', () => this.#sync(), { signal });
    document.addEventListener(PLAYER_PLAY, () => {
      if (!video.muted) video.muted = true;
    }, { signal });

    this.#intersection = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      this.#inView = entry.isIntersecting;
      this.#sync();
    });
    this.#intersection.observe(this);

    // En móvil, con el menú abierto el vídeo queda tapado: se pausa.
    this.#viewObserver = new MutationObserver(() => this.#sync());
    this.#viewObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-view'] });

    // Por si algo vuelve a cambiar el <video> por otro más tarde: se vuelve a
    // montar con el nuevo (nunca se queda sonando uno que no está en la página).
    this.#childObserver = new MutationObserver(() => {
      if (this.#video && !this.#video.isConnected && this.isConnected) {
        this.teardown();
        this.#setup();
      }
    });
    this.#childObserver.observe(this, { childList: true });

    this.#syncSoundButton();
    this.#syncToggleButton();

    if (reducedMotion.matches || prefersSavingData()) this.#setState('idle');
    else void this.#start();
  }

  /** Libera el vídeo, hls.js y los listeners. Se puede llamar varias veces. */
  teardown(): void {
    if (!this.#abort) return;
    this.#abort.abort();
    this.#abort = null;
    this.#intersection?.disconnect();
    this.#intersection = null;
    this.#viewObserver?.disconnect();
    this.#viewObserver = null;
    this.#childObserver?.disconnect();
    this.#childObserver = null;
    this.#destroyHls();
    const video = this.#video;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    this.#video = null;
    this.#started = false;
    MediaVideoElement.#live.delete(this);
  }

  #setState(state: State): void {
    this.dataset.state = state;
    this.#syncToggleButton();
  }

  #onClick(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
    const video = this.#video;
    if (!target || !video) return;

    switch (target.dataset.action) {
      case 'start': {
        this.#userPaused = false;
        const hadFocus = target === document.activeElement;
        if (this.#started) {
          // Ya estaba cargado (el navegador no dejó arrancar solo). Ahora hay
          // un clic: puede sonar.
          this.#applyDefaultSound(true);
          this.#setState('loading');
          this.#sync();
        } else {
          void this.#start(true);
        }
        // El botón desaparece: el foco pasa a «pausa» para no perderse.
        if (hadFocus) this.querySelector<HTMLElement>('[data-action="toggle"]')?.focus();
        break;
      }
      case 'toggle':
        this.#userPaused = !this.#userPaused;
        if (this.#userPaused) this.#setState('paused');
        this.#sync();
        this.#syncToggleButton();
        break;
      case 'sound':
        video.muted = !video.muted;
        if (!video.muted) this.#announceSound();
        break;
    }
  }

  /** `explicit`: lo ha pedido la persona con «reproducir». */
  async #start(explicit = false): Promise<void> {
    if (this.#started || !this.#abort) return;
    this.#started = true;
    this.#applyDefaultSound(explicit);
    this.#setState('loading');
    const attached = await this.#attach();
    if (attached) this.#sync();
  }

  /** Engancha la fuente: HLS nativo, hls.js o MP4. */
  async #attach(): Promise<boolean> {
    const video = this.#video;
    const source = this.#source;
    if (!video || !source) return false;

    if (video.canPlayType('application/vnd.apple.mpegurl') !== '') {
      video.src = source.hls;
      return true;
    }

    if (hasMediaSource()) {
      try {
        const Hls = await loadHls();
        // ¿Se ha cambiado de página mientras se descargaba hls.js?
        if (!this.#abort || this.#video !== video) return false;
        if (Hls.isSupported()) {
          const hls = new Hls({
            // No pide más resolución de la que ocupa el panel.
            capLevelToPlayerSize: true,
            // Sin worker: los segmentos son fMP4 (no hay nada que transmuxar)
            // y así la CSP de la fase 7 no necesita `worker-src blob:`.
            enableWorker: false,
          });
          this.#hls = hls;
          hls.on(Hls.Events.ERROR, (_event, data) => this.#onHlsError(Hls, data));
          hls.loadSource(source.hls);
          hls.attachMedia(video);
          return true;
        }
      } catch (error) {
        console.warn('[media] No se ha podido cargar hls.js; se usa el MP4.', error);
        if (!this.#abort || this.#video !== video) return false;
      }
    }

    this.#useFallback();
    return true;
  }

  #onHlsError(Hls: HlsConstructor, data: ErrorData): void {
    if (!data.fatal || !this.#hls) return;
    // hls.js ya ha reintentado por su cuenta. Uno más si la lista maestra
    // llegó (fallo de un segmento); si no, directamente al MP4.
    const hasLevels = this.#hls.levels.length > 0;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hasLevels && !this.#retried.network) {
      this.#retried.network = true;
      this.#hls.startLoad();
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !this.#retried.media) {
      this.#retried.media = true;
      this.#hls.recoverMediaError();
      return;
    }
    console.warn(`[media] Error de HLS (${data.details}); se usa el MP4 de respaldo.`);
    this.#useFallback();
  }

  #onVideoError(): void {
    // Con hls.js, los errores llegan por su evento ERROR.
    if (this.#hls || !this.#started || !this.#video?.getAttribute('src')) return;
    if (!this.#usingFallback) {
      console.warn('[media] El navegador no ha podido reproducir el HLS; se usa el MP4 de respaldo.');
      this.#useFallback();
    } else {
      this.#fail();
    }
  }

  #useFallback(): void {
    const video = this.#video;
    if (!video || !this.#source) return;
    if (this.#usingFallback) {
      this.#fail();
      return;
    }
    this.#usingFallback = true;
    this.#destroyHls();
    video.src = this.#source.mp4;
    this.#sync();
  }

  #fail(): void {
    console.error('[media] No se ha podido reproducir el vídeo; se queda el póster.');
    this.#destroyHls();
    const video = this.#video;
    video?.pause();
    // Sin vídeo, el póster pasa a ser el contenido: le toca su nombre.
    const poster = this.querySelector('picture img');
    if (poster && video) poster.setAttribute('alt', video.getAttribute('aria-label') ?? '');
    this.#setState('error');
  }

  #destroyHls(): void {
    this.#hls?.destroy();
    this.#hls = null;
  }

  /** ¿Debería estar sonando ahora mismo? */
  #shouldPlay(): boolean {
    const menuOpen = !desktop.matches && document.documentElement.dataset.view === 'menu';
    return this.#started && !this.#userPaused && this.#inView && !menuOpen && document.visibilityState === 'visible';
  }

  /** Pone el vídeo en el estado que toca (reproducir o pausar). */
  #sync(): void {
    const video = this.#video;
    if (!video || !this.#started || this.dataset.state === 'error') return;
    if (!this.#shouldPlay()) {
      if (!video.paused) video.pause();
      return;
    }
    if (!video.paused) return;
    this.#play(video);
  }

  #play(video: HTMLVideoElement): void {
    const withSound = !video.muted;
    video.play().then(
      () => {
        if (withSound && !video.muted && this.#video === video) this.#announceSound();
      },
      (error: unknown) => {
        if (this.#video !== video) return;
        const name = (error as { name?: string } | null)?.name;
        if (name === 'NotAllowedError' && withSound) {
          // Sin haber tocado la página, el navegador no deja arrancar con
          // sonido: se silencia («sonido» queda apagado) y se vuelve a probar.
          video.muted = true;
          this.#sync();
        } else if (name === 'NotAllowedError') {
          // Ni siquiera sin sonido (p. ej., ahorro de batería en iOS).
          this.#userPaused = true;
          this.#setState('idle');
        } else if (name !== 'AbortError') {
          console.warn('[media] play() ha fallado', error);
        }
      },
    );
  }

  /**
   * Sonido por defecto (D42): activado, salvo que esté sonando un mix. Si la
   * persona ha pulsado «reproducir» (`explicit`), suena igualmente: ha elegido
   * el vídeo, y la música se pausa al oír `media:sound-on`.
   */
  #applyDefaultSound(explicit = false): void {
    if (!this.#video) return;
    this.#video.muted = !explicit && isPlayerPlaying();
    this.#syncSoundButton();
  }

  /** El vídeo suena: el reproductor de mixes se pausa (C06). */
  #announceSound(): void {
    document.dispatchEvent(
      new CustomEvent<MediaSoundOnDetail>(MEDIA_SOUND_ON, { detail: { slug: this.dataset.slug ?? '' } }),
    );
  }

  #syncSoundButton(): void {
    const button = this.querySelector<HTMLButtonElement>('[data-action="sound"]');
    if (button && this.#video) button.setAttribute('aria-pressed', String(!this.#video.muted));
  }

  #syncToggleButton(): void {
    const button = this.querySelector<HTMLButtonElement>('[data-action="toggle"]');
    if (button) button.textContent = this.#userPaused ? LABEL_RESUME : LABEL_PAUSE;
  }
}

if (!customElements.get('media-video')) customElements.define('media-video', MediaVideoElement);

// Al cambiar de página se libera todo antes de que entre el contenido nuevo.
document.addEventListener('astro:before-swap', () => MediaVideoElement.teardownAll());

declare global {
  interface HTMLElementTagNameMap {
    'media-video': MediaVideoElement;
  }
}
