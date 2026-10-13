import { describe, expect, it } from 'vitest';
import { MEDIA_WALL, WALL_FILTERS, type MediaWallConfig } from '../../src/config/media-wall';
import type { Gig } from '../../src/lib/data/core';
import {
  WallSimulation,
  coverUv,
  edgeEnvelope,
  layoutLanes,
  pieceProgress,
  resolveMediaWall,
  shortDate,
  styleAmount,
  wallTags,
  type WallClientConfig,
} from '../../src/lib/media-wall';
import { seededRandom } from '../../src/lib/shuffle';

const BASE = 'https://media.example.test';
const METRICS = { captionH: 22, tagH: 24 };

function gig(eventDate: string, partyName: string | null, venue = 'SIROCO', city = 'Madrid'): Gig {
  return { id: `${eventDate}-${partyName}`, eventDate, partyName, venue, city, lineup: [], ticketUrl: null };
}

const GIGS = [
  gig('2026-06-28', 'Insulto Club'),
  gig('2026-05-10', 'La Mari', 'LA MARIQUEEN'),
  gig('2026-07-01', 'Insulto Club'),
  gig('2025-11-27', null, 'Apolo', 'Barcelona'),
];

function client(overrides: Partial<MediaWallConfig> = {}, gigs: Gig[] = GIGS): WallClientConfig {
  const wall = resolveMediaWall({ ...MEDIA_WALL, enabled: true, ...overrides }, BASE, gigs);
  if (!wall) throw new Error('sin muro');
  return wall.client;
}

describe('resolveMediaWall', () => {
  it('resuelve las piezas del código con la base de R2', () => {
    const { items, rest } = client();
    expect(items.length).toBe(MEDIA_WALL.items.length);
    for (const item of items) {
      expect(item.image.jpg.startsWith(`${BASE}/wall/`)).toBe(true);
      expect(item.aspect).toBeGreaterThan(0);
      if (item.kind === 'video') expect(item.video?.mp4).toMatch(/loop\.mp4$/);
    }
    expect(rest).toHaveLength(WALL_FILTERS.length);
  });

  it('sin base (rutas relativas), apagado o sin piezas → null', () => {
    expect(resolveMediaWall(MEDIA_WALL, undefined)).toBeNull();
    expect(resolveMediaWall({ ...MEDIA_WALL, enabled: false }, BASE)).toBeNull();
    expect(resolveMediaWall({ ...MEDIA_WALL, items: [] }, BASE)).toBeNull();
  });

  it('un vídeo sin bucle no entra; el filtro fijo se respeta', () => {
    const wall = client({
      items: [
        { id: 'a', kind: 'video', title: 'A', image: { jpg: 'a.jpg' }, width: 9, height: 16 },
        { id: 'b', kind: 'image', title: 'B', image: { jpg: 'b.jpg' }, width: 4, height: 5, filter: 'dither' },
      ],
    });
    expect(wall.items.map((i) => i.id)).toEqual(['b']);
    expect(wall.items[0]?.filter).toBe(WALL_FILTERS.indexOf('dither'));
    expect(wall.items[0]?.caption).toBe('B');
  });

  it('el JSON para el navegador no lleva nada que no sea serializable', () => {
    const json = JSON.stringify(client());
    expect(JSON.parse(json)).toEqual(client());
  });
});

describe('rótulos de bolos', () => {
  it('los más recientes primero, sin repetir fiesta, en mayúsculas', () => {
    expect(wallTags(GIGS, 10)).toEqual([
      'INSULTO CLUB · SIROCO, MADRID · 01.07.26',
      'LA MARI · LA MARIQUEEN, MADRID · 10.05.26',
      'APOLO, BARCELONA · 27.11.25',
    ]);
    expect(wallTags(GIGS, 1)).toHaveLength(1);
    expect(shortDate('2026-06-28')).toBe('28.06.26');
  });
});

describe('curvas', () => {
  it('el recorrido va de 0 (asoma arriba) a 1 (se va abajo)', () => {
    expect(pieceProgress(-100, 100, 900)).toBe(0);
    expect(pieceProgress(900, 100, 900)).toBe(1);
    expect(pieceProgress(400, 100, 900)).toBeCloseTo(0.5);
  });

  it('filtrada en los bordes y nítida en el centro', () => {
    expect(edgeEnvelope(0)).toBe(1);
    expect(edgeEnvelope(1)).toBe(1);
    expect(edgeEnvelope(0.5)).toBe(0);
    expect(edgeEnvelope(0.4)).toBe(0);
    expect(edgeEnvelope(0.1)).toBeGreaterThan(0.5);
  });

  it('el estilo baja al reposo en el centro y el ratón lo limpia', () => {
    expect(styleAmount(1, 0.3, 0)).toBe(1);
    expect(styleAmount(0, 0.3, 0)).toBeCloseTo(0.3);
    expect(styleAmount(1, 0.3, 1)).toBe(0);
  });

  it('cover con punto focal', () => {
    // Imagen 9:16 en una caja cuadrada: se recorta en vertical, centrada.
    const [sx, sy, ox, oy] = coverUv(900, 1600, 300, 300, 0.5, 0.5);
    expect(sx).toBe(1);
    expect(sy).toBeCloseTo(900 / 1600);
    expect(ox).toBe(0);
    expect(oy).toBeCloseTo((1 - 900 / 1600) / 2);
    // Imagen apaisada en caja vertical, foco a la izquierda.
    expect(coverUv(1600, 900, 300, 600, 0, 0.5)[2]).toBe(0);
  });
});

