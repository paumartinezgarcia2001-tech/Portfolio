/**
 * C17 · Formulario de contacto en el navegador (fase 5).
 *
 * Mejora el formulario que ya funciona sin JavaScript:
 * - envía sin recargar la página, así que la música del reproductor no se corta;
 * - muestra los errores junto a cada campo, con el foco en el primero, y los
 *   generales (límite de envíos, Turnstile, fallo de envío) en un aviso;
 * - al salir bien, cambia el formulario por «Mensaje enviado. Te respondo
 *   pronto.» y lleva el foco ahí.
 *
 * Dos caminos, según cómo esté alojada la web (ver ContactForm.astro):
 * - **Cloudflare**: Action `contact.send`. Pinta el widget de Turnstile y la
 *   validación la hace el servidor con el mismo esquema zod que sin JavaScript,
 *   así que no hay dos versiones de las reglas que se puedan desincronizar.
 * - **GitHub Pages** (`data-static`): API de Web3Forms. Sin servidor que
 *   valide, las reglas son los atributos del propio formulario (required,
 *   type, minlength, maxlength, pattern) y aquí solo se traduce lo que dice el
 *   navegador (`element.validity`) a los textos de CONTACT_FIELD_ERRORS.
 */
import { actions, isInputError } from 'astro:actions';
import {
  CONTACT_ERROR_CODES,
  CONTACT_FIELDS as FIELD,
  CONTACT_FIELD_ERRORS as FIELD_ERROR,
  CONTACT_LIMITS as LIMITS,
  CONTACT_TEXT as TEXT,
  contactErrorText,
} from '../config/contact';
import { WEB3FORMS_FIELDS, buildWeb3FormsPayload, submitToWeb3Forms } from '../lib/contact/web3forms';
import { onPageLoad } from './lifecycle';
import { mountTurnstile, type TurnstileWidget } from './turnstile';

const ERROR_ORDER = [FIELD.email, FIELD.phone, FIELD.message];

/** Campos de texto del formulario. */
type Control = HTMLInputElement | HTMLTextAreaElement;

