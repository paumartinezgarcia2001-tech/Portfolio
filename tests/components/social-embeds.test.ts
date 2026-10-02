import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import InstagramPosts from '../../src/components/InstagramPosts.astro';
import SoundCloudEmbed from '../../src/components/SoundCloudEmbed.astro';
import { SITE } from '../../src/config/site';
import { SOCIAL_TEXT, SOUNDCLOUD } from '../../src/config/social';

/**
 * D59 · lo que sale del servidor en contact: **fachadas**, no iframes. Esto es
 * lo que de verdad protege la promesa de /privacidad («mientras no pulses, tu
 * navegador no se conecta ni a SoundCloud ni a Meta»), así que se comprueba que
 * en el HTML no hay nada de ellos.
 */

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const POSTS = ['https://www.instagram.com/p/AbC123/', 'https://www.instagram.com/reel/XyZ789/?igsh=basura'];

describe('SoundCloudEmbed', () => {
  it('no trae ningún iframe ni ninguna petición a SoundCloud', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('w.soundcloud.com/player/api.js');
    // La URL del reproductor viaja en un atributo: no se pide hasta el clic.
    expect(html).toMatch(/data-player-src="[^"]*w\.soundcloud\.com/);
  });

  it('sin JavaScript la fachada es un enlace a SoundCloud, en otra pestaña', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    expect(html).toContain(`href="${SITE.social.soundcloud}"`);
    expect(html).toMatch(/data-facade[^>]*data-load|data-load[^>]*data-facade/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain(SOCIAL_TEXT.soundcloud.openLabel);
    expect(html).toContain('(se abre en otra pestaña)');
  });

  it('lleva el título de la pista, el aviso y el cursor del sistema sobre el iframe (C10)', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    expect(html).toContain(SOUNDCLOUD.trackTitle);
    expect(html).toContain(SOCIAL_TEXT.soundcloud.notice);
    expect(html).toContain('data-native-cursor');
  });

  it('el reproductor que se cargará arranca sonando (quien pulsa quiere oírlo)', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    const src = /data-player-src="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(src.replace(/&#38;|&amp;/g, '&')).toContain('auto_play=true');
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
