import { cors } from 'hono/cors';
import { nodeEnv } from '../utils/env';

const PROD_ALLOWED_ORIGINS = [
  'https://app.irth-house.com',
  'https://irth-house.com',
];

const DEV_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  ...PROD_ALLOWED_ORIGINS,
];

// Note: `corsMiddleware` must be wrapped in a function if we want it to evaluate `nodeEnv()` per-request,
// but Hono middleware is standardly just returned.
// Since `origin` is a callback, it gets called dynamically per request.
export const corsMiddleware = cors({
  origin: (origin) => {
    const allowed = nodeEnv() === 'production' ? PROD_ALLOWED_ORIGINS : DEV_ALLOWED_ORIGINS;
    return allowed.includes(origin) ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
});
