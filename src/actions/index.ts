/**
 * Astro Actions de la web.
 *
 * `admin.*` (C19, fase 6): las del panel oculto, en src/actions/admin.ts.
 *
 * `contact.send` (C17, fase 5): el formulario de contacto. Acepta FormData, así
 * que funciona igual desde el script del formulario (fetch, sin recargar) y
 * sin JavaScript (POST del propio formulario; src/pages/contact.astro redirige
 * a `/contact?enviado=1` si sale bien).
 *
 * Solo funciona con servidor (Cloudflare Workers). En el build estático de
 * GitHub Pages el formulario no se muestra (ver astro.config.pages.mjs).
 */
import { ActionError, defineAction } from 'astro:actions';
import {
  CONTACT_FROM_EMAIL,
  CONTACT_TO_EMAIL,
  RESEND_API_KEY,
  RESEND_API_URL,
  TURNSTILE_SECRET_KEY,
  TURNSTILE_VERIFY_URL,
} from 'astro:env/server';
import { getRateLimitStore } from '../lib/contact/bindings';
import { contactOutcomeError, handleContact } from '../lib/contact/handler';
import { contactSchema } from '../lib/contact/schema';
import { admin } from './admin';

/** IP de quien envía (cabecera `CF-Connecting-IP` en Cloudflare). */
function clientIp(context: { clientAddress: string }): string | undefined {
  try {
    return context.clientAddress;
  } catch {
    return undefined;
  }
}

export const server = {
  admin,
  contact: {
    send: defineAction({
      accept: 'form',
      input: contactSchema,
      handler: async (input, context) => {
        const outcome = await handleContact(input, {
          config: {
            turnstileSecret: TURNSTILE_SECRET_KEY,
            resendApiKey: RESEND_API_KEY,
            to: CONTACT_TO_EMAIL,
            from: CONTACT_FROM_EMAIL,
            turnstileVerifyUrl: TURNSTILE_VERIFY_URL,
            resendApiUrl: RESEND_API_URL,
          },
          store: getRateLimitStore(),
          clientIp: clientIp(context),
        });
        const error = contactOutcomeError(outcome);
        if (error) throw new ActionError(error);
        // Lo mismo con el honeypot relleno: el bot no sabe que se ha descartado.
        return { ok: true as const };
      },
    }),
  },
};
