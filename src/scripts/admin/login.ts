/**
 * Entrar y salir del panel (C19).
 *
 * - Login: pinta Turnstile (si hay clave) y envía a `admin.login` sin
 *   recargar; si sale bien, recarga la página (ya con la sesión en cookies).
 *   Los errores son siempre genéricos («Usuario o contraseña incorrectos.»).
 * - Segundo paso (TOTP): `admin.verifyMfa`.
 * - Cerrar sesión: `admin.logout` y vuelta a la raíz del panel.
 */
import { ADMIN_TEXT as TEXT } from '../../config/admin';
import { mountTurnstile, type TurnstileWidget } from '../turnstile';
import { callAdminAction, clearFieldErrors, setBusy, showFieldErrors, showFormError } from './ui';

function setupLogin(form: HTMLFormElement): void {
  form.noValidate = true;
  let widget: TurnstileWidget | undefined;
  const siteKey = form.dataset.turnstileSitekey;
  const box = form.querySelector<HTMLElement>('[data-turnstile]');
  const submitButton = form.querySelector<HTMLButtonElement>('[data-submit]');

  if (siteKey && box) {
    // Sin token todavía: el botón espera a Turnstile (D48).
    if (submitButton) submitButton.disabled = true;
    mountTurnstile(box, {
      sitekey: siteKey,
      action: 'login',
      language: 'es',
      theme: 'light',
      size: 'flexible',
      callback: () => {
        if (submitButton) submitButton.disabled = false;
      },
      'expired-callback': () => widget?.reset(),
      'error-callback': () => {
        showFormError(form, TEXT.captchaFailed);
        if (submitButton) submitButton.disabled = false;
      },
    })
      .then((mounted) => {
        widget = mounted;
      })
      .catch(() => {
        showFormError(form, TEXT.captchaFailed);
        if (submitButton) submitButton.disabled = false;
      });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.getAttribute('aria-busy') !== null) return;
    void (async () => {
      clearFieldErrors(form);
      const data = new FormData(form);
      const token = widget?.getToken();
      if (token) data.set('cf-turnstile-response', token);
      setBusy(form, true, TEXT.signingIn);
      const outcome = await callAdminAction(form.dataset.adminMfa !== undefined ? 'verifyMfa' : 'login', data);
      if (!outcome.error) {
        window.location.reload();
        return;
      }
      setBusy(form, false);
      // Los tokens de Turnstile se gastan al verificarlos: hace falta otro.
      widget?.reset();
      if (outcome.error.fields) showFieldErrors(form, outcome.error.fields);
      else showFormError(form, outcome.error.message || TEXT.loginFailed);
    })();
  });
}

export function setupAuth(): void {
  const login = document.querySelector<HTMLFormElement>('[data-admin-login]');
  if (login) setupLogin(login);
  const mfa = document.querySelector<HTMLFormElement>('[data-admin-mfa]');
  if (mfa) setupLogin(mfa);

  for (const form of document.querySelectorAll<HTMLFormElement>('[data-admin-logout]')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void callAdminAction('logout', new FormData(form)).finally(() => {
        // La raíz del panel: el primer tramo de la ruta.
        const root = `/${window.location.pathname.split('/').filter(Boolean)[0] ?? ''}`;
        window.location.assign(root);
      });
    });
  }
}
