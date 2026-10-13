#!/usr/bin/env node
// @ts-check
/**
 * Exporta el muro de Media (D65) a vídeo con el mismo motor de la web.
 *
 * Abre `/media?wall-render` en Chromium (Playwright), avanza la simulación a
 * paso fijo y semilla fija, pinta cada fotograma con WebGL y lo encadena con
 * ffmpeg en un MP4 H.264 que hace bucle sin corte (el último segundo se funde
 * con el primero).
 *
 * Sirve para dos cosas:
 * - el bucle de los dispositivos sin WebGL (`MEDIA_WALL.fallback`), en 4:5
 *   (escritorio) y 9:16 (móvil);
 * - piezas para redes (stories, reels) con `--aspect 9x16` o `--aspect 1x1`.
 *
 * Uso (con la web sirviéndose, p. ej. `npm run dev` y `npm run media:serve`):
 *   node scripts/media-wall-render.mjs [--url http://localhost:4321/media] [opciones]
 *
 *   --aspect 4x5|9x16|1x1|all   proporción (por defecto, 4x5 y 9x16)
 *   --seconds 20                duración del bucle
 *   --fps 30
 *   --seed 7                    semilla: misma semilla, mismo vídeo
 *   --width 720                 ancho del MP4 (se pinta a 1080 y se reduce; 1080 para redes)
 *   --slug wall-loop            nombre de la carpeta de salida
 *   --out .media                salida: <out>/wall/<slug>-<proporción>-<hash>/{loop.mp4,poster.jpg}
 *
 * Necesita ffmpeg y el Chromium de Playwright (`npx playwright install chromium`).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { formatBytes } from './lib/video.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * Tamaño del panel en px CSS y densidad: 1080 px de ancho en el vídeo. 4:5
 * tiene el ancho de media pantalla de escritorio (3 carriles); 9:16, el de un
 * móvil (2 carriles).
 * @type {Record<string, { css: [number, number]; dpr: number }>}
 */
const ASPECTS = {
  '4x5': { css: [720, 900], dpr: 1.5 },
  '9x16': { css: [405, 720], dpr: 1080 / 405 },
  '1x1': { css: [720, 720], dpr: 1.5 },
};

