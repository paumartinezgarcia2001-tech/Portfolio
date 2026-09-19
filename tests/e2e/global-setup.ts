/**
 * Prepara los medios de los tests e2e antes de que empiecen: el vídeo de
 * Media (C15) y los mixes del reproductor (C06).
 *
 * - Vídeo: 6 s con un patrón de ffmpeg, pasado por el mismo pipeline que el
 *   vídeo real (`scripts/video-to-hls.mjs`), a `.media/video/e2e-fixture/`.
 *   En AV1 + Opus: el Chromium de Playwright no trae H.264 ni AAC.
 * - Mixes: tres tonos de 20 s en MP3 (como los de verdad), en
 *   `.media/mixes/e2e-mix-{1,2,3}.mp3` (ver FIXTURE_MIXES).
 * - Lo sirve `scripts/serve-media.mjs` (ver playwright.config.ts), en
 *   .gitignore. Solo se regenera si cambia el pipeline o esta receta.
 * - Sin ffmpeg (o sin AV1/Opus/MP3), los tests de Media y del reproductor se
 *   saltan y lo dicen: `E2E_MEDIA` lleva el motivo.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_DIR = path.join(ROOT, '.media', 'video', 'e2e-fixture');
const MIXES_DIR = path.join(ROOT, '.media', 'mixes');
const SOURCE = path.join(ROOT, '.media', '_src', 'e2e-source.mp4');
const STAMP = path.join(FIXTURE_DIR, '.stamp');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/** Patrón de prueba: 360×640 (9:16), 30 fps, 6 s, con un tono de 440 Hz. */
const SOURCE_ARGS = [
  '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
];
const PIPELINE_ARGS = ['--slug', 'e2e-fixture', '--no-hash', '--codec', 'av1', '--ladder', '360,240', '--force', '--quiet'];

/** Mixes de prueba: 20 s cada uno, con tonos distintos. */
const MIX_FREQUENCIES = [330, 440, 550];
const mixArgs = (frequency: number) => [
  '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=44100:duration=20`,
  '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '64k',
];

function stampOf(): string {
  const hash = createHash('sha256');
  for (const file of ['scripts/video-to-hls.mjs', 'scripts/lib/video.mjs']) hash.update(readFileSync(path.join(ROOT, file)));
  hash.update(JSON.stringify([SOURCE_ARGS, PIPELINE_ARGS, MIX_FREQUENCIES.map(mixArgs)]));
  return hash.digest('hex');
}

function unavailable(reason: string): void {
  process.env.E2E_MEDIA = reason;
  console.warn(`[e2e] Los tests de Media y del reproductor se saltan: ${reason}`);
}

function ffmpeg(args: string[]): { ok: boolean; error: string } {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' });
  return { ok: result.status === 0, error: (result.stderr ?? '').trim() };
}

export default function globalSetup(): void {
  const version = spawnSync(FFMPEG, ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (version.status !== 0) return unavailable('no hay ffmpeg (Windows: winget install Gyan.FFmpeg)');

  const stamp = stampOf();
  const mixFiles = MIX_FREQUENCIES.map((_, i) => path.join(MIXES_DIR, `e2e-mix-${i + 1}.mp3`));
  if (existsSync(STAMP) && readFileSync(STAMP, 'utf8') === stamp && mixFiles.every((file) => existsSync(file))) {
    process.env.E2E_MEDIA = 'ok';
    return;
  }

  mkdirSync(path.dirname(SOURCE), { recursive: true });
  const source = ffmpeg([...SOURCE_ARGS, SOURCE]);
  if (!source.ok) return unavailable(`ffmpeg no ha podido crear el vídeo de prueba: ${source.error}`);

  const pipeline = spawnSync(process.execPath, [path.join(ROOT, 'scripts/video-to-hls.mjs'), SOURCE, ...PIPELINE_ARGS], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (pipeline.status !== 0) {
    return unavailable(`el pipeline ha fallado: ${(pipeline.stderr || pipeline.stdout).trim().split('\n').slice(-3).join(' ')}`);
  }

  mkdirSync(MIXES_DIR, { recursive: true });
  for (const [i, frequency] of MIX_FREQUENCIES.entries()) {
    const mix = ffmpeg([...mixArgs(frequency), mixFiles[i]!]);
    if (!mix.ok) return unavailable(`ffmpeg no ha podido crear los mixes de prueba: ${mix.error}`);
  }

  writeFileSync(STAMP, stamp);
  process.env.E2E_MEDIA = 'ok';
}
