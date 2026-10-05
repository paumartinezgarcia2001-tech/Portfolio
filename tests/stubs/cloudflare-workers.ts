/**
 * `cloudflare:workers` solo existe dentro del Worker. En los tests de
 * componentes (Node) se sustituye por esto: un Worker sin variables ni bindings.
 */
export const env: Record<string, unknown> = {};