function setupContactForm(): (() => void) | void {
  const found = document.querySelector<HTMLFormElement>('[data-contact-form]');
  if (!found) return;
  const form = found;
  const staticSend = form.dataset.static === 'true';

  const submit = form.querySelector<HTMLButtonElement>('[data-submit]');
  const alertBox = form.querySelector<HTMLElement>('[data-form-error]');
  const alertText = form.querySelector<HTMLElement>('[data-form-error-text]');
  const status = form.querySelector<HTMLElement>('[data-status]');
  const turnstileBox = form.querySelector<HTMLElement>('[data-turnstile]');
  const sentMessage = document.querySelector<HTMLElement>('[data-contact-sent]');

  const listeners = new AbortController();
  let widget: TurnstileWidget | undefined;
  let widgetFailed = false;
  let sending = false;
  let disposed = false;

  // Los errores los muestra este script; el navegador no tiene que enseñar sus
  // propios globos (que además salen en su idioma).
  form.noValidate = true;

  // `querySelector<HTMLElement>`: los tipos de Workers (worker-configuration.d.ts)
  // chocan con los de algunos elementos concretos.
  const control = (field: string) => form.querySelector<HTMLElement>(`[name="${field}"]`) as Control | null;
  const wrapper = (field: string) => form.querySelector<HTMLElement>(`[data-field="${field}"]`);
  const errorBox = (field: string) => form.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
  const value = (field: string) => (control(field)?.value ?? '').trim();

  function setStatus(text: string): void {
    if (status) status.textContent = text;
  }

  function setSending(state: boolean): void {
    sending = state;
    form.dataset.state = state ? 'sending' : 'idle';
    if (state) form.setAttribute('aria-busy', 'true');
    else form.removeAttribute('aria-busy');
    if (submit) {
      submit.disabled = state;
      submit.textContent = state ? TEXT.sending : TEXT.submit;
    }
    setStatus(state ? TEXT.sending : '');
  }

  function clearErrors(): void {
    for (const field of ERROR_ORDER) {
      const box = errorBox(field);
      if (box) {
        box.textContent = '';
        box.hidden = true;
      }
      wrapper(field)?.removeAttribute('data-invalid');
      const element = control(field);
      element?.removeAttribute('aria-invalid');
      element?.removeAttribute('aria-describedby');
    }
    if (alertBox) alertBox.hidden = true;
    if (alertText) alertText.textContent = '';
  }

  function showFieldErrors(fields: Record<string, string[] | undefined>): void {
    let focused = false;
    let unknown = false;
    for (const field of ERROR_ORDER) {
      const message = fields[field]?.[0];
      if (!message) continue;
      const box = errorBox(field);
      if (box) {
        box.textContent = message;
        box.hidden = false;
      }
      wrapper(field)?.setAttribute('data-invalid', 'true');
      const element = control(field);
      element?.setAttribute('aria-invalid', 'true');
      if (box?.id) element?.setAttribute('aria-describedby', box.id);
      if (!focused && element) {
        element.focus();
        focused = true;
      }
    }
    // Un error en un campo que no está a la vista (p. ej. el token): aviso general.
    for (const field of Object.keys(fields)) {
      if (fields[field]?.length && !ERROR_ORDER.includes(field as (typeof ERROR_ORDER)[number])) unknown = true;
    }
    if (!focused || unknown) showFormError(undefined);
    else setStatus('');
  }

  function showFormError(code: string | undefined): void {
    const text = contactErrorText(code);
    if (alertBox && alertText) {
      alertText.textContent = text;
      alertBox.hidden = false;
      alertBox.focus();
    }
    setStatus(text);
  }

  function showSent(): void {
    clearErrors();
    form.hidden = true;
    if (sentMessage) {
      sentMessage.hidden = false;
      sentMessage.focus();
    }
    setStatus(TEXT.success);
  }

  /**
   * Lo que dice el navegador sobre un campo, con nuestras palabras. Se mira el
   * valor recortado: `required` se cumple con espacios, pero un mensaje de
   * espacios está vacío.
   */
  function fieldError(field: string): string | undefined {
    const element = control(field);
    if (!element) return undefined;
    const text = element.value.trim();
    const validity = element.validity;
    if (field === FIELD.email) {
      if (!text) return FIELD_ERROR.emailRequired;
      return validity.typeMismatch || validity.tooLong ? FIELD_ERROR.emailInvalid : undefined;
    }
    if (field === FIELD.phone) {
      if (!text) return undefined;
      return validity.patternMismatch || validity.tooLong ? FIELD_ERROR.phoneInvalid : undefined;
    }
    if (!text) return FIELD_ERROR.messageRequired;
    if (text.length < LIMITS.messageMin) return FIELD_ERROR.messageTooShort;
    if (text.length > LIMITS.messageMax) return FIELD_ERROR.messageTooLong;
    return undefined;
  }

  /** Errores de los tres campos, o `undefined` si todo está bien. */
  function validate(): Record<string, string[]> | undefined {
    const errors: Record<string, string[]> = {};
    for (const field of ERROR_ORDER) {
      const message = fieldError(field);
      if (message) errors[field] = [message];
    }
    return Object.keys(errors).length > 0 ? errors : undefined;
  }

  /** GitHub Pages: el navegador manda el mensaje a Web3Forms. */
  async function sendWithWeb3Forms(): Promise<void> {
    const errors = validate();
    if (errors) {
      showFieldErrors(errors);
      return;
    }
    const accessKey = form.querySelector<HTMLInputElement>(`[name="${WEB3FORMS_FIELDS.accessKey}"]`)?.value ?? '';
    const honeypot = form.querySelector<HTMLInputElement>(`[name="${FIELD.honeypot}"]`);
    const payload = buildWeb3FormsPayload(
      { email: value(FIELD.email), phone: value(FIELD.phone) || undefined, message: value(FIELD.message) },
      accessKey,
    );
    // Honeypot marcado: se manda igual y Web3Forms lo descarta en su servidor.
    // Quien escribe ve «enviado», como en el camino de Cloudflare.
    if (honeypot?.checked) payload.botcheck = true;

    setSending(true);
    const result = await submitToWeb3Forms(payload, { endpoint: form.action });
    if (disposed) return;
    setSending(false);
    if (result.ok) {
      showSent();
      return;
    }
    console.error(`[contact] Web3Forms no ha enviado el mensaje: ${result.error}`);
    showFormError(undefined);
  }

  /** Cloudflare: la Action valida, comprueba Turnstile y envía con Resend. */
  async function sendWithAction(): Promise<void> {
    const token = widget?.getToken();
    if (!token) {
      showFormError(widgetFailed ? CONTACT_ERROR_CODES.turnstileFailed : CONTACT_ERROR_CODES.turnstileMissing);
      return;
    }

    const data = new FormData(form);
    data.set(FIELD.turnstile, token);

    setSending(true);
    let result: Awaited<ReturnType<typeof actions.contact.send>>;
    try {
      result = await actions.contact.send(data);
    } catch (error) {
      console.error('[contact] No se ha podido enviar el formulario.', error);
      setSending(false);
      widget?.reset();
      showFormError(undefined);
      return;
    }
    if (disposed) return;
    setSending(false);

    if (!result.error) {
      showSent();
      return;
    }
    // El token se gasta al verificarlo: hace falta uno nuevo para reintentar.
    widget?.reset();
    widgetFailed = false;
    if (isInputError(result.error)) showFieldErrors(result.error.fields);
    else showFormError(result.error.message);
  }

  async function onSubmit(event: SubmitEvent): Promise<void> {
    // Sin esto, el ClientRouter enviaría el formulario a su manera.
    event.preventDefault();
    if (sending || disposed) return;
    clearErrors();
    await (staticSend ? sendWithWeb3Forms() : sendWithAction());
  }

  form.addEventListener('submit', (event) => void onSubmit(event), { signal: listeners.signal });

  if (turnstileBox?.dataset.sitekey) {
    void mountTurnstile(turnstileBox, {
      sitekey: turnstileBox.dataset.sitekey,
      action: 'contact',
      language: 'es',
      theme: 'light',
      'error-callback': (code) => {
        widgetFailed = true;
        console.warn(`[contact] Turnstile no ha podido comprobar el navegador${code ? ` (${code})` : ''}.`);
      },
      'expired-callback': () => widget?.reset(),
      callback: () => {
        widgetFailed = false;
      },
    })
      .then((mounted) => {
        if (disposed) {
          mounted.remove();
          return;
        }
        widget = mounted;
      })
      .catch((error: unknown) => {
        widgetFailed = true;
        console.error('[contact] No se ha podido cargar Turnstile.', error);
      });
  }

  return () => {
    disposed = true;
    listeners.abort();
    widget?.remove();
    widget = undefined;
  };
}

onPageLoad(setupContactForm);
