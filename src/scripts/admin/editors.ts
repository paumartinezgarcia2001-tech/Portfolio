/**
 * Vistas previas de los editores de P2 (fase 6):
 * - Info: el Markdown se pinta con la misma función que usa la web
 *   (src/lib/markdown.ts), así que lo que se ve es lo que saldrá.
 * - Vídeo: el punto focal se mueve con las barras o tocando el póster.
 */
import { renderInfoMarkdown } from '../../lib/markdown';

function setupInfoPreview(): void {
  const form = document.querySelector<HTMLFormElement>('[data-info-editor]');
  const textarea = form?.querySelector<HTMLTextAreaElement>('textarea[name="markdown"]');
  const preview = form?.querySelector<HTMLElement>('[data-info-preview]');
  if (!textarea || !preview) return;
  let frame = 0;
  // renderInfoMarkdown escapa todo el texto: es seguro como HTML.
  const render = () => {
    preview.innerHTML = renderInfoMarkdown(textarea.value);
  };
  textarea.addEventListener('input', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  });
  // Por si se ha escrito antes de que cargara el script.
  render();
}

function setupVideoFocus(): void {
  const form = document.querySelector<HTMLFormElement>('[data-video-editor]');
  if (!form) return;
  const box = form.querySelector<HTMLElement>('[data-focus-preview]');
  const image = form.querySelector<HTMLImageElement>('[data-focus-image]');
  const dot = form.querySelector<HTMLElement>('[data-focus-dot]');
  const x = form.querySelector<HTMLInputElement>('input[name="focoX"]');
  const y = form.querySelector<HTMLInputElement>('input[name="focoY"]');
  if (!box || !x || !y) return;

  const render = () => {
    const fx = `${x.value}%`;
    const fy = `${y.value}%`;
    if (dot) {
      dot.style.left = fx;
      dot.style.top = fy;
    }
    if (image) image.style.objectPosition = `${fx} ${fy}`;
    for (const output of form.querySelectorAll<HTMLOutputElement>('[data-focus-output]')) {
      output.value = output.dataset.focusOutput === 'focoX' ? x.value : y.value;
    }
  };

  x.addEventListener('input', render);
  y.addEventListener('input', render);
  render();
  box.addEventListener('click', (event) => {
    const rect = box.getBoundingClientRect();
    x.value = String(Math.round(((event.clientX - rect.left) / rect.width) * 100));
    y.value = String(Math.round(((event.clientY - rect.top) / rect.height) * 100));
    render();
  });

  const toggle = form.querySelector<HTMLInputElement>('[data-fullset-toggle]');
  const fields = form.querySelector<HTMLElement>('[data-fullset-fields]');
  toggle?.addEventListener('change', () => {
    if (fields) fields.hidden = !toggle.checked;
  });
}

export function setupEditors(): void {
  setupInfoPreview();
  setupVideoFocus();
}
