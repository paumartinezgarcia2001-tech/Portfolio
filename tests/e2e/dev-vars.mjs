/**
 * Secretos de prueba para el preview de los tests e2e (fase 5).
 *
 * `astro preview` levanta el Worker con las variables que el plugin de
 * Cloudflare escribe al compilar en `dist/server/.dev.vars`, a partir del
 * `.dev.vars` o el `.env` de la máquina. En los tests no queremos los secretos
 * de verdad (ni enviar emails), así que este script sobrescribe ese archivo con
 * las claves de prueba. Solo toca `dist/`, que es material de compilación.
 *
 * Lo ejecuta playwright.config.ts entre `npm run build` y `astro preview`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'dist', 'server');

/** Claves de prueba de Cloudflare («siempre pasa») y valores inventados para Resend. */
const VARS = {
  TURNSTILE_SECRET_KEY: process.env.E2E_TURNSTILE_SECRET_KEY ?? '1x0000000000000000000000000000000AA',
  RESEND_API_KEY: 're_e2e_0000000000000000',
  CONTACT_TO_EMAIL: 'pau@e2e.test',
  CONTACT_FROM_EMAIL: 'web@e2e.test',
};

mkdirSync(DIR, { recursive: true });
const file = path.join(DIR, '.dev.vars');
writeFileSync(file, `${Object.entries(VARS).map(([key, value]) => `${key}='${value}'`).join('\n')}\n`);
console.log(`[e2e] Secretos de prueba escritos en ${path.relative(ROOT, file)}`);
