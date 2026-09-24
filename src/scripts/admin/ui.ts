/**
 * Piezas comunes del panel en el navegador (C19, fase 6): aviso «Guardado.»,
 * errores de los campos, el <dialog> de confirmación y la recarga de trozos
 * de la página sin perder lo que haya escrito en otros formularios.
 */
import { actions, isInputError } from 'astro:actions';
import { ADMIN_TEXT as TEXT } from '../../config/admin';

// ------------------------------------------------------------------ Actions

/** Resultado de una Action (lo que devuelve `actions.admin.x()`). */
export interface ActionOutcome<T = unknown> {
  data?: T | undefined;
  error?:
    | {
        code: string;
        status: number;
        message: string;
        fields?: Record<string, string[] | undefined>;
      }
    | undefined;
}

type AdminActionName = keyof typeof actions.admin;

/** Llama a `actions.admin[name]` con el FormData. */
export async function callAdminAction<T = unknown>(name: string, formData: FormData): Promise<ActionOutcome<T>> {
  const action = (actions.admin as unknown as Record<string, ((input: FormData) => Promise<unknown>) | undefined>)[
    name as AdminActionName
  ];
  if (typeof action !== 'function') throw new Error(`No existe la Action admin.${name}`);
  try {
    const result = (await action(formData)) as { data?: T; error?: unknown };
    if (!result.error) return { data: result.data };
    const error = result.error as { code: string; status: number; message: string };
    return {
      error: {
        code: error.code,
        status: error.status,
        message: error.message,
        ...(isInputError(result.error) ? { fields: result.error.fields as Record<string, string[] | undefined> } : {}),
      },
    };
  } catch (error) {
    console.error(`[panel] admin.${name}`, error);
    return { error: { code: 'NETWORK', status: 0, message: TEXT.saveFailed } };
  }
}

/** Sesión caducada: se avisa y se recarga (sale el login). */
export function handleUnauthorized(outcome: ActionOutcome): boolean {
  if (outcome.error?.code !== 'UNAUTHORIZED') return false;
  toast(outcome.error.message || TEXT.sessionExpired, 'error');
  window.setTimeout(() => window.location.reload(), 1500);
  return true;
}

// -------------------------------------------------------------------- aviso

let toastTimer: number | undefined;

/** Aviso flotante (`role="status"`): «Guardado.», errores… */
export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  const box = document.querySelector<HTMLElement>('[data-admin-toast]');
  if (!box) return;
  window.clearTimeout(toastTimer);
  box.dataset.kind = kind;
  // Vaciar antes: así los lectores de pantalla lo anuncian aunque se repita.
  box.textContent = '';
  window.requestAnimationFrame(() => {
    box.textContent = message;
  });
  toastTimer = window.setTimeout(() => {
    box.textContent = '';
  }, kind === 'ok' ? 4000 : 8000);
}

// ---------------------------------------------------------------- campos

