import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import superjson, { type SuperJSONResult } from 'superjson';
import { publicProcedure, router, type Context } from '@/server/trpc';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));

const internalMessage = 'duplicate key violates constraint orders_org_id_number_unique';
const testRouter = router({
  deliberate: publicProcedure.query(() => {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
  }),
  unexpected: publicProcedure.query(() => {
    throw new Error(internalMessage);
  }),
});

async function requestError(path: 'deliberate' | 'unexpected') {
  const response = await fetchRequestHandler({
    endpoint: '/trpc',
    req: new Request('http://localhost/trpc/' + path),
    router: testRouter,
    // These public test procedures do not use session or database context.
    createContext: () => ({} as Context),
  });
  const body = await response.json() as { error: SuperJSONResult };
  return {
    status: response.status,
    error: superjson.deserialize<{
      message: string;
      code: number;
      data: { code: string; httpStatus: number; path: string };
    }>(body.error),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe.each(['production', 'development', 'test', undefined])('tRPC errors with NODE_ENV=%s', (env) => {
  it('preserves the deliberate error message and code', async () => {
    vi.stubEnv('NODE_ENV', env);
    const { status, error } = await requestError('deliberate');
    expect(status).toBe(404);
    expect(error).toMatchObject({
      message: 'Order not found',
      code: -32004,
      data: { code: 'NOT_FOUND', httpStatus: 404, path: 'deliberate' },
    });
  });

  it('scrubs an unexpected error message only in production, preserving its code', async () => {
    vi.stubEnv('NODE_ENV', env);
    const { status, error } = await requestError('unexpected');
    expect(status).toBe(500);
    expect(error).toMatchObject({
      message: env === 'production' ? 'internal_server_error' : internalMessage,
      code: -32603,
      data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'unexpected' },
    });
  });
});
