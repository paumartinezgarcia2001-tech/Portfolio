/**
 * Secretos de prueba del preview para los e2e del panel. Como
 * tests/e2e/dev-vars.mjs: sobrescribe `dist/server/.dev.vars`, que es lo que
 * lee `astro preview`, con valores inventados. Nunca los de verdad.
 *
 * R2: una cuenta inventada y `R2_ENDPOINT` apuntando al R2 simulado
 * (tests/e2e-admin/mock-r2.mjs, puerto 4325): el Worker lista y comprueba
 * ahí, y el navegador sube ahí. No sale nada.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'dist', 'server');

const VARS = {
  ADMIN_PATH: process.env.E2E_ADMIN_PATH ?? 'panel-e2e',
  ADMIN_USERNAME: 'pau',
  ADMIN_EMAIL: 'pau@e2e.test',
  R2_ACCOUNT_ID: 'e2e-account',
  R2_ACCESS_KEY_ID: 'e2e-access-key',
  R2_SECRET_ACCESS_KEY: 'e2e-secret-key',
  R2_BUCKET: 'e2e-bucket',
  R2_ENDPOINT: `http://127.0.0.1:${process.env.E2E_R2_PORT ?? 4325}`,
};

mkdirSync(DIR, { recursive: true });
const file = path.join(DIR, '.dev.vars');
writeFileSync(file, `${Object.entries(VARS).map(([key, value]) => `${key}='${value}'`).join('\n')}\n`);
console.log(`[e2e] Secretos de prueba del panel escritos en ${path.relative(ROOT, file)}`);
