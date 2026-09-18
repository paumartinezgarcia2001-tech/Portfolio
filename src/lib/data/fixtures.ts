/**
 * Datos de prueba para los tests e2e (`DATA_SOURCE=fixtures`).
 * Las fechas quedan muy lejos de hoy para que el reparto entre próximas y
 * archivo no cambie con el tiempo. Cubren los casos límite de C13: la fecha
 * más larga, el nombre de fiesta más largo, fiesta sin nombre, lineup vacío,
 * lineup de diez artistas y enlace de entradas.
 */
import { LAGRIMA_FULL_SET, type MediaVideoConfig } from '../../config/media';
import type { Gig, SiteSettings } from './core';

export const FIXTURE_SETTINGS: SiteSettings = {
  tickerText: 'travest15m0 · DJ · Madrid',
  tickerAppendNextGig: true,
};

export const FIXTURE_GIGS: Gig[] = [
  // Próximas (orden de alta desordenado a propósito)
  {
    id: 'fixture-next-2',
    eventDate: '2099-10-02',
    partyName: null,
    venue: 'LA2',
    city: 'Sevilla',
    lineup: [],
    ticketUrl: null,
  },
  {
    id: 'fixture-next-1',
    eventDate: '2099-09-30',
    partyName: 'INSULTO CLUB & ELEMENTS CAVE & BELLADONA',
    venue: 'SIROCO',
    city: 'Madrid',
    lineup: [
      'TRAVEST15M0',
      'GOTINGA',
      'NIXY',
      'JVGGEDDOGGIE',
      'TRENZARK',
      'PULPIX',
      'TRIXYTRICKS',
      'BABYLON WHORE',
      'BELIAL',
      'Artista Invitada',
    ],
    ticketUrl: null,
  },
  {
    id: 'fixture-next-3',
    eventDate: '2099-12-31',
    partyName: 'LA MARI',
    venue: 'LA MARIQUEEN',
    city: 'Madrid',
    lineup: ['MANUELAC0RE', 'TRAVEST15M0', 'NEGRACONDA'],
    ticketUrl: 'https://example.com/entradas',
  },
  // Archivo
  {
    id: 'fixture-past-2',
    eventDate: '2021-05-20',
    partyName: 'WATEKE / KANDELA',
    venue: 'EVEN',
    city: 'Sevilla',
    lineup: ['KIEVRA', 'ELEKTRONIK BOY', 'TRAVEST15M0'],
    ticketUrl: null,
  },
  {
    id: 'fixture-past-1',
    eventDate: '2021-09-30',
    partyName: 'LAS NIÑAS',
    venue: 'SALA YASTA',
    city: 'Madrid',
    lineup: ['BELIAL', 'BERRENGA', 'PAKITA', 'TRAVEST15M0'],
    ticketUrl: null,
  },
  {
    id: 'fixture-past-3',
    eventDate: '2021-01-06',
    partyName: 'LACHE',
    venue: 'SALA X',
    city: 'Sevilla',
    lineup: [],
    ticketUrl: null,
  },
];

/**
 * Vídeo de los tests e2e: lo genera `tests/e2e/global-setup.ts` en
 * `.media/video/e2e-fixture/` a partir de un patrón de ffmpeg, en AV1 + Opus
 * (el Chromium de Playwright no trae H.264 ni AAC). Lleva el enlace al set
 * para probar ese control.
 */
export const FIXTURE_VIDEO: MediaVideoConfig = {
  slug: 'e2e-fixture',
  title: 'Vídeo de prueba (tests)',
  audio: true,
  hls: 'video/e2e-fixture/4x5/master.m3u8',
  mp4: 'video/e2e-fixture/4x5/fallback.mp4',
  poster: { jpg: 'video/e2e-fixture/4x5/poster.jpg', avif: 'video/e2e-fixture/4x5/poster.avif' },
  width: 360,
  height: 450,
  mobile: {
    hls: 'video/e2e-fixture/9x16/master.m3u8',
    mp4: 'video/e2e-fixture/9x16/fallback.mp4',
    poster: { jpg: 'video/e2e-fixture/9x16/poster.jpg', avif: 'video/e2e-fixture/9x16/poster.avif' },
    width: 360,
    height: 640,
  },
  focusX: 0.5,
  focusY: 0.5,
  fullSet: LAGRIMA_FULL_SET,
};
