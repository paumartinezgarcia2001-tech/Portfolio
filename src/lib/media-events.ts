/**
 * Eventos entre el vídeo de Media (C15) y el reproductor de mixes (C06): solo
 * suena uno a la vez. Se emiten en `document` como `CustomEvent`.
 */

/** El vídeo activa el sonido → el reproductor se pausa (lo escucha la fase 4). */
export const MEDIA_SOUND_ON = 'media:sound-on';

/** El reproductor empieza a sonar → el vídeo se silencia (lo emite la fase 4). */
export const PLAYER_PLAY = 'player:play';

export interface MediaSoundOnDetail {
  /** Slug del vídeo que ha activado el sonido. */
  slug: string;
}
