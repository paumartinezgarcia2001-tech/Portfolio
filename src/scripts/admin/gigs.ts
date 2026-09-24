/**
 * Formulario de alta de bolos (C19.2): «añadir varias fechas».
 *
 * Con la casilla marcada, el formulario pasa a la Action `createGigsBulk`:
 * se oculta y desactiva el campo `fecha` (los campos desactivados no se
 * envían) y se activa la lista de `fechas`, con «+ otra fecha» y «+ la misma,
 * una semana después» (útil para residencias semanales como LA MARI).
 */
import { ADMIN_LIMITS } from '../../config/admin';
import { addDays } from '../../lib/dates';
import { SAVED_EVENT } from './forms';

function setDisabled(container: Element | null, disabled: boolean): void {
  if (!container) return;
  for (const control of container.querySelectorAll<HTMLInputElement>('input')) control.disabled = disabled;
}

function setupGigForm(form: HTMLFormElement): void {
  const toggle = form.querySelector<HTMLInputElement>('[data-bulk-toggle]');
  const single = form.querySelector<HTMLElement>('[data-single-only]');
  const bulk = form.querySelector<HTMLElement>('[data-bulk-only]');
  const list = form.querySelector<HTMLElement>('[data-date-list]');
  if (!toggle || !single || !bulk || !list) return;
  const template = list.querySelector<HTMLElement>('[data-date-row]')!.cloneNode(true) as HTMLElement;

  const rows = () => [...list.querySelectorAll<HTMLElement>('[data-date-row]')];
  const inputs = () => rows().map((row) => row.querySelector<HTMLInputElement>('input')!);

  const syncButtons = () => {
    const count = rows().length;
    for (const button of list.querySelectorAll<HTMLButtonElement>('[data-date-remove]')) button.hidden = count <= 1;
    for (const button of form.querySelectorAll<HTMLButtonElement>('[data-date-add], [data-date-weekly]')) {
      button.disabled = count >= ADMIN_LIMITS.bulkMax;
    }
  };

  const addRow = (value = '') => {
    const row = template.cloneNode(true) as HTMLElement;
    const input = row.querySelector<HTMLInputElement>('input')!;
    input.value = value;
    input.disabled = false;
    list.appendChild(row);
    syncButtons();
    input.focus();
  };

  const apply = () => {
    const isBulk = toggle.checked;
    form.dataset.adminForm = isBulk ? 'createGigsBulk' : 'createGig';
    form.dataset.mode = isBulk ? 'bulk' : 'single';
    single.hidden = isBulk;
    bulk.hidden = !isBulk;
    setDisabled(single, isBulk);
    setDisabled(bulk, !isBulk);
    if (isBulk) {
      // La fecha ya escrita pasa a ser la primera de la lista.
      const date = single.querySelector<HTMLInputElement>('input')?.value;
      const first = inputs()[0];
      if (date && first && !first.value) first.value = date;
    }
    syncButtons();
  };

  toggle.addEventListener('change', apply);

  form.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target) return;
    if (target.hasAttribute('data-date-add')) {
      addRow();
    } else if (target.hasAttribute('data-date-weekly')) {
      const last = inputs()
        .map((input) => input.value)
        .filter(Boolean)
        .at(-1);
      addRow(last ? addDays(last, 7) : '');
    } else if (target.hasAttribute('data-date-remove')) {
      const row = target.closest('[data-date-row]');
      if (rows().length > 1) row?.remove();
      syncButtons();
      inputs()[0]?.focus();
    }
  });

  // Tras guardar (el formulario se vacía): una sola fecha en la lista.
  form.addEventListener(SAVED_EVENT, () => {
    for (const row of rows().slice(1)) row.remove();
    window.setTimeout(apply);
  });

  apply();
}

export function setupGigForms(): void {
  for (const form of document.querySelectorAll<HTMLFormElement>('[data-gig-form]')) {
    if (form.querySelector('[data-bulk-toggle]')) setupGigForm(form);
  }
}
