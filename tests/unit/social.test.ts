import { describe, expect, it } from 'vitest';
import { SITE } from '../../src/config/site';
import {
  INSTAGRAM_EMBED_SCRIPT,
  INSTAGRAM_ORIGIN,
  INSTAGRAM_POSTS,
  SOUNDCLOUD,
  SOUNDCLOUD_WIDGET_API,
  instagramPostUrl,
  instagramPosts,
  soundcloudPlayerUrl,
} from '../../src/config/social';

/** D59 · widgets de SoundCloud e Instagram en contact. */

describe('soundcloudPlayerUrl', () => {
  it('apunta al reproductor visual, sin arrancar solo', () => {
    const url = new URL(soundcloudPlayerUrl());
    expect(url.origin).toBe('https://w.soundcloud.com');
    expect(url.pathname).toBe('/player/');
    expect(url.searchParams.get('visual')).toBe('true');
    expect(url.searchParams.get('auto_play')).toBe('false');
  });

  it('sin pista concreta, incrusta el perfil entero (Luna ✓ 02-10)', () => {
    expect(SOUNDCLOUD.trackUrl).toBe('');
    expect(new URL(soundcloudPlayerUrl()).searchParams.get('url')).toBe(SITE.social.soundcloud);
  });

  it('con autoPlay arranca: el iframe solo se crea después del clic', () => {
    expect(new URL(soundcloudPlayerUrl({ autoPlay: true })).searchParams.get('auto_play')).toBe('true');
  });

  it('sin comentarios ni pistas recomendadas de otra gente', () => {
    const params = new URL(soundcloudPlayerUrl()).searchParams;
    expect(params.get('show_comments')).toBe('false');
    expect(params.get('hide_related')).toBe('true');
  });

  it('los scripts de terceros salen de los orígenes que permite la CSP', () => {
    expect(SOUNDCLOUD_WIDGET_API.startsWith('https://w.soundcloud.com/')).toBe(true);
    expect(INSTAGRAM_EMBED_SCRIPT).toBe(`${INSTAGRAM_ORIGIN}/embed.js`);
  });
});

describe('INSTAGRAM_POSTS', () => {
  it('son tres, válidas y sin repetir (van en una fila)', () => {
    const posts = instagramPosts();
    expect(posts).toHaveLength(3);
    expect(new Set(posts).size).toBe(3);
    expect(posts).toEqual(INSTAGRAM_POSTS.map((raw) => instagramPostUrl(raw)));
  });

  it('fuera DF3IBcjIiO5: Instagram dice que ya no existe (02-10-2026)', () => {
    expect(instagramPosts().some((url) => url.includes('DF3IBcjIiO5'))).toBe(false);
  });
});

describe('instagramPostUrl', () => {
  it('acepta publicaciones, reels y vídeos, con o sin www', () => {
    expect(instagramPostUrl('https://www.instagram.com/p/AbC-123_x/')).toBe('https://www.instagram.com/p/AbC-123_x/');
    expect(instagramPostUrl('https://instagram.com/reel/AbC123/')).toBe('https://www.instagram.com/reel/AbC123/');
    expect(instagramPostUrl('https://www.instagram.com/tv/AbC123')).toBe('https://www.instagram.com/tv/AbC123/');
  });

  it('quita los parámetros que trae el botón de compartir', () => {
    expect(instagramPostUrl('https://www.instagram.com/p/AbC123/?igsh=abcdef&utm_source=ig_web')).toBe(
      'https://www.instagram.com/p/AbC123/',
    );
  });

  it('recorta los espacios de un copiar y pegar', () => {
    expect(instagramPostUrl('  https://www.instagram.com/p/AbC123/  ')).toBe('https://www.instagram.com/p/AbC123/');
  });

  it('descarta lo que no es una publicación de Instagram', () => {
    for (const raw of [
      '',
      'AbC123',
      'instagram.com/p/AbC123/',
      'https://www.instagram.com/travest15m0/',
      'https://www.instagram.com/p/',
      'https://instagram.com.ejemplo.test/p/AbC123/',
      'https://www.facebook.com/p/AbC123/',
      'javascript:alert(1)',
    ]) {
      expect(instagramPostUrl(raw)).toBeUndefined();
    }
  });
});
