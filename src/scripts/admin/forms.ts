/**
 * Formularios del panel (C19): `<form data-admin-form="nombreDeLaAction">`.
 *
 * Un solo listener en el documento (también sirve para lo que llega al
 * recargar una región):
 * - `data-confirm="…"`: antes de enviar, pregunta con el <dialog>;
 * - si el servidor avisa de un duplicado, lo pregunta y, si se acepta,
 *   reenvía con `forzar=true` («guardar igualmente»);
 * - al guardar: «Guardado.» y, según el formulario, `data-reset` (lo vacía),
 *   `data-refresh="región …"` (recarga esos trozos) o `data-redirect` (vuelve).
 */
import { ADMIN_TEXT as TEXT } from '../../config/admin';
import {
  callAdminAction,
  clearFieldErrors,
  confirmDialog,
  handleUnauthorized,
  refreshRegions,
  setBusy,
  showFieldErrors,
  showFormError,
  toast,
} from './ui';

interface SaveResult {
  status?: 'saved' | 'duplicate';
  message?: string;
  duplicates?: string[];
}

/** Evento para que otros módulos reaccionen a un guardado (p. ej. restablecer el formulario de bolos). */
export const SAVED_EVENT = 'admin:saved';

async function submit(form: HTMLFormElement, force = false): Promise<void> {
  const name = form.dataset.adminForm!;
  const data = new FormData(form);
  if (force) data.set('forzar', 'true');

  clearFieldErrors(form);
  setBusy(form, true);
  const outcome = await callAdminAction<SaveResult>(name, data);
  setBusy(form, false);

  if (outcome.error) {
    if (handleUnauthorized(outcome)) return;
    if (outcome.error.fields) showFieldErrors(form, outcome.error.fields);
    // Sin aviso propio en el formulario, el error sale en el aviso flotante.
    else showFormError(form, outcome.error.message || TEXT.saveFailed);
    return;
  }

  const result = outcome.data ?? {};
  if (result.status === 'duplicate') {
    const again = await confirmDialog({
      message: result.message ?? TEXT.duplicate,
      items: result.duplicates,
      confirmLabel: 'guardar igualmente',
    });
    if (again) await submit(form, true);
    return;
  }

  toast(result.message ?? TEXT.saved, 'ok');
  form.dispatchEvent(new CustomEvent(SAVED_EVENT, { bubbles: true, detail: result }));

  if (form.dataset.redirect !== undefined && form.dataset.redirect !== '') {
    window.setTimeout(() => window.location.assign(form.dataset.redirect!), 600);
    return;
  }
  if (form.hasAttribute('data-reset')) form.reset();
  const regions = (form.dataset.refresh ?? '').split(/\s+/).filter(Boolean);
  if (regions.length > 0) await refreshRegions(regions);
}

export function setupAdminForms(): void {
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.adminForm) return;
    event.preventDefault();
    if (form.getAttribute('aria-busy') !== null) return;
    void (async () => {
      if (form.dataset.confirm) {
        const ok = await confirmDialog({ message: form.dataset.confirm, confirmLabel: form.dataset.confirmLabel });
        if (!ok) return;
      }
      await submit(form);
    })();
  });
}