export function clearFieldErrors(form: HTMLFormElement): void {
  for (const box of form.querySelectorAll<HTMLElement>('[data-error-for]')) {
    box.textContent = '';
    box.hidden = true;
    const field = box.dataset.errorFor!;
    form.querySelector(`[data-field="${field}"]`)?.removeAttribute('data-invalid');
    for (const control of form.querySelectorAll<HTMLElement>(`[name="${field}"]`)) {
      control.removeAttribute('aria-invalid');
      const described = (control.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .filter((id) => id && id !== box.id);
      if (described.length > 0) control.setAttribute('aria-describedby', described.join(' '));
      else control.removeAttribute('aria-describedby');
    }
  }
  const alert = form.querySelector<HTMLElement>('[data-form-error]');
  if (alert) {
    alert.hidden = true;
    alert.textContent = '';
  }
}

let errorIds = 0;

/**
 * Muestra los errores de validación junto a cada campo y lleva el foco al
 * primero. Los que no tienen sitio van al aviso general del formulario.
 */
export function showFieldErrors(form: HTMLFormElement, fields: Record<string, string[] | undefined>): void {
  let first: HTMLElement | null = null;
  const orphans: string[] = [];
  for (const [field, messages] of Object.entries(fields)) {
    const message = messages?.find(Boolean);
    if (!message) continue;
    const box = form.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
    if (!box) {
      orphans.push(message);
      continue;
    }
    box.id ||= `a-error-${++errorIds}`;
    box.textContent = message;
    box.hidden = false;
    form.querySelector(`[data-field="${field}"]`)?.setAttribute('data-invalid', '');
    for (const control of form.querySelectorAll<HTMLElement>(`[name="${field}"]:not([disabled])`)) {
      control.setAttribute('aria-invalid', 'true');
      const described = new Set((control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
      described.add(box.id);
      control.setAttribute('aria-describedby', [...described].join(' '));
      first ??= control;
    }
  }
  if (orphans.length > 0) showFormError(form, orphans.join(' '));
  first?.focus();
}

export function showFormError(form: HTMLFormElement, message: string): void {
  const alert = form.querySelector<HTMLElement>('[data-form-error]');
  if (alert) {
    alert.textContent = message;
    alert.hidden = false;
  } else {
    toast(message, 'error');
  }
}

export function setBusy(form: HTMLFormElement, busy: boolean, label?: string): void {
  const submit = form.querySelector<HTMLButtonElement>('[data-submit], button[type="submit"]');
  form.toggleAttribute('aria-busy', busy);
  if (!submit) return;
  if (busy) {
    submit.dataset.label ??= submit.textContent ?? '';
    submit.textContent = label ?? TEXT.saving;
    submit.disabled = true;
  } else {
    if (submit.dataset.label !== undefined) submit.textContent = submit.dataset.label;
    delete submit.dataset.label;
    submit.disabled = false;
  }
}

// ---------------------------------------------------------------- diálogo

export interface ConfirmOptions {
  message: string;
  items?: string[] | undefined;
  confirmLabel?: string | undefined;
}

/** Confirmación con el <dialog> del layout (C19: nada de `confirm()`). */
export function confirmDialog({ message, items, confirmLabel }: ConfirmOptions): Promise<boolean> {
  const dialog = document.querySelector<HTMLDialogElement>('[data-admin-dialog]');
  if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(false);
  const text = dialog.querySelector<HTMLElement>('[data-dialog-text]');
  const list = dialog.querySelector<HTMLElement>('[data-dialog-list]');
  const confirm = dialog.querySelector<HTMLButtonElement>('[data-dialog-confirm]');
  if (text) text.textContent = message;
  if (list) {
    list.replaceChildren(
      ...(items ?? []).map((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        return li;
      }),
    );
    list.hidden = !items?.length;
  }
  if (confirm) confirm.textContent = confirmLabel ?? 'aceptar';
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        opener?.focus();
        resolve(dialog.returnValue === 'confirm');
      },
      { once: true },
    );
  });
}

// ------------------------------------------------------------- regiones

/**
 * Vuelve a pedir la página y sustituye las regiones indicadas
 * (`data-region="…"`), p. ej. la lista de próximos bolos tras añadir uno.
 * Si falla, recarga la página entera.
 */
export async function refreshRegions(names: string[]): Promise<void> {
  if (names.length === 0) return;
  try {
    const response = await fetch(window.location.href, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(String(response.status));
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    for (const name of names) {
      const fresh = doc.querySelector(`[data-region="${name}"]`);
      const current = document.querySelector(`[data-region="${name}"]`);
      if (fresh && current) current.replaceWith(document.importNode(fresh, true));
      else if (!fresh) throw new Error(`falta la región ${name}`);
    }
  } catch (error) {
    console.warn('[panel] No se ha podido actualizar la página; se recarga.', error);
    window.location.reload();
  }
}
