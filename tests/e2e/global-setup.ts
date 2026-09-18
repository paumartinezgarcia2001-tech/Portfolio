/**
 * Prepara el vídeo de los tests e2e de Media (C15) antes de que empiecen.
 *
 * - Genera un vídeo de 6 s con un patrón de ffmpeg y lo pasa por el mismo
 *   pipeline que el vídeo real (`scripts/video-to-hls.mjs`), a
 *   `.media/video/e2e-fixture/` (en .gitignore). Lo sirve
 *   `scripts/serve-media.mjs` (ver playwright.config.ts).
 * - En AV1 + Opus: el Chromium de Playwright no trae H.264 ni AAC.
 * - Solo se regenera si cambia el pipeline.
 * - Sin ffmpeg (o sin AV1/Opus), los tests de Media se saltan y lo dicen:
 *   `E2E_MEDIA` lleva el motivo.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_DIR = path.join(ROOT, '.media', 'video', 'e2e-fixture');
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

function stampOf(): string {
  const hash = createHash('sha256');
  for (const file of ['scripts/video-to-hls.mjs', 'scripts/lib/video.mjs']) hash.update(readFileSync(path.join(ROOT, file)));
  hash.update(JSON.stringify([SOURCE_ARGS, PIPELINE_ARGS]));
  return hash.digest('hex');
}

function unavailable(reason: string): void {
  process.env.E2E_MEDIA = reason;
  console.warn(`[e2e] Los tests de Media se saltan: ${reason}`);
}

export default function globalSetup(): void {
  const version = spawnSync(FFMPEG, ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (version.status !== 0) return unavailable('no hay ffmpeg (Windows: winget install Gyan.FFmpeg)');

  const stamp = stampOf();
  if (existsSync(STAMP) && readFileSync(STAMP, 'utf8') === stamp) {
    process.env.E2E_MEDIA = 'ok';
    return;
  }

  mkdirSync(path.dirname(SOURCE), { recursive: true });
  const source = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...SOURCE_ARGS, SOURCE], { encoding: 'utf8' });
  if (source.status !== 0) return unavailable(`ffmpeg no ha podido crear el vídeo de prueba: ${source.stderr.trim()}`);

  const pipeline = spawnSync(process.execPath, [path.join(ROOT, 'scripts/video-to-hls.mjs'), SOURCE, ...PIPELINE_ARGS], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (pipeline.status !== 0) {
    return unavailable(`el pipeline ha fallado: ${(pipeline.stderr || pipeline.stdout).trim().split('\n').slice(-3).join(' ')}`);
  }
  writeFileSync(STAMP, stamp);
  process.env.E2E_MEDIA = 'ok';
}