describe('carriles', () => {
  it('2 en estrecho, 3 en ancho; velocidad = alto ÷ segundos × multiplicador', () => {
    const config = client();
    const narrow = layoutLanes(375, 812, config);
    const wide = layoutLanes(720, 900, config);
    expect(narrow).toHaveLength(config.lanes.narrow);
    expect(wide).toHaveLength(config.lanes.wide);
    expect(wide[0]?.speed).toBeCloseTo((900 / config.crossSeconds) * (config.laneSpeeds[0] ?? 1));
    // Caben dentro del panel, con margen a los lados.
    const last = wide[wide.length - 1]!;
    expect(wide[0]!.x).toBeGreaterThan(0);
    expect(last.x + last.width).toBeLessThan(720);
  });
});

describe('WallSimulation', () => {
  function run(width: number, height: number, seconds: number, seed = 1) {
    const sim = new WallSimulation(client(), METRICS, seededRandom(seed));
    sim.resize(width, height);
    const samples: number[] = [];
    for (let t = 0; t < seconds; t += 1 / 60) {
      sim.step(1 / 60);
      samples.push(sim.pieces.length);
    }
    return { sim, samples };
  }

  it('el panel nunca se queda vacío: siempre hay piezas tapando arriba y abajo', () => {
    const { sim } = run(720, 900, 0);
    for (let t = 0; t < 60; t += 1 / 30) {
      sim.step(1 / 30);
      for (let lane = 0; lane < sim.lanes.length; lane++) {
        const pieces = sim.pieces.filter((p) => p.lane === lane);
        // Lo más alto del carril está por encima del borde superior (o justo en el hueco).
        const top = Math.min(...pieces.map((p) => p.y));
        expect(top).toBeLessThanOrEqual(sim.lanes[lane]!.width * (MEDIA_WALL.gap[1] + 0.01));
        // Y siempre hay algo a la vista.
        expect(pieces.some((p) => p.y < 900 && p.y + p.h > 0)).toBe(true);
      }
    }
  });

  it('velocidad constante: cada pieza baja lo mismo en cada paso', () => {
    const { sim } = run(720, 900, 1);
    const piece = sim.pieces.find((p) => p.lane === 0)!;
    const before = piece.y;
    sim.step(0.5);
    const mid = piece.y;
    sim.step(0.5);
    expect(mid - before).toBeCloseTo(piece.y - mid, 6);
    expect(mid - before).toBeCloseTo(sim.lanes[0]!.speed * 0.5, 6);
  });

  it('la misma semilla da el mismo muro (exportación determinista)', () => {
    const a = run(405, 720, 10, 42).sim.pieces.map((p) => [p.ref, p.kind, p.filter, Math.round(p.y)]);
    const b = run(405, 720, 10, 42).sim.pieces.map((p) => [p.ref, p.kind, p.filter, Math.round(p.y)]);
    expect(a).toEqual(b);
  });

  it('las piezas que salen se quitan: la memoria no crece', () => {
    const { samples } = run(720, 900, 120);
    const max = Math.max(...samples);
    expect(max).toBeLessThan(30);
    expect(samples[samples.length - 1]).toBeGreaterThan(0);
  });

  it('nunca dos rótulos seguidos en un carril y el filtro cambia respecto al anterior', () => {
    const { sim } = run(720, 900, 90);
    for (let lane = 0; lane < sim.lanes.length; lane++) {
      const pieces = sim.pieces.filter((p) => p.lane === lane);
      for (let i = 1; i < pieces.length; i++) expect(pieces[i]!.kind === 'tag' && pieces[i - 1]!.kind === 'tag').toBe(false);
      const items = pieces.filter((p) => p.kind === 'item');
      for (let i = 1; i < items.length; i++) expect(items[i]!.filter).not.toBe(items[i - 1]!.filter);
    }
  });

  it('el puntero limpia la pieza que tiene debajo, y solo esa', () => {
    const { sim } = run(720, 900, 2);
    const piece = sim.pieces.find((p) => p.kind === 'item' && p.y > 0 && p.y + p.mediaH < 900)!;
    const freeze = { ...sim.lanes[piece.lane]! };
    expect(freeze.speed).toBeGreaterThan(0);
    sim.setPointer({ x: piece.x + piece.w / 2, y: piece.y + piece.mediaH / 2 });
    for (let i = 0; i < 20; i++) sim.step(1 / 60);
    expect(piece.hover).toBeGreaterThan(0.85);
    expect(sim.pieces.filter((p) => p.hover > 0.5)).toHaveLength(1);
    expect(sim.pieceAt(piece.x + 1, piece.y + 1)).toBe(piece);
    sim.setPointer(null);
    for (let i = 0; i < 60; i++) sim.step(1 / 60);
    expect(piece.hover).toBe(0);
  });

  it('al cambiar solo el alto (barra del navegador en móvil) conserva las piezas', () => {
    const { sim } = run(375, 700, 3);
    const ids = sim.pieces.map((p) => p.id);
    sim.resize(375, 760);
    expect(sim.pieces.map((p) => p.id).slice(-ids.length)).toEqual(ids);
  });
});
