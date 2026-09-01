import { applySlidingWindowRateLimit, type RateLimitEntry } from '../middlewares/rateLimitLogic';

const STORAGE_KEY = 'rate-limit';

type RateLimitStorage = {
  entry?: RateLimitEntry;
};

export class RateLimiterDO implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const max = Number(url.searchParams.get('max'));
    const windowMs = Number(url.searchParams.get('windowMs'));

    if (!Number.isFinite(max) || !Number.isFinite(windowMs) || max < 1 || windowMs < 1) {
      return Response.json({ error: 'invalid_rate_limit_params' }, { status: 400 });
    }

    const decision = await this.state.storage.transaction(async (txn) => {
      const current = await txn.get<RateLimitStorage>(STORAGE_KEY);
      const next = applySlidingWindowRateLimit(current?.entry, Date.now(), max, windowMs);
      await txn.put<RateLimitStorage>(STORAGE_KEY, { entry: next.entry });
      return next;
    });

    return Response.json(decision);
  }
}
