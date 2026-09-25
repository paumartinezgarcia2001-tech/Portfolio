import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import ContactForm from '../../src/components/ContactForm.astro';
import SocialLinks from '../../src/components/SocialLinks.astro';
import { CONTACT_FIELDS as FIELD, CONTACT_TEXT as TEXT } from '../../src/config/contact';
import { SITE } from '../../src/config/site';
import { WEB3FORMS_ENDPOINT, WEB3FORMS_SUBJECT } from '../../src/lib/contact/web3forms';

/** C17 · lo que sale del servidor antes de que el script tome el control. */

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

/** Camino de Cloudflare: Action + Turnstile. */
const render = (props: Record<string, unknown> = {}) =>
  container.renderToString(ContactForm, { props: { siteKey: '1x00000000000000000000AA', ...props } });

/** Camino de GitHub Pages: Web3Forms, sin Turnstile. */
const renderStatic = (props: Record<string, unknown> = {}) =>
  container.renderToString(ContactForm, {
    props: {
      web3forms: { accessKey: 'clave-de-prueba', redirect: 'https://ejemplo.test/Portfolio/mensaje-enviado.html' },
      ...props,
    },
  });

describe('ContactForm', () => {
  it('es un formulario POST a la Action, con los tres campos de D58', async () => {
    const html = await render();
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<form[^>]*action="\?_action=contact\.send"/);
    for (const field of [FIELD.email, FIELD.phone, FIELD.message]) {
      expect(html).toContain(`name="${field}"`);
    }
    // Ni nombre, ni motivo, ni fecha, ni casilla de privacidad (D58).
    for (const gone of ['nombre', 'motivo', 'fecha', 'lugar', 'privacidad']) {
      expect(html).not.toContain(`name="${gone}"`);
    }
    // Obligatorios y límites, para que el navegador ayude también sin JavaScript.
    expect(html).toMatch(/name="email"[^>]*required[^>]*maxlength="254"/);
    expect(html).toMatch(/name="mensaje"[^>]*minlength="10"[^>]*maxlength="3000"/);
    // El teléfono es opcional, pero con formato.
    expect(html).not.toMatch(/name="telefono"[^>]*required/);
    expect(html).toMatch(/name="telefono"[^>]*pattern="/);
  });

  it('el honeypot es una casilla escondida, fuera del foco y del lector de pantalla', async () => {
    const html = await render();
    expect(html).toMatch(new RegExp(`name="${FIELD.honeypot}"[^>]*type="checkbox"`));
    expect(html).toMatch(new RegExp(`name="${FIELD.honeypot}"[^>]*style="display: none;"`));
    expect(html).toMatch(new RegExp(`name="${FIELD.honeypot}"[^>]*tabindex="-1"`));
    expect(html).toMatch(new RegExp(`name="${FIELD.honeypot}"[^>]*aria-hidden="true"`));
  });

  it('deja el hueco de Turnstile con la clave pública y el cursor del sistema', async () => {
    const html = await render();
    expect(html).toMatch(/data-turnstile data-sitekey="1x00000000000000000000AA" data-native-cursor/);
    // Sin JavaScript no hay widget: se avisa.
    expect(html).toContain(TEXT.noscript);
  });

  it('enlaza la política de privacidad sin casilla que marcar', async () => {
    const html = await render();
    expect(html).toContain('href="/privacidad"');
    expect(html).toContain(TEXT.labels.privacyBefore);
    expect(html).not.toContain('type="checkbox" required');
  });

  it('sin errores, los avisos van vacíos y ocultos', async () => {
    const html = await render();
    expect(html).toMatch(/data-form-error[^>]*hidden/);
    expect(html.match(/data-error-for="[^"]+" hidden/g)?.length).toBe(3);
    expect(html).not.toContain('data-invalid="true"');
    expect(html).not.toContain('autofocus');
  });

  it('con errores: los escribe, marca los campos y enfoca el primero', async () => {
    const html = await render({
      fieldErrors: { mensaje: ['Escribe tu mensaje.'], email: ['Escribe un email válido.'] },
      values: { email: 'ana@', telefono: '600112233', mensaje: '' },
    });
    expect(html).toContain('Escribe un email válido.');
    expect(html).toContain('Escribe tu mensaje.');
    expect(html).toMatch(/name="email"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/name="email"[^>]*aria-describedby="contact-email-error"/);
    // El primero en el orden del formulario (email va antes que mensaje).
    expect(html).toMatch(/name="email"[^>]*autofocus/);
    expect(html).not.toMatch(/name="mensaje"[^>]*autofocus/);
    // Lo escrito no se pierde.
    expect(html).toMatch(/name="telefono"[^>]*value="600112233"/);
  });

  it('con un error general muestra el aviso y el botón de reintentar', async () => {
    const html = await render({ errorCode: 'rate-limited' });
    expect(html).toContain(TEXT.rateLimited);
    expect(html).toMatch(/data-form-error(?![^>]*hidden)/);
    expect(html).toContain(TEXT.retry);
  });

  it('el error de un código desconocido usa el texto genérico', async () => {
    const html = await render({ errorCode: 'vete-a-saber' });
    expect(html).toContain(TEXT.error);
  });
});

describe('ContactForm en el build estático (Web3Forms)', () => {
  it('envía a la API de Web3Forms con la clave, el asunto y el redirect', async () => {
    const html = await renderStatic();
    expect(html).toMatch(new RegExp(`<form[^>]*action="${WEB3FORMS_ENDPOINT}"`));
    expect(html).toMatch(/<form[^>]*data-static="true"/);
    expect(html).toMatch(/name="access_key"[^>]*value="clave-de-prueba"/);
    expect(html).toContain(`value="${WEB3FORMS_SUBJECT}"`);
    expect(html).toMatch(/name="redirect"[^>]*value="https:\/\/ejemplo.test\/Portfolio\/mensaje-enviado.html"/);
  });

  it('mismos tres campos y mismo honeypot que con servidor', async () => {
    const html = await renderStatic();
    for (const field of [FIELD.email, FIELD.phone, FIELD.message, FIELD.honeypot]) {
      expect(html).toContain(`name="${field}"`);
    }
  });

  it('sin Turnstile: allí no hay servidor que lo verifique, así que no se pinta', async () => {
    const html = await renderStatic();
    expect(html).not.toContain('data-turnstile');
    expect(html).not.toContain(TEXT.labels.turnstile);
    // Y sin el aviso de «hace falta JavaScript»: sin JavaScript también envía.
    expect(html).not.toContain(TEXT.noscript);
  });
});

describe('SocialLinks', () => {
  it('SoundCloud e Instagram, en otra pestaña y sin referrer abierto', async () => {
    const html = await container.renderToString(SocialLinks);
    expect(html).toContain('https://soundcloud.com/travest15m0');
    expect(html).toContain('https://www.instagram.com/travest15m0/');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener"/g)).toHaveLength(2);
    expect(html).toContain('(se abre en otra pestaña)');
    expect(html).not.toContain('linkedin');
  });

  it('el email de Pau, como enlace mailto y en la misma pestaña (D58)', async () => {
    const html = await container.renderToString(SocialLinks);
    expect(html).toContain(`href="mailto:${SITE.contactEmail}"`);
    expect(html).toContain(SITE.contactEmail);
    // El correo no abre pestaña: solo los dos enlaces de redes lo hacen.
    expect(html).not.toMatch(new RegExp(`mailto:[^"]*"[^>]*target="_blank"`));
  });
});
