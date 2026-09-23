import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import ContactForm from '../../src/components/ContactForm.astro';
import SocialLinks from '../../src/components/SocialLinks.astro';
import { CONTACT_FIELDS as FIELD, CONTACT_TEXT as TEXT } from '../../src/config/contact';

/** C17 · lo que sale del servidor antes de que el script tome el control. */

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const render = (props: Record<string, unknown> = {}) =>
  container.renderToString(ContactForm, { props: { siteKey: '1x00000000000000000000AA', ...props } });

describe('ContactForm', () => {
  it('es un formulario POST a la Action, con todos los campos de C17', async () => {
    const html = await render();
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<form[^>]*action="\?_action=contact\.send"/);
    for (const field of [FIELD.name, FIELD.email, FIELD.reason, FIELD.date, FIELD.place, FIELD.message, FIELD.privacy]) {
      expect(html).toContain(`name="${field}"`);
    }
    // Obligatorios y límites, para que el navegador ayude también sin JavaScript.
    expect(html).toMatch(/name="nombre"[^>]*required[^>]*maxlength="100"/);
    expect(html).toMatch(/name="mensaje"[^>]*minlength="10"[^>]*maxlength="3000"/);
    expect(html).toMatch(/name="privacidad"[^>]*required/);
    // Los cuatro motivos, con booking por defecto.
    expect(html).toMatch(/<option value="booking" selected/);
    for (const value of ['prensa', 'colaboracion', 'otro']) expect(html).toContain(`value="${value}"`);
  });

  it('el honeypot está fuera del foco y del lector de pantalla', async () => {
    const html = await render();
    expect(html).toMatch(/aria-hidden="true" inert/);
    expect(html).toMatch(/name="website"[^>]*tabindex="-1"/);
    expect(html).toMatch(/name="website"[^>]*autocomplete="off"/);
  });

  it('deja el hueco de Turnstile con la clave pública y el cursor del sistema', async () => {
    const html = await render();
    expect(html).toMatch(/data-turnstile data-sitekey="1x00000000000000000000AA" data-native-cursor/);
    // Sin JavaScript no hay widget: se avisa.
    expect(html).toContain(TEXT.noscript);
  });

  it('enlaza la política de privacidad y no muestra email ni teléfono', async () => {
    const html = await render();
    expect(html).toContain('href="/privacidad"');
    expect(html).not.toMatch(/mailto:|tel:/);
    expect(html).not.toMatch(/@gmail|@hotmail/);
  });

  it('sin errores, los avisos van vacíos y ocultos', async () => {
    const html = await render();
    expect(html).toMatch(/data-form-error[^>]*hidden/);
    expect(html.match(/data-error-for="[^"]+" hidden/g)?.length).toBe(7);
    expect(html).not.toContain('data-invalid="true"');
    expect(html).not.toContain('autofocus');
  });

  it('con errores: los escribe, marca los campos y enfoca el primero', async () => {
    const html = await render({
      fieldErrors: { mensaje: ['Escribe tu mensaje.'], email: ['Escribe un email válido.'] },
      values: { nombre: 'Ana', email: 'ana@', mensaje: '', motivo: 'prensa' },
    });
    expect(html).toContain('Escribe un email válido.');
    expect(html).toContain('Escribe tu mensaje.');
    expect(html).toMatch(/name="email"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/name="email"[^>]*aria-describedby="contact-email-error"/);
    // El primero en el orden del formulario (email va antes que mensaje).
    expect(html).toMatch(/name="email"[^>]*autofocus/);
    expect(html).not.toMatch(/name="mensaje"[^>]*autofocus/);
    // Lo escrito no se pierde.
    expect(html).toMatch(/name="nombre"[^>]*value="Ana"/);
    expect(html).toMatch(/<option value="prensa" selected/);
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
});
