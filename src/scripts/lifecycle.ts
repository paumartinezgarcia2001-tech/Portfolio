/**
 * Ciclo de vida de las secciones con el ClientRouter (C01).
 *
 * Cada sección que añada listeners u observers en la página debe registrarlos
 * con `onPageCleanup()`; se limpian en `astro:before-swap`, antes de que el
 * contenido nuevo sustituya al viejo. Lo persistente (columna izquierda,
 * cursor) no necesita esto.
 */

type Cleanup = () => void;

const cleanups = new Set<Cleanup>();

export function onPageCleanup(cleanup: Cleanup): void {
  cleanups.add(cleanup);
}

export function runPageCleanups(): void {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      console.error('[lifecycle] Error al limpiar la sección', error);
    }
  }
  cleanups.clear();
}

/**
 * Ejecuta `setup` al cargar la página y tras cada navegación.
 * Si `setup` devuelve una función, se usa como limpieza.
 */
export function onPageLoad(setup: () => void | Cleanup): void {
  document.addEventListener('astro:page-load', () => {
    const cleanup = setup();
    if (typeof cleanup === 'function') onPageCleanup(cleanup);
  });
}
