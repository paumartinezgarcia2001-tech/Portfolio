/**
 * C17 · Formulario de contacto en el navegador (fase 5).
 *
 * Mejora el formulario que ya funciona sin JavaScript:
 * - pinta el widget de Turnstile (solo aquí, y solo una vez por visita);
 * - envía con la Action `contact.send` sin recargar la página, así que la
 *   música del reproductor no se corta;
 * - muestra los errores junto a cada campo, con el foco en el primero, y los
 *   generales (límite de envíos, Turnstile, fallo de envío) en un aviso;
 * - al salir bien, cambia el formulario por «Mensaje enviado. Te respondo
 *   pronto.» y lleva el foco ahí.
 *
 * La validación la hace el servidor (mismo esquema zod que sin JavaScript):
 * así no hay dos versiones de las reglas que se puedan desincronizar.
 */
import { actions, isInputError } from 'astro:actions';
import { CONTACT_ERROR_CODES, CONTACT_FIELDS as FIELD, CONTACT_TEXT as TEXT, DATE_REASON, contactErrorText } from '../config/contact';
import { onPageLoad } from './lifecycle';
import { mountTurnstile, type TurnstileWidget } from './turnstile';

const ERROR_ORDER = [FIELD.name, FIELD.email, FIELD.reason, FIELD.date, FIELD.place, FIELD.message, FIELD.privacy];

function setupContactForm(): (() => void) | void {
  const found = document.querySelector<HTMLFormElement>('[data-contact-form]');
  if (!found) return;
  const form = found;

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
  // chocan con los de algunos elementos concretos, como <select>.
  const control = (field: string) => form.querySelector<HTMLElement>(`[name="${field}"]`);
  const wrapper = (field: string) => form.querySelector<HTMLElement>(`[data-field="${field}"]`);
  const errorBox = (field: string) => form.querySelector<HTMLElement>(`[data-error-for="${field}"]`);

  function setStatus(text: string): void {
    if (status) status.textContent = text;
  }

  function setSending(value: boolean): void {
    sending = value;
    form.dataset.state = value ? 'sending' : 'idle';
    if (value) form.setAttribute('aria-busy', 'true');
    else form.removeAttribute('aria-busy');
    if (submit) {
      submit.disabled = value;
      submit.textContent = value ? TEXT.sending : TEXT.submit;
    }
    setStatus(value ? TEXT.sending : '');
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

  async function onSubmit(event: SubmitEvent): Promise<void> {
    // Sin esto, el ClientRouter enviaría el formulario a su manera.
    event.preventDefault();
    if (sending || disposed) return;
    clearErrors();

    const token = widget?.getToken();
    if (!token) {
      showFormError(widgetFailed ? CONTACT_ERROR_CODES.turnstileFailed : CONTACT_ERROR_CODES.turnstileMissing);
      return;
    }

    const data = new FormData(form);
    data.set(FIELD.turnstile, token);
    // La fecha solo cuenta para booking; el campo está oculto, no quitado.
    const reason = control(FIELD.reason) as HTMLSelectElement | null;
    if (reason?.value !== DATE_REASON) data.delete(FIELD.date);

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
