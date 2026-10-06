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
 * - Instagram es una **fachada**: en el HTML no puede haber nada de Meta.
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

  it('sin aviso de cookies debajo: lo dicen los propios widgets (Luna ✓ 02-10)', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    expect(html).not.toContain('embed__notice');
    expect(html).not.toMatch(/cookies/i);
  });

  it('debajo, el enlace al perfil: «soundcloud ↗» (Luna ✓ 02-10)', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    expect(SOCIAL_TEXT.soundcloud.profileLabel).toBe('soundcloud');
    expect(html).toContain('embed__link');
    expect(html).toContain(`href="${SITE.social.soundcloud}"`);
    expect(html).toContain(SOCIAL_TEXT.soundcloud.profileLabel);
    expect(html).toContain('(se abre en otra pestaña)');
  });

  it('con el reproductor puesto, la fachada no se pinta', async () => {
    const html = await container.renderToString(SoundCloudEmbed);
    // El único enlace a SoundCloud es el del perfil, debajo; la fachada no está.
    expect(html).not.toContain('sc__facade');
    expect(html).not.toContain(SOCIAL_TEXT.soundcloud.openLabel);
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
    expect(html).not.toContain('instagram-media');
  });

  it('un blockquote del embed oficial por publicación, con su permalink', async () => {
    const html = await container.renderToString(InstagramPosts, { props: { posts: POSTS } });
    expect(html.match(/class="instagram-media"/g)).toHaveLength(2);
    expect(html).toContain('data-instgrm-permalink="https://www.instagram.com/p/AbC123/"');
    // Los parámetros de compartir se quedan fuera.
    expect(html).toContain('data-instgrm-permalink="https://www.instagram.com/reel/XyZ789/"');
    expect(html).not.toContain('igsh');
    expect(html).toContain('data-instgrm-version="14"');
  });

  it('cada blockquote lleva dentro su enlace: es lo que se ve sin JavaScript', async () => {
    const html = await container.renderToString(InstagramPosts, { props: { posts: POSTS } });
    expect(html).toContain('href="https://www.instagram.com/p/AbC123/"');
    expect(html).toContain(SOCIAL_TEXT.instagram.postLabel(1));
    expect(html).toContain(SOCIAL_TEXT.instagram.postLabel(2));
    expect(html).toContain('(se abre en otra pestaña)');
    // Y no hay botón de cargar nada: se cargan solas (Luna ✓ 02-10).
    expect(html).not.toContain('<button');
  });

  it('descarta las URLs que no son publicaciones', async () => {
    const html = await container.renderToString(InstagramPosts, {
      props: { posts: [...POSTS, 'https://www.instagram.com/travest15m0/', 'cualquier cosa'] },
    });
    expect(html.match(/data-instgrm-permalink/g)).toHaveLength(2);
  });

  it('debajo, el enlace al perfil: «instagram ↗», y sin aviso de cookies', async () => {
    const html = await container.renderToString(InstagramPosts, { props: { posts: POSTS } });
    expect(SOCIAL_TEXT.instagram.profileLabel).toBe('instagram');
    expect(html).toContain('embed__link');
    expect(html).toContain(SOCIAL_TEXT.instagram.profileLabel);
    expect(html).toContain(`href="${SITE.social.instagram}"`);
    expect(html).not.toContain('embed__notice');
    expect(html).not.toMatch(/cookies/i);
  });
});
