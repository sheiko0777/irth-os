import { cors } from 'hono/cors';

// irth.com/admin.irth.com were placeholders nobody owns — this business's
// real domain is irth-house.com, with the admin app at app.irth-house.com.
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://app.irth-house.com',
  'https://irth-house.com',
];

export const corsMiddleware = cors({
  origin: (origin) => ALLOWED_ORIGINS.includes(origin) ? origin : null,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
});
