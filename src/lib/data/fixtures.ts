/**
 * Datos de prueba para los tests e2e (`DATA_SOURCE=fixtures`).
 * Las fechas quedan muy lejos de hoy para que el reparto entre próximas y
 * archivo no cambie con el tiempo. Cubren los casos límite de C13: la fecha
 * más larga, el nombre de fiesta más largo, fiesta sin nombre, lineup vacío,
 * lineup de diez artistas y enlace de entradas.
 */
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
