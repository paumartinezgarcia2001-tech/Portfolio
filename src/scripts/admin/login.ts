/**
 * Entrar y salir del panel (C19).
 *
 * - Login: usuario (alias o email) y contraseña a `admin.login` sin recargar;
 *   si sale bien, recarga la página (ya con la sesión en cookies). Los errores
 *   son siempre genéricos («Usuario o contraseña incorrectos.»). Sin CAPTCHA
 *   ni segundo paso (D61).
 * - Cerrar sesión: `admin.logout` y vuelta a la raíz del panel.
 */
import { ADMIN_TEXT as TEXT } from '../../config/admin';
import { callAdminAction, clearFieldErrors, setBusy, showFieldErrors, showFormError } from './ui';

function setupLogin(form: HTMLFormElement): void {
  form.noValidate = true;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.getAttribute('aria-busy') !== null) return;
    void (async () => {
      clearFieldErrors(form);
      setBusy(form, true, TEXT.signingIn);
      const outcome = await callAdminAction('login', new FormData(form));
      if (!outcome.error) {
        window.location.reload();
        return;
      }
      setBusy(form, false);
      if (outcome.error.fields) showFieldErrors(form, outcome.error.fields);
      else showFormError(form, outcome.error.message || TEXT.loginFailed);
    })();
  });
}

export function setupAuth(): void {
  const login = document.querySelector<HTMLFormElement>('[data-admin-login]');
  if (login) setupLogin(login);

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
