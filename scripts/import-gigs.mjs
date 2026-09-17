#!/usr/bin/env node
// @ts-check
/**
 * Importación inicial de bolos desde los .xlsx (prompt maestro §7.4).
 *
 * Uso (desde Portfolio/):
 *   node scripts/import-gigs.mjs --dry-run            → solo el informe
 *   node scripts/import-gigs.mjs --sql bolos.sql      → escribe el SQL (para el SQL Editor o el MCP)
 *   node --env-file=.env scripts/import-gigs.mjs      → upsert con la API de Supabase
 *
 * Por defecto lee:
 *   ../Raw_Files/WEB PAGE FILES/Apartado Archivo.xlsx
 *   ../Raw_Files/WEB PAGE FILES/Apartado Upcoming Events.xlsx
 * Se pueden pasar otros archivos como argumentos. Nunca se usan los .csv.
 *
 * El modo API necesita PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (clave
 * sb_secret_…, solo en local: nunca en el Worker ni en el repo).
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ExcelJS from 'exceljs';
import { COLUMNS, buildUpsertSql, dedupeGigs, diffGigs, normalizeRow, sortGigs } from './lib/gigs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILES = [
  path.resolve(ROOT, '../Raw_Files/WEB PAGE FILES/Apartado Archivo.xlsx'),
  path.resolve(ROOT, '../Raw_Files/WEB PAGE FILES/Apartado Upcoming Events.xlsx'),
];

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'dry-run': { type: 'boolean', default: false },
    sql: { type: 'string' },
    sheet: { type: 'string', default: 'Sheet1' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (options.help) {
  console.log(
    'Uso: node scripts/import-gigs.mjs [--dry-run | --sql salida.sql] [--sheet Sheet1] [archivo.xlsx …]',
  );
  process.exit(0);
}

const files = positionals.length > 0 ? positionals.map((f) => path.resolve(f)) : DEFAULT_FILES;

/**
 * @param {string} file
 * @param {string} sheetName
 */
async function readRows(file, sheetName) {
  if (!file.toLowerCase().endsWith('.xlsx')) throw new Error(`Solo se admiten .xlsx: ${file}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`No existe la hoja «${sheetName}» en ${path.basename(file)}`);

  // Localiza las columnas por su cabecera (fila 1).
  const header = sheet.getRow(1);
  /** @type {Record<string, number>} */
  const index = {};
  header.eachCell((cell, col) => {
    const title = String(cell.value ?? '').trim();
    for (const [key, name] of Object.entries(COLUMNS)) if (title === name) index[key] = col;
  });
  const missing = Object.entries(COLUMNS).filter(([key]) => !(key in index));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas en ${path.basename(file)}: ${missing.map(([, n]) => n).join(', ')}`);
  }

  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    /** @param {string} key */
    const cell = (key) => row.getCell(/** @type {number} */ (index[key])).value;
    rows.push({
      file: path.basename(file),
      row: r,
      raw: {
        partyName: cell('partyName'),
        date: cell('date'),
        venue: cell('venue'),
        city: cell('city'),
        lineup: cell('lineup'),
      },
    });
  }
  return rows;
}

async function main() {
  /** @type {import('./lib/gigs.mjs').Gig[]} */
  const valid = [];
  /** @type {{ file: string, row: number, reason: string }[]} */
  const invalid = [];
  let empty = 0;
  let read = 0;

  for (const file of files) {
    const rows = await readRows(file, options.sheet ?? 'Sheet1');
    let fileValid = 0;
    for (const { file: name, row, raw } of rows) {
      read++;
      const result = normalizeRow(raw);
      if (result.status === 'empty') empty++;
      else if (result.status === 'invalid') invalid.push({ file: name, row, reason: result.reason });
      else {
        valid.push(result.gig);
        fileValid++;
      }
    }
    console.log(`· ${path.basename(file)}: ${fileValid} bolos válidos`);
  }

  const { unique, duplicates } = dedupeGigs(valid);
  const gigs = sortGigs(unique);

  console.log('\nInforme de lectura');
  console.log(`  filas leídas:        ${read}`);
  console.log(`  filas vacías:        ${empty} (ignoradas)`);
  console.log(`  descartadas:         ${invalid.length}`);
  for (const item of invalid) console.log(`    - ${item.file}, fila ${item.row}: ${item.reason}`);
  console.log(`  duplicadas:          ${duplicates.length}`);
  for (const gig of duplicates) console.log(`    - ${gig.event_date} · ${gig.party_name ?? 'TBA'} · ${gig.venue}`);
  console.log(`  bolos únicos:        ${gigs.length}`);

  if (options['dry-run']) return;

  if (options.sql) {
    const out = path.resolve(options.sql);
    await writeFile(out, buildUpsertSql(gigs), 'utf8');
    console.log(`\nSQL escrito en ${out}`);
    console.log('Ejecútalo en el SQL Editor de Supabase (o con el MCP). Devuelve una fila por bolo');
    console.log('insertado (inserted = true) o actualizado (inserted = false).');
    return;
  }

  const url = process.env.PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error(
      'Faltan PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY. Usa `node --env-file=.env scripts/import-gigs.mjs`, o --sql / --dry-run.',
    );
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: existing, error: readError } = await supabase
    .from('gigs')
    .select('event_date, party_name, venue, city, lineup')
    .limit(10000);
  if (readError) throw new Error(`No se pudieron leer los bolos actuales: ${readError.message}`);

  const { toInsert, toUpdate, unchanged } = diffGigs(gigs, existing ?? []);
  const changes = [...toInsert, ...toUpdate];
  if (changes.length > 0) {
    const { error } = await supabase
      .from('gigs')
      .upsert(changes, { onConflict: 'event_date,venue_key,party_key' });
    if (error) throw new Error(`Error al guardar: ${error.message}`);
  }

  console.log('\nInforme de importación');
  console.log(`  insertadas:          ${toInsert.length}`);
  console.log(`  actualizadas:        ${toUpdate.length}`);
  console.log(`  sin cambios:         ${unchanged.length}`);
  console.log(`  descartadas:         ${invalid.length + duplicates.length}`);
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
