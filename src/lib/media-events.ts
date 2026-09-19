/**
 * Eventos entre el vídeo de Media (C15) y el reproductor de mixes (C06): solo
 * suena uno a la vez. Se emiten en `document` como `CustomEvent`.
 */

/**
 * El vídeo empieza a sonar (arranca con sonido o se lo activan) → el
 * reproductor se pausa (src/scripts/mix-player.ts).
 */
export const MEDIA_SOUND_ON = 'media:sound-on';

/** El reproductor empieza a sonar → el vídeo se silencia (src/scripts/mix-player.ts). */
export const PLAYER_PLAY = 'player:play';

export interface MediaSoundOnDetail {
  /** Slug del vídeo que ha activado el sonido. */
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