const { values: opts } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4321/media' },
    aspect: { type: 'string', default: '4x5,9x16' },
    seconds: { type: 'string', default: '20' },
    fps: { type: 'string', default: '30' },
    fade: { type: 'string', default: '1' },
    seed: { type: 'string', default: '7' },
    slug: { type: 'string', default: 'wall-loop' },
    out: { type: 'string' },
    crf: { type: 'string', default: '26' },
    width: { type: 'string', default: '720' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (opts.help) {
  console.log(
    'Uso: node scripts/media-wall-render.mjs [--url …/media] [--aspect 4x5,9x16|1x1|all] [--seconds 20] [--fps 30] [--seed 7] [--slug wall-loop] [--out .media]',
  );
  process.exit(0);
}

const seconds = Number(opts.seconds);
const fps = Number(opts.fps);
const fade = Number(opts.fade);
if (!(seconds > fade * 2) || !(fps > 0) || !(fade > 0)) fail('--seconds tiene que ser mayor que 2 × --fade, y --fps mayor que 0.');
const aspects = opts.aspect === 'all' ? Object.keys(ASPECTS) : opts.aspect.split(',').map((a) => a.trim());
for (const a of aspects) if (!ASPECTS[a]) fail(`Proporción desconocida: ${a} (${Object.keys(ASPECTS).join(', ')})`);
const outWidth = Math.round(Number(opts.width));
if (!(outWidth >= 240 && outWidth <= 2160)) fail('--width tiene que estar entre 240 y 2160.');
const outRoot = opts.out ? path.resolve(opts.out) : path.join(ROOT, '.media');

/** Arranque: se pintan los primeros segundos sin grabar, para que no se vea la colocación inicial. */
const WARM_UP = 2;
/** Solo el muro, a pantalla completa, sin la capa CRT, el cursor ni los controles. */
const ISOLATE_CSS = `
  body * { visibility: hidden !important; }
  media-wall, media-wall * { visibility: visible !important; }
  media-wall { position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; }
  .media-wall__controls, .media-wall__index, .media-wall__viewer { display: none !important; }
`;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/** @type {string[]} */
const blocks = [];
try {
  for (const aspect of aspects) {
    const { css, dpr } = /** @type {{ css: [number, number]; dpr: number }} */ (ASPECTS[aspect]);
    const page = await browser.newPage({ viewport: { width: css[0], height: css[1] }, deviceScaleFactor: dpr });
    page.on('pageerror', (error) => console.error(`  [página] ${error.message}`));
    const url = new URL(opts.url);
    url.searchParams.set('wall-render', '');
    url.searchParams.set('wall-seed', opts.seed);
    await page.goto(url.toString(), { waitUntil: 'load' });
    await page.addStyleTag({ content: ISOLATE_CSS });
    // En móvil la web abre en el menú (D44): que el panel cuente como visible.
    await page.evaluate(() => (document.documentElement.dataset.view = 'page'));
    const ready = await page
      .waitForFunction(() => 'window' in globalThis && /** @type {any} */ (window).__mediaWall, null, { timeout: 15_000 })
      .then(() => page.evaluate(() => /** @type {any} */ (window).__mediaWall.ready()))
      .catch(() => false);
    if (!ready) fail(`No hay muro en ${opts.url} (¿está la web en marcha, con el muro encendido y WebGL?).`);

    const frames = Math.round((seconds + fade) * fps);
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'wall-render-'));
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      const t = WARM_UP + i / fps;
      const dataUrl = await page.evaluate((time) => /** @type {any} */ (window).__mediaWall.frame(time), t);
      if (typeof dataUrl !== 'string') fail('El muro no ha devuelto el fotograma.');
      await writeFile(path.join(tmp, `f${String(i).padStart(5, '0')}.png`), Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'));
      if (i % fps === 0) process.stdout.write(`\r  ${aspect}: ${Math.round((i / frames) * 100)} %`);
    }
    await page.close();
    process.stdout.write(`\r  ${aspect}: 100 % (${Math.round((Date.now() - started) / 1000)} s)\n`);

    const hash = createHash('sha256').update(JSON.stringify({ aspect, seconds, fps, fade, seed: opts.seed, url: opts.url, outWidth, at: Date.now() })).digest('hex');
    const folder = `${opts.slug}-${aspect}-${hash.slice(0, 8)}`;
    const dir = path.join(outRoot, 'wall', folder);
    await mkdir(dir, { recursive: true });
    // Bucle sin corte: el tramo [fade, seconds + fade) con su último segundo
    // fundido sobre el primero ([0, fade)).
    const filter = [
      `[0:v]split[a][b]`,
      `[a]trim=start=${fade}:end=${seconds + fade},setpts=PTS-STARTPTS[main]`,
      `[b]trim=start=0:end=${fade},setpts=PTS-STARTPTS[head]`,
      `[main][head]xfade=transition=fade:duration=${fade}:offset=${seconds - fade},scale=${outWidth}:-2:flags=lanczos,format=yuv420p[out]`,
    ].join(';');
    const encode = spawnSync(
      FFMPEG,
      [
        '-hide_banner', '-v', 'error', '-y', '-framerate', String(fps), '-i', path.join(tmp, 'f%05d.png'),
        '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow',
        '-crf', opts.crf, '-movflags', '+faststart', path.join(dir, 'loop.mp4'),
      ],
      { encoding: 'utf8' },
    );
    if (encode.status !== 0) fail(`ffmpeg: ${encode.stderr.trim().split('\n').slice(-4).join('\n')}`);
    spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-i', path.join(dir, 'loop.mp4'), '-frames:v', '1', '-q:v', '3', path.join(dir, 'poster.jpg')]);
    await rm(tmp, { recursive: true, force: true });

    const size = (await stat(path.join(dir, 'loop.mp4'))).size;
    console.log(`  ✓ ${path.relative(process.cwd(), dir)}/loop.mp4 · ${formatBytes(size)}`);
    const [w, h] = [outWidth, Math.round((outWidth * css[1]) / css[0] / 2) * 2];
    if (existsSync(path.join(dir, 'poster.jpg'))) {
      blocks.push(`${aspect === '9x16' ? 'narrow' : 'wide'}: { mp4: 'wall/${folder}/loop.mp4', poster: 'wall/${folder}/poster.jpg', width: ${w}, height: ${h} },`);
    }
  }
} finally {
  await browser.close();
}

if (aspects.includes('4x5') && aspects.includes('9x16')) {
  console.log(`\nPara src/config/media-wall.ts (MEDIA_WALL.fallback):\n\nfallback: {\n  ${blocks.filter((b) => !b.includes('1x1')).join('\n  ')}\n},`);
} else {
  console.log(`\n${blocks.join('\n')}`);
}
