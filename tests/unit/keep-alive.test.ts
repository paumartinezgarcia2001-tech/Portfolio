import { describe, expect, it, vi } from 'vitest';
import { KEEP_ALIVE_PATH, keepAlive } from '../../src/lib/keep-alive';

/** Keep-alive de Supabase: el `scheduled` del Worker pide /api/health a la propia web. */
describe('keepAlive', () => {
  const ctx = {} as ExecutionContext;

  it('pide /api/health dentro del Worker', async () => {
    const handler = vi.fn(async (_request: Request) => new Response('{"ok":true}', { status: 200 }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await keepAlive(handler, {}, ctx);
    expect(handler).toHaveBeenCalledOnce();
    expect(new URL(handler.mock.calls[0]![0].url).pathname).toBe(KEEP_ALIVE_PATH);
    log.mockRestore();
  });

  it('falla si Supabase no responde, para que quede en los logs del Worker', async () => {
    const handler = async () => new Response('{"ok":false}', { status: 503 });
    await expect(keepAlive(handler, {}, ctx)).rejects.toThrow(/503/);
  });
});
