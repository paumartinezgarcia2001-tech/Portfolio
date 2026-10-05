/**
 * Lectura de variables del Worker en tiempo de ejecución, sin dependencias de
 * Astro ni de Cloudflare (para poder probarla). La usa src/lib/public-env.ts.
 */

const warned = new Set<string>();

/** Valor de texto de una variable o secret del Worker, o `undefined`. */
export function readWorkerVar(source: unknown, name: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value = (source as Record<string, unknown>)[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** URL http(s) sin barra final; si está mal escrita, avisa una vez y se ignora. */
export function normalizeUrlVar(name: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const { protocol } = new URL(value);
    if (protocol !== 'https:' && protocol !== 'http:') throw new Error(protocol);
    return value.replace(/\/+$/, '');
  } catch {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[env] ${name} no es una URL válida: se ignora.`);
    }
    return undefined;
  }
}
