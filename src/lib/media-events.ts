/**
 * Eventos entre el vídeo de Media (C15) y el reproductor de mixes (C06): solo
 * suena uno a la vez. Se emiten en `document` como `CustomEvent`.
 */

/**
 * El vídeo empieza a sonar (arranca con sonido o se lo activan) → el
 * reproductor se pausa (lo escucha la fase 4).
 */
export const MEDIA_SOUND_ON = 'media:sound-on';

/** El reproductor empieza a sonar → el vídeo se silencia (lo emite la fase 4). */
export const PLAYER_PLAY = 'player:play';

export interface MediaSoundOnDetail {
  /** Slug del vídeo que ha activado el sonido. */
  slug: string;
}

/**
 * Reproductor sonando: `<mix-player>` lleva `data-state="playing"` mientras
 * suena un mix (fase 4). Está en la columna izquierda, que persiste al navegar.
 */
export const PLAYER_PLAYING_SELECTOR = 'mix-player[data-state="playing"]';

/**
 * ¿Está sonando un mix? El vídeo arranca con sonido (D42) salvo en ese caso,
 * para no cortar lo que la persona ya está escuchando.
 */
export function isPlayerPlaying(root: ParentNode = document): boolean {
  return root.querySelector(PLAYER_PLAYING_SELECTOR) !== null;
}
