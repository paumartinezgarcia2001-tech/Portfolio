/**
 * Datos estructurados (C20).
 */
import { SITE } from '../config/site';
import type { Gig } from './data/core';

/** Ciudades fuera de España que aparecen en el archivo. */
const COUNTRY_BY_CITY: Record<string, string> = {
  tangier: 'MA',
  'tánger': 'MA',
  tanger: 'MA',
};

export function countryForCity(city: string): string {
  return COUNTRY_BY_CITY[city.trim().toLowerCase()] ?? 'ES';
}

/** JSON-LD `MusicEvent` para una próxima fecha. */
export function musicEventLd(gig: Gig): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicEvent',
    name: gig.partyName ?? `${SITE.name} en ${gig.venue}`,
    startDate: gig.eventDate,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: gig.venue,
      address: {
        '@type': 'PostalAddress',
        addressLocality: gig.city,
        addressCountry: countryForCity(gig.city),
      },
    },
    performer: {
      '@type': 'Person',
      name: SITE.name,
      sameAs: [SITE.social.instagram, SITE.social.soundcloud],
    },
    ...(gig.ticketUrl ? { offers: { '@type': 'Offer', url: gig.ticketUrl } } : {}),
  };
}

/** Serializa JSON-LD sin que un «</script>» en los datos cierre la etiqueta. */
export function toJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
