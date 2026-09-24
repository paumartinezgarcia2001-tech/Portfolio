/**
 * Verificación en dos pasos (TOTP) desde el panel: activar con un código QR y
 * confirmar con el primer código de la app.
 */
import { ADMIN_TEXT as TEXT } from '../../config/admin';
import { callAdminAction, clearFieldErrors, handleUnauthorized, setBusy, showFieldErrors, showFormError } from './ui';

interface Enrollment {
  factorId: string;
  qr: string;
  secret: string;
}

export function setupSecurity(): void {
  const start = document.querySelector<HTMLFormElement>('[data-mfa-start]');
  const confirm = document.querySelector<HTMLFormElement>('[data-mfa-confirm]');
  if (!start || !confirm) return;
  const qr = confirm.querySelector<HTMLImageElement>('[data-mfa-qr]');
  const secret = confirm.querySelector<HTMLElement>('[data-mfa-secret]');
  const factor = confirm.querySelector<HTMLInputElement>('input[name="factorId"]');

  start.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      setBusy(start, true, 'preparando…');
      const outcome = await callAdminAction<Enrollment>('mfaEnroll', new FormData(start));
      setBusy(start, false);
      if (outcome.error) {
        if (!handleUnauthorized(outcome)) showFormError(start, outcome.error.message || TEXT.saveFailed);
        return;
      }
      const data = outcome.data!;
      if (qr) qr.src = data.qr;
      if (secret) secret.textContent = data.secret;
      if (factor) factor.value = data.factorId;
      start.hidden = true;
      confirm.hidden = false;
      confirm.querySelector<HTMLInputElement>('input[name="codigo"]')?.focus();
    })();
  });

  confirm.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      clearFieldErrors(confirm);
      setBusy(confirm, true);
      const outcome = await callAdminAction('mfaConfirm', new FormData(confirm));
      setBusy(confirm, false);
      if (outcome.error) {
        if (handleUnauthorized(outcome)) return;
        if (outcome.error.fields) showFieldErrors(confirm, outcome.error.fields);
        else showFormError(confirm, outcome.error.message || TEXT.mfaFailed);
        return;
      }
      window.location.reload();
    })();
  });
}
