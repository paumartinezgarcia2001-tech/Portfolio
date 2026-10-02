/**
 * Carga de scripts de terceros, una sola vez y solo cuando hacen falta (D59).
 *
 * Lo usan el reproductor de SoundCloud y el embed de Instagram, que no se piden
 * al abrir la página: solo cuando alguien pulsa su botón. Si la carga falla, se
 * olvida la promesa para que el siguiente intento vuelva a probar (la red se
 * cae un momento, se entra y se sale de la página con el ClientRouter…).
 *
 * Cada origen nuevo que se cargue por aquí hay que añadirlo a `script-src` en
 * src/lib/security-headers.ts.
 */
const loading = new Map<string, Promise<void>>();

export function loadExternalScript(src: string): Promise<void> {
  const pending = loading.get(src);
  if (pending) return pending;

  const promise = new Promise<void>((resolve, reject) => {
    // Puede estar ya en el documento (otra visita a la página sin recargar).
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CSS.escape(src)}"]`);
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    const script = existing ?? document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    });
    script.addEventListener('error', () => {
      loading.delete(src);
      script.remove();
      reject(new Error(`No se ha podido cargar ${src}.`));
    });
    if (!existing) document.head.appendChild(script);
  });

  loading.set(src, promise);
  return promise;
}
