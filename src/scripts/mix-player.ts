/**
 * `<mix-player>` — reproductor de mixes (C06, fase 4; D43).
 *
 * - Tres botones: anterior · reproducir/pausar · siguiente (canción anterior o
 *   siguiente de la lista barajada). Nada más en pantalla.
 * - Suena nada más abrir la web. Si el navegador no deja arrancar con sonido
 *   (lo normal en la primera visita), empieza con el primer clic, toque o
 *   tecla en cualquier parte, salvo en los controles del vídeo de Media.
 * - Orden aleatorio en cada visita (Fisher–Yates con crypto.getRandomValues,
 *   src/lib/mix-queue.ts); al acabar la lista, otra vuelta que no empieza por
 *   el último.
 * - Un único <audio> dentro de la columna izquierda, que persiste al navegar
 *   (`transition:persist`): la música no se corta al cambiar de sección.
 * - Si un archivo falla, lo reintenta una vez; si vuelve a fallar, lo salta y
 *   lo apunta en la consola. Si fallan todos, estado `error`.
 * - Media Session: título, artista y controles de la pantalla de bloqueo.
 * - Cada 5 s guarda `{ mixId, time, paused }` en sessionStorage: al recargar
 *   sigue por donde iba. Si la persona lo había pausado, no arranca solo.
 * - Convive con el vídeo de Media (D42): si el vídeo empieza a sonar
 *   (`media:sound-on`), la música se pausa, y vuelve al salir de Media; cuando
 *   la música empieza, emite `player:play` y el vídeo se silencia.
 */
import { PLAYER } from '../config/player';
import { MEDIA_SOUND_ON, PLAYER_PLAY } from '../lib/media-events';
import { MixQueue } from '../lib/mix-queue';

interface ClientMix {
  id: string;
  title: string;
  subtitle: string | null;
  src: string;
  artwork: string | null;
}

type State = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'empty';

/** Lo que se guarda en sessionStorage. */
interface Saved {
  mixId?: string;
  time?: number;
  /** La persona ha pausado la música: al recargar no arranca sola. */
  paused?: boolean;
}

/** Gestos que dan permiso al navegador para sonar (el primero que funcione). */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;
const MODIFIER_KEYS = new Set(['Escape', 'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn']);

const { labels } = PLAYER;

function readSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(PLAYER.storageKey);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? (value as Saved) : null;
  } catch {
    return null;
  }
}

function writeSaved(value: Saved): void {
  try {
    sessionStorage.setItem(PLAYER.storageKey, JSON.stringify(value));
  } catch {
    // Navegación privada, cuota llena…: se sigue sin guardar.
  }
}

function prefersSavingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

function isClientMix(value: unknown): value is ClientMix {
  const mix = value as Partial<ClientMix> | null;
  return typeof mix?.id === 'string' && typeof mix.title === 'string' && typeof mix.src === 'string';
}

function parseMixes(script: Element | null): ClientMix[] {
  if (!script?.textContent) return [];
  try {
    const data: unknown = JSON.parse(script.textContent);
    return Array.isArray(data) ? data.filter(isClientMix) : [];
  } catch (error) {
    console.error('[player] No se ha podido leer la lista de mixes', error);
    return [];
  }
}

function errorName(error: unknown): string | undefined {
  return (error as { name?: string } | null)?.name;
}

export class MixPlayerElement extends HTMLElement {
  #mounted = false;
  #audio: HTMLAudioElement | null = null;
  #queue: MixQueue<ClientMix> | null = null;
  #toggle: HTMLButtonElement | null = null;
  #live: HTMLElement | null = null;
  /** Tiene que estar sonando (por la persona o por el autoplay). */
  #wantsPlay = false;
  /** Cada play() lleva un número: solo cuenta la respuesta del último. */
  #playToken = 0;
  /** Ya se ha reintentado el mix actual. */
  #retried = false;
  /** Mixes distintos que han fallado desde el último que sonó bien. */
  #failed = new Set<string>();
  /** Segundo al que saltar en cuanto se conozca la duración. */
  #pendingSeek: number | null = null;
  /** Anunciar «Reproduciendo…» (solo tras una acción de la persona). */
  #announce = false;
  /** Pausado porque ha empezado a sonar el vídeo de Media. */
  #pausedByVideo = false;
  /** Escucha el primer gesto mientras el navegador no deja sonar. */
  #gesture: AbortController | null = null;
  #lastSave = 0;
  #lastPosition = 0;

