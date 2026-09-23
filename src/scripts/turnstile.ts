/**
 * Cloudflare Turnstile en el navegador (C17).
 *
 * - El script de Cloudflare se pide **una sola vez y solo donde hace falta**
 *   (ahora, `/contact`): lo carga este módulo cuando se monta el formulario.
 * - Pintado explícito (`render=explicit`): con el ClientRouter se puede entrar
 *   y salir de contact sin recargar la página, así que el widget se pinta y se
 *   quita a mano en cada visita.
 * - La URL tiene que ser exactamente esta: Cloudflare no permite copiarla ni
 *   servirla desde otro sitio.
 */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  language?: string;
  theme?: 'auto' | 'light' | 'dark';
  size?: 'normal' | 'flexible' | 'compact';
  callback?: (token: string) => void;
  'error-callback'?: (code?: string) => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement | string, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
  getResponse(widgetId?: string): string | undefined;
  isExpired(widgetId?: string): boolean;
  ready?(callback: () => void): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      const api = window.turnstile;
      if (!api) {
        reject(new Error('Turnstile se ha cargado pero no ha dejado su API.'));
        return;
      }
      if (api.ready) api.ready(() => resolve(api));
      else resolve(api);
    });
    script.addEventListener('error', () => {
      // Que se pueda volver a intentar en la siguiente visita a contact.
      loading = null;
      script.remove();
      reject(new Error('No se ha podido cargar Turnstile.'));
    });
    document.head.appendChild(script);
  });
  return loading;
}

export interface TurnstileWidget {
  /** Token actual, si el widget ya lo ha resuelto. */
  getToken(): string | undefined;
  /** Pide un token nuevo (los tokens se gastan al verificarlos). */
  reset(): void;
  /** Quita el widget (al salir de la página). */
  remove(): void;
}

/** Pinta el widget en `container` y devuelve sus controles. */
export async function mountTurnstile(
  container: HTMLElement,
  options: Omit<TurnstileRenderOptions, 'sitekey'> & { sitekey: string },
): Promise<TurnstileWidget> {
  const api = await loadTurnstile();
  const widgetId = api.render(container, options);
  return {
    getToken: () => (widgetId ? api.getResponse(widgetId) : undefined),
    reset: () => {
      if (widgetId) api.reset(widgetId);
    },
    remove: () => {
      if (widgetId) api.remove(widgetId);
    },
  };
}
