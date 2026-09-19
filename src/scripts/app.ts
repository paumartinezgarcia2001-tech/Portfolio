/**
 * Script global de la web pública (C01, C05 y C09). Se ejecuta una sola vez:
 * el ClientRouter no vuelve a ejecutar los módulos al navegar, así que todo
 * se engancha a `document` y a los eventos `astro:*`.
 */
import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { DESKTOP_MEDIA_QUERY, type MobileView } from '../config/site';
import { runPageCleanups } from './lifecycle';
import './pixel-transition';

const root = document.documentElement;
const desktop = window.matchMedia(DESKTOP_MEDIA_QUERY);

const LABEL_OPEN_MENU = 'Volver al menú';
const LABEL_CLOSE_MENU = 'Cerrar menú';

function currentView(): MobileView {
  return root.dataset.view === 'menu' ? 'menu' : 'page';
}

function backButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-back-button]');
}

function menuLinks(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>('[data-menu-link]')];
}

function focusWithoutScroll(element: HTMLElement | null | undefined): void {
  element?.focus({ preventScroll: true });
}

function focusHeading(): void {
  focusWithoutScroll(document.querySelector<HTMLElement>('#panel h1') ?? document.getElementById('panel'));
}

/** Sincroniza el botón atrás/cerrar con `html[data-view]` (C09). */
function syncBackButton(): void {
  const button = backButton();
  if (!button) return;
  const menuOpen = currentView() === 'menu';
  button.setAttribute('aria-expanded', String(menuOpen));
  button.setAttribute('aria-label', menuOpen ? LABEL_CLOSE_MENU : LABEL_OPEN_MENU);
}

/** Cambia la capa visible en móvil. No toca `history` (lo usa el ClientRouter). */
function setView(view: MobileView): void {
  root.dataset.view = view;
  syncBackButton();
}

/** La columna izquierda persiste: su `aria-current` hay que actualizarlo aquí. */
function updateAriaCurrent(): void {
  const section = root.dataset.section;
  for (const link of menuLinks()) {
    if (link.dataset.menuLink === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function onClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  // Enlace «Saltar al contenido»: el ClientRouter no mueve el foco en los
  // saltos dentro de la página, así que se hace aquí.
  if (target.closest('[data-skip-link]')) {
    event.preventDefault();
    // En móvil se arranca en el menú (D44): primero, a la página.
    if (!desktop.matches && currentView() === 'menu') setView('page');
    focusWithoutScroll(document.getElementById('panel'));
    return;
  }

  if (target.closest('[data-back-button]')) {
    if (currentView() === 'page') {
      setView('menu');
      // Al abrir el menú, el foco va al primer enlace.
      focusWithoutScroll(menuLinks()[0]);
    } else {
      setView('page');
    }
    return;
  }

  const link = target.closest<HTMLAnchorElement>('[data-menu-link]');
  if (link?.getAttribute('aria-current') === 'page') {
    // La sección ya está abierta: en escritorio no hace nada; en móvil
    // simplemente vuelve a la página.
    event.preventDefault();
    if (!desktop.matches) {
      setView('page');
      focusHeading();
    }
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || desktop.matches || currentView() !== 'menu') return;
  setView('page');
  focusWithoutScroll(backButton());
}

/** Datos de la navegación en curso, guardados antes de cambiar el DOM. */
let closingMenu = false;
let pendingTransition: ViewTransition | undefined;

function onBeforeSwap(event: TransitionBeforeSwapEvent): void {
  // ¿Se navega desde el menú abierto en móvil? Entonces hay que animar su salida.
  closingMenu = !desktop.matches && currentView() === 'menu';
  pendingTransition = event.viewTransition;
  // El ClientRouter copia los atributos del <html> nuevo, que trae la vista de
  // arranque (el menú en móvil, D44). Navegar deja a la vista la página (§6);
  // si se sale del menú abierto, se mantiene abierto durante el cambio y
  // luego se cierra con su animación (si no, el navegador no la anima).
  event.newDocument.documentElement.dataset.view = closingMenu ? 'menu' : 'page';
  runPageCleanups();
}

function nextFrames(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function onAfterSwap(): void {
  root.classList.add('js');
  updateAriaCurrent();
  const panel = document.getElementById('panel');
  if (panel) panel.scrollTop = 0;

  if (!closingMenu) {
    // Navegar siempre deja a la vista la página (§6).
    setView('page');
    focusHeading();
    return;
  }

  // Móvil: el menú sigue abierto tras el cambio; se cierra (con animación)
  // cuando la página nueva ya está pintada (C08).
  setView('menu');
  const transition = pendingTransition;
  void (transition ? transition.ready.catch(() => undefined) : Promise.resolve())
    .then(nextFrames)
    .then(() => {
      if (root.dataset.view !== 'menu') return;
      setView('page');
      focusHeading();
    });
}

root.classList.add('js');
syncBackButton();

// En captura: tiene que ejecutarse antes que el listener del ClientRouter
// para poder cancelar el clic en el ítem activo.
document.addEventListener('click', onClick, { capture: true });
document.addEventListener('keydown', onKeyDown);
document.addEventListener('astro:before-swap', onBeforeSwap);
document.addEventListener('astro:after-swap', onAfterSwap);
desktop.addEventListener('change', (event) => {
  if (event.matches) setView('page');
});
