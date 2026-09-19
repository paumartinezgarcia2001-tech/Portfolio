/**
 * Reproductor de mixes (C06, fase 4).
 *
 * - D43 (Luna, 19-09-2026): la música suena nada más abrir la web y el
 *   reproductor solo tiene tres botones en el centro: anterior,
 *   reproducir/pausar y siguiente (canción anterior o siguiente de la lista
 *   barajada).
 * - Los navegadores no dejan arrancar con sonido si la persona no ha tocado
 *   todavía la página: entonces la música empieza con su primer clic, toque o
 *   tecla, esté donde esté (salvo en los controles del vídeo de Media).
 */
export const PLAYER = {
  /** Empieza a sonar solo al abrir la web (D43). */
  autoplay: true,
  /** Artista en la pantalla de bloqueo y los controles del sistema (Media Session). */
  artist: 'travest15m0',
  /** Cada cuánto se guarda la posición en sessionStorage, para seguir tras recargar. */
  saveEveryMs: 5_000,
  /** Clave de sessionStorage: `{ mixId, time, paused }`. */
  storageKey: 'travest15m0:player',
  /** Botones y avisos (C06): `aria-label` en español. */
  labels: {
    play: 'Reproducir',
    pause: 'Pausar',
    previous: 'Mix anterior',
    next: 'Mix siguiente',
    nowPlaying: 'Reproduciendo',
    empty: 'reproductor — próximamente',
  },
} as const;
