/**
 * Editor de la barra de noticias (C19.1): contador de caracteres y vista
 * previa en vivo con el mismo componente que la web (NewsTicker), montado con
 * las mismas funciones (src/lib/ticker.ts).
 */
import { TICKER_SEPARATOR, buildTickerCopy, charLength, normalizeTickerText, tickerDurationSeconds } from '../../lib/ticker';

/** Igual que buildTickerText (src/lib/data/core.ts), con la próxima fecha ya escrita. */
export function previewText(text: string, appendNextGig: boolean, nextGig: string, fallback: string): string {
  const parts: string[] = [];
  const base = normalizeTickerText(text);
  if (base) parts.push(base);
  if (appendNextGig && nextGig) parts.push(nextGig);
  return parts.length > 0 ? parts.join(TICKER_SEPARATOR) : fallback;
}

/** Contador «123 / 500» de los textarea con `data-count-max`. */
export function setupCounters(): void {
  for (const field of document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('[data-count-max]')) {
    const counter = field.closest('.a-field')?.querySelector<HTMLElement>('[data-counter]');
    if (!counter) continue;
    const max = Number(field.dataset.countMax);
    // Barra: cuenta como el servidor (espacios colapsados). Info: tal cual.
    const raw = field.hasAttribute('data-count-raw');
    let lastOver = false;
    const update = () => {
      const length = raw ? field.value.replace(/\r\n?/g, '\n').trim().length : charLength(field.value.replace(/\s+/g, ' ').trim());
      counter.textContent = `${length} / ${max}`;
      const over = length > max;
      counter.toggleAttribute('data-over', over);
      // Solo se anuncia al pasarse (o al volver), no con cada tecla.
      counter.setAttribute('aria-live', over !== lastOver ? 'polite' : 'off');
      lastOver = over;
    };
    field.addEventListener('input', update);
    update();
  }
}

export function setupTickerPreview(): void {
  const form = document.querySelector<HTMLFormElement>('[data-ticker-editor]');
  const preview = form?.querySelector<HTMLElement>('[data-ticker-preview]');
  if (!form || !preview) return;
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="texto"]');
  const toggle = form.querySelector<HTMLInputElement>('input[name="proximaFecha"]');
  const nextGig = form.dataset.nextGig ?? '';
  const fallback = form.dataset.fallback ?? '';

  const render = () => {
    const ticker = preview.querySelector<HTMLElement>('[data-ticker]');
    if (!ticker) return;
    const text = previewText(textarea?.value ?? '', toggle?.checked ?? false, nextGig, fallback);
    const copy = buildTickerCopy(text);
    const hidden = ticker.querySelector('.visually-hidden');
    if (hidden) hidden.textContent = text;
    for (const node of ticker.querySelectorAll('.ticker__copy')) node.textContent = copy;
    ticker.style.setProperty('--ticker-duration', `${tickerDurationSeconds(copy)}s`);
  };

  textarea?.addEventListener('input', render);
  toggle?.addEventListener('change', render);
  form.addEventListener('reset', () => window.setTimeout(render));
  // Por si se ha escrito antes de que cargara el script.
  render();
}
