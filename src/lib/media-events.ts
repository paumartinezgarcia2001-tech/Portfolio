/**
 * Eventos entre el reproductor de mixes (C06) y lo demás que puede sonar en la
 * web —el vídeo de Media (C15) y, desde D59, el reproductor de SoundCloud de
 * contact (C17)—: solo suena uno a la vez. Se emiten en `document` como
 * `CustomEvent`.
 */

/**
 * Algo que no es el reproductor de mixes empieza a sonar (el vídeo arranca con
 * sonido o se lo activan; alguien carga el reproductor de SoundCloud) → la
 * música se pausa (src/scripts/mix-player.ts), y vuelve sola al salir de esa
 * página, cuando ya no queda nada en el DOM que pueda estar sonando.
 */
export const MEDIA_SOUND_ON = 'media:sound-on';

/**
 * El reproductor de mixes empieza a sonar → el vídeo se silencia y el
 * reproductor de SoundCloud se pausa.
 */
export const PLAYER_PLAY = 'player:play';

export interface MediaSoundOnDetail {
  /** Quién ha empezado a sonar: el slug del vídeo, o `'soundcloud'`. */
  slug: string;
}

/**
 * Reproductor sonando o a punto de sonar: `<mix-player>` lleva
 * `data-state="playing"` mientras suena un mix y `"loading"` mientras arranca.
 * Antes de que se cargue su script, `data-autoplay` indica que va a arrancar
 * solo (D43). Está en la columna izquierda, que persiste al navegar.
 */
export const PLAYER_PLAYING_SELECTOR = [
  'mix-player[data-state="playing"]',
  'mix-player[data-state="loading"]',
  'mix-player[data-autoplay]:not(:defined)',
].join(', ');

/**
 * ¿Está sonando (o arrancando) un mix? El vídeo arranca con sonido (D42) salvo
 * en ese caso, para no cortar lo que la persona ya está escuchando.
 */
export function isPlayerPlaying(root: ParentNode = document): boolean {
  return root.querySelector(PLAYER_PLAYING_SELECTOR) !== null;
}
