import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import MixPlayer from '../../src/components/MixPlayer.astro';
import type { Mix } from '../../src/lib/data/core';

/** C06 · lo que sale del servidor antes de que el script tome el control. */

const MIXES: Mix[] = [
  { id: 'a', title: 'Mix </script> A', subtitle: null, src: 'https://media.example/mixes/a-1234abcd.mp3', durationSeconds: 60, artwork: null },
  { id: 'b', title: 'Mix B', subtitle: 'prueba', src: 'https://media.example/mixes/b-5678abcd.mp3', durationSeconds: 90, artwork: 'https://media.example/mixes/b-5678abcd.jpg' },
];

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

// Solo los mixes: lo demás de `App.Locals` (p. ej. el contexto de Cloudflare) no hace falta aquí.
const render = (mixes: Mix[]) => container.renderToString(MixPlayer, { locals: { mixes } as unknown as App.Locals });

describe('MixPlayer', () => {
  it('con mixes: un solo <audio> sin precarga, tres botones y los datos en JSON (D43)', async () => {
    const html = await render(MIXES);
    expect(html.match(/<audio\b/g)).toHaveLength(1);
    expect(html).toMatch(/<audio[^>]*preload="none"/);
    expect(html).toMatch(/<audio[^>]*crossorigin="anonymous"/);
    expect(html).toContain('data-state="idle"');
    expect(html).toMatch(/<mix-player[^>]*data-autoplay/);
    for (const label of ['Mix anterior', 'Reproducir', 'Mix siguiente']) expect(html).toContain(`aria-label="${label}"`);
    expect(html.match(/<button\b/g)).toHaveLength(3);
    expect(html).not.toMatch(/<button[^>]*disabled/);
    // Ningún texto a la vista: solo los botones.
    expect(html).not.toContain('próximamente');

    const json = /<script type="application\/json" data-mixes>([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(json).toBeDefined();
    // Un título con «</script>» no puede cerrar la etiqueta antes de tiempo.
    expect(json).not.toContain('</');
    expect(JSON.parse(json!)).toEqual([
      { id: 'a', title: 'Mix </script> A', subtitle: null, src: MIXES[0]!.src, artwork: null },
      { id: 'b', title: 'Mix B', subtitle: 'prueba', src: MIXES[1]!.src, artwork: MIXES[1]!.artwork },
    ]);
  });

  it('sin mixes: «reproductor — próximamente», botones apagados y ningún <audio>', async () => {
    const html = await render([]);
    expect(html).toContain('reproductor — próximamente');
    expect(html).toContain('data-state="empty"');
    expect(html).not.toMatch(/<mix-player[^>]*data-autoplay/);
    expect(html).not.toContain('<audio');
    expect(html).not.toContain('data-mixes');
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(3);
  });
});
