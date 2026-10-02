import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import InstagramPosts from '../../src/components/InstagramPosts.astro';
import SoundCloudEmbed from '../../src/components/SoundCloudEmbed.astro';
import { SITE } from '../../src/config/site';
import { SOCIAL_TEXT, SOUNDCLOUD } from '../../src/config/social';

/**
 * D59 · lo que sale del servidor en contact.
 *
 * - SoundCloud va puesto (`SOUNDCLOUD.eager`), pero **sin arrancar solo**: eso
 *   es lo que hay que vigilar, porque la web ya tiene su propia música (D43).
 * - Instagram es una **fachada**: en el HTML no puede haber nada de Meta. Eso
 *   es lo que sostiene lo que promete /privacidad.
 */

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const POSTS = ['https://www.instagram.com/p/AbC123/', 'https://www.instagram.com/reel/XyZ789/?igsh=basura'];

/** Atributo `src` del iframe, con las entidades HTML deshechas. */
function frameSrc(html: string): string {
  return (/<iframe[^>]*\ssrc="([^"]+)"/.exec(html)?.[1] ?? '').replace(/&#38;|&amp;/g, '&');
}

describe('SoundCloudEmbed', () => {
  it('el reproductor ya viene puesto, con la pista y a la altura configurada', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    expect(SOUNDCLOUD.eager).toBe(true);
    expect(html).toContain('<iframe');
    const src = frameSrc(html);
    expect(src).toContain('w.soundcloud.com/player/');
    expect(src).toContain(encodeURIComponent(SOUNDCLOUD.trackUrl));
    expect(src).toContain('visual=true');
    expect(html).toContain(`height="${SOUNDCLOUD.height}"`);
    expect(html).toContain(`title="${SOCIAL_TEXT.soundcloud.frameTitle}"`);
  });

  it('NO arranca solo: la web ya tiene su propia música (D43)', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    expect(frameSrc(html)).toContain('auto_play=false');
    expect(frameSrc(html)).not.toContain('auto_play=true');
  });

  it('se carga con calma y el cursor del sistema manda encima (C10)', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('data-native-cursor');
  });

  it('el aviso de que es de SoundCloud va debajo, en el tamaño más pequeño', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    expect(html).toContain(SOCIAL_TEXT.soundcloud.notice);
    expect(html).toMatch(/class="embed__notice"/);
  });

  it('sin SoundCloud no se queda el enlace de la fachada a medias', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    // Con `eager`, la fachada no se pinta: no hay enlace que lleve fuera.
    expect(html).not.toContain(`href="${SITE.social.soundcloud}"`);
    // Pero la URL para cargarlo sonando sigue disponible por si se vuelve a
    // `eager: false` (la usa el script al pulsar).
    expect(html).toMatch(/data-player-src="[^"]*auto_play=true/);
  });
});

describe('InstagramPosts', () => {
  it('sin publicaciones en la configuración, no pinta el apartado', async () => {
    const html = await container.renderToString(InstagramPosts, { props: { posts: [] } });
    expect(html).not.toContain('<instagram-posts');
    expect(html).not.toContain('<section');
    expect(html).not.toContain('data-posts');
    expect(html).not.toContain(SOCIAL_TEXT.instagram.load);
  });

  it('pinta un enlace por publicación, y ningún embed', async () => {
    const html = await container.renderToString(InstagramPosts, { props: { posts: POSTS } });
    expect(html).toContain('href="https://www.instagram.com/p/AbC123/"');
    // Los parámetros de compartir se quedan fuera.
    expect(html).toContain('href="https://www.instagram.com/reel/XyZ789/"');
    expect(html).not.toContain('igsh');
    expect(html).not.toContain('instagram-media');
    expect(html).not.toContain('embed.js');
    expect(html).not.toContain('<iframe');
    expect(html).toContain(SOCIAL_TEXT.instagram.postLabel(1));
    expect(html).toContain(SOCIAL_TEXT.instagram.postLabel(2));
  });

  it('descarta las URLs que no son publicaciones', async () => {
    const html = await container.renderToString(InstagramPosts, {
      props: { posts: [...POSTS, 'https://www.instagram.com/travest15m0/', 'cualquier cosa'] },
    });
    // `data-post` (cada enlace), que no es `data-posts` (la lista).
    expect(html.match(/data-post(?!s)/g)).toHaveLength(2);
  });

  it('el botón de cargar y el aviso están, y el hueco de los embeds vacío', async () => {
    const html = await container.renderToString(InstagramPosts, { props: { posts: POSTS } });
    expect(html).toContain(SOCIAL_TEXT.instagram.load);
    expect(html).toContain(SOCIAL_TEXT.instagram.notice);
    expect(html).toMatch(/data-embeds[^>]*>\s*<\/div>/);
  });
});