  connectedCallback(): void {
    if (!this.#mounted) this.#mount();
  }

  /** La columna persiste: con `moveBefore` el reproductor se mueve sin reiniciarse. */
  connectedMoveCallback(): void {}

  #mount(): void {
    const audio = this.querySelector<HTMLAudioElement>('audio[data-audio]');
    const mixes = parseMixes(this.querySelector('script[data-mixes]'));
    if (!audio || mixes.length === 0) {
      for (const button of this.querySelectorAll('button')) button.disabled = true;
      this.#setState('empty');
      return;
    }
    this.#mounted = true;
    this.#audio = audio;
    this.#toggle = this.querySelector<HTMLButtonElement>('button[data-action="toggle"]');
    this.#live = this.querySelector<HTMLElement>('[data-live]');

    const saved = readSaved();
    this.#queue = new MixQueue(mixes, undefined, saved?.mixId);

    this.addEventListener('click', (event) => this.#onClick(event));
    audio.addEventListener('play', () => this.#onPlay());
    audio.addEventListener('playing', () => this.#onPlaying());
    audio.addEventListener('waiting', () => {
      if (this.#wantsPlay) this.#setState('loading');
    });
    audio.addEventListener('pause', () => this.#onPause());
    audio.addEventListener('ended', () => this.#next(false));
    audio.addEventListener('error', () => this.#onError());
    audio.addEventListener('loadedmetadata', () => this.#onMetadata());
    audio.addEventListener('timeupdate', () => this.#onTimeUpdate());
    document.addEventListener(MEDIA_SOUND_ON, () => this.#onVideoSound());
    document.addEventListener('astro:after-swap', () => this.#onNavigated());
    window.addEventListener('pagehide', () => this.#save());
    this.#setupMediaSession();

    const first = this.#queue.current() as ClientMix;
    this.#load(first, saved?.mixId === first.id ? (saved.time ?? null) : null);

    if (PLAYER.autoplay && !saved?.paused && !prefersSavingData()) this.#play(false);
    else this.#setState(saved?.paused ? 'paused' : 'idle');
  }

  // --- Acciones -------------------------------------------------------------

  #onClick(event: Event): void {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-action]') : null;
    if (!button || button.disabled || !this.contains(button)) return;
    switch (button.dataset.action) {
      case 'toggle':
        if (this.#wantsPlay) this.#pause(true);
        else this.#play(true);
        break;
      case 'previous':
        this.#previous(true);
        break;
      case 'next':
        this.#next(true);
        break;
    }
  }

  /** `user`: lo ha pedido la persona (botón o controles del sistema). */
  #play(user: boolean): void {
    const audio = this.#audio;
    if (!audio || !this.#queue?.current()) return;
    if (user) {
      this.#announce = true;
      this.#pausedByVideo = false;
      this.#disarmGesture();
      this.#save({ paused: false });
    }
    if (this.dataset.state === 'error' || audio.error) {
      // Otra oportunidad para todos (p. ej., ha vuelto la conexión).
      this.#failed.clear();
      this.#retried = false;
      audio.load();
    }
    this.#wantsPlay = true;
    this.#setState('loading');
    const token = ++this.#playToken;
    audio.play().catch((error: unknown) => {
      if (token !== this.#playToken) return;
      const name = errorName(error);
      if (name === 'NotAllowedError') {
        // Sin haber tocado la página, el navegador no deja sonar: se espera al
        // primer gesto (D43).
        this.#wantsPlay = false;
        this.#setState('paused');
        this.#armGesture();
      } else if (name !== 'AbortError' && name !== 'NotSupportedError') {
        // AbortError: se ha cambiado de mix o pausado mientras cargaba.
        // NotSupportedError: lo gestiona el evento `error`.
        console.warn('[player] play() ha fallado', error);
      }
    });
  }

  #pause(user: boolean): void {
    this.#wantsPlay = false;
    this.#playToken++;
    if (user) {
      this.#pausedByVideo = false;
      this.#disarmGesture();
    }
    this.#audio?.pause();
    if (this.dataset.state !== 'error') this.#setState('paused');
    if (user) this.#save({ paused: true });
  }

  #next(user: boolean): void {
    const mix = this.#queue?.next();
    if (!mix) return;
    this.#load(mix, null);
    if (user || this.#wantsPlay) this.#play(user);
  }

  #previous(user: boolean): void {
    const audio = this.#audio;
    const mix = this.#queue?.previous();
    if (!audio) return;
    if (mix) this.#load(mix, null);
    // En el primero no hay anterior: vuelve a empezar.
    else if (audio.readyState > 0) audio.currentTime = 0;
    else this.#pendingSeek = null;
    if (user || this.#wantsPlay) this.#play(user);
  }

  /** Prepara un mix (con `preload="none"` no descarga nada hasta `play()`). */
  #load(mix: ClientMix, startAt: number | null): void {
    const audio = this.#audio;
    if (!audio) return;
    this.#retried = false;
    this.#pendingSeek = startAt && startAt > 0 ? startAt : null;
    audio.src = mix.src;
    this.dataset.mix = mix.id;
    this.#updateMetadata(mix);
    this.#save();
  }

  #seek(time: number): void {
    const audio = this.#audio;
    if (!audio) return;
    const duration = audio.duration;
    const target = Math.max(0, Number.isFinite(duration) ? Math.min(time, duration - 0.25) : time);
    if (audio.readyState === HTMLMediaElement.HAVE_NOTHING) {
      this.#pendingSeek = target;
      return;
    }
    audio.currentTime = target;
    this.#updatePositionState();
  }

  // --- Eventos del <audio> --------------------------------------------------

  #onPlay(): void {
    this.#pausedByVideo = false;
    // Solo suena una cosa a la vez: el vídeo de Media se silencia (C15).
    document.dispatchEvent(new CustomEvent(PLAYER_PLAY));
  }

  #onPlaying(): void {
    const audio = this.#audio;
    if (!audio) return;
    this.#disarmGesture();
    if (!this.#wantsPlay) {
      audio.pause();
      return;
    }
    this.#failed.clear();
    this.#setState('playing');
    this.#updatePositionState();
    const mix = this.#queue?.current();
    if (this.#announce && mix) this.#say(`${labels.nowPlaying}: ${mix.title}`);
    this.#announce = false;
  }

  #onPause(): void {
    const audio = this.#audio;
    // Eventos viejos (ya suena otra vez) o final del mix (lo lleva `ended`).
    if (!audio || !audio.paused || audio.ended || !this.#wantsPlay) return;
    // Lo ha pausado el sistema (llamada, auriculares desconectados…).
    this.#wantsPlay = false;
    this.#playToken++;
    this.#setState('paused');
  }

  #onError(): void {
    const audio = this.#audio;
    const mix = this.#queue?.current();
    if (!audio || !mix || !audio.getAttribute('src')) return;
    const code = audio.error?.code ?? '?';
    if (!this.#retried) {
      this.#retried = true;
      console.warn(`[player] No se ha podido cargar «${mix.title}» (error ${code}); se reintenta una vez.`);
      const at = audio.currentTime;
      this.#pendingSeek = at > 0 ? at : this.#pendingSeek;
      audio.load();
      if (this.#wantsPlay) this.#play(false);
      return;
    }
    this.#failed.add(mix.id);
    console.warn(`[player] «${mix.title}» no se puede reproducir (error ${code}); se salta.`);
    if (this.#failed.size >= (this.#queue?.size ?? 0)) {
      console.error('[player] No se ha podido reproducir ningún mix.');
      this.#wantsPlay = false;
      this.#playToken++;
      this.#setState('error');
      return;
    }
    this.#next(false);
  }

  #onMetadata(): void {
    const audio = this.#audio;
    if (!audio) return;
    const seek = this.#pendingSeek;
    this.#pendingSeek = null;
    if (seek !== null && Number.isFinite(audio.duration) && seek < audio.duration - 1) audio.currentTime = seek;
    this.#updatePositionState();
  }

  #onTimeUpdate(): void {
    const now = performance.now();
    if (now - this.#lastPosition >= 1_000) {
      this.#lastPosition = now;
      this.#updatePositionState();
    }
    if (now - this.#lastSave >= PLAYER.saveEveryMs) this.#save();
  }

  // --- Convivencia con el vídeo de Media (D42) -------------------------------

  #onVideoSound(): void {
    // La persona ha elegido el sonido del vídeo: la música no se cuela.
    this.#disarmGesture();
    if (!this.#wantsPlay) return;
    this.#pause(false);
    this.#pausedByVideo = true;
  }

  #onNavigated(): void {
    // Al salir de Media, la música que había pausado el vídeo vuelve a sonar.
    if (this.#pausedByVideo && !document.querySelector('media-video')) {
      this.#pausedByVideo = false;
      this.#play(false);
    }
  }

  // --- Autoplay: el primer gesto ---------------------------------------------

  #armGesture(): void {
    if (this.#gesture) return;
    this.#gesture = new AbortController();
    this.dataset.autoplay = 'waiting';
    const onGesture = (event: Event): void => {
      if (!event.isTrusted || this.#wantsPlay) return;
      const target = event.target instanceof Element ? event.target : null;
      // Los botones del reproductor ya hacen lo suyo (su clic llega después).
      if (target && this.contains(target) && target.closest('button[data-action]')) {
        this.#disarmGesture();
        return;
      }
      // En los controles del vídeo de Media se está eligiendo el vídeo.
      if (target?.closest('media-video')) return;
      if (event instanceof KeyboardEvent && MODIFIER_KEYS.has(event.key)) return;
      this.#play(false);
    };
    for (const type of GESTURES) {
      document.addEventListener(type, onGesture, { capture: true, passive: true, signal: this.#gesture.signal });
    }
  }

  #disarmGesture(): void {
    if (!this.#gesture) return;
    this.#gesture.abort();
    this.#gesture = null;
    this.dataset.autoplay = '';
  }

  // --- Estado, avisos y Media Session ----------------------------------------

  #setState(state: State): void {
    this.dataset.state = state;
    const active = state === 'playing' || state === 'loading';
    this.#toggle?.setAttribute('aria-label', active ? labels.pause : labels.play);
    if ('mediaSession' in navigator && state !== 'empty') {
      navigator.mediaSession.playbackState = active ? 'playing' : 'paused';
    }
  }

  #say(text: string): void {
    const live = this.#live;
    if (!live) return;
    live.textContent = '';
    requestAnimationFrame(() => {
      live.textContent = text;
    });
  }

  #save(patch: Partial<Saved> = {}): void {
    const audio = this.#audio;
    const mix = this.#queue?.current();
    if (!audio || !mix) return;
    this.#lastSave = performance.now();
    const time = this.#pendingSeek ?? audio.currentTime;
    writeSaved({
      mixId: mix.id,
      time: Math.floor(time * 10) / 10,
      paused: patch.paused ?? readSaved()?.paused ?? false,
    });
  }

  #setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const current = () => this.#audio?.currentTime ?? 0;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => this.#play(true)],
      ['pause', () => this.#pause(true)],
      ['previoustrack', () => this.#previous(true)],
      ['nexttrack', () => this.#next(true)],
      ['seekto', (details) => details.seekTime != null && this.#seek(details.seekTime)],
      ['seekbackward', (details) => this.#seek(current() - (details.seekOffset ?? 10))],
      ['seekforward', (details) => this.#seek(current() + (details.seekOffset ?? 10))],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Acción no admitida en este navegador.
      }
    }
  }

  #updateMetadata(mix: ClientMix): void {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: mix.title,
      artist: PLAYER.artist,
      album: mix.subtitle ?? '',
      artwork: mix.artwork ? [{ src: mix.artwork, sizes: '1000x1000' }] : [],
    });
  }

  #updatePositionState(): void {
    const audio = this.#audio;
    if (!audio || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const duration = audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(0, audio.currentTime), duration),
      });
    } catch {
      // Valores fuera de rango mientras cambia de mix.
    }
  }
}

if (!customElements.get('mix-player')) customElements.define('mix-player', MixPlayerElement);

declare global {
  interface HTMLElementTagNameMap {
    'mix-player': MixPlayerElement;
  }
}
