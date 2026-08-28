import type { z } from 'zod';
import { getSessionToken } from './auth';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

// The whole envelope apps/api actually returns on every plain REST response —
// not `T`. Previously `apiFetch<T>` just cast `response.json()` to `T` at
// compile time only, so every caller was mistyped: it received this envelope
// at runtime while TypeScript believed it had `T`.
interface ApiEnvelope<T> {
  data: T;
  error: string | null;
  meta: unknown;
}

async function rawFetch(endpoint: string, options: FetchOptions = {}): Promise<unknown> {
  const token = await getSessionToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    // Attach token as cookie for better-auth
    headers['Cookie'] = `better-auth.session_token=${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API call failed: ${response.statusText}`);
  }

  return response.json();
}

export async function apiFetch<S extends z.ZodTypeAny>(
  endpoint: string,
  schema: S,
  options: FetchOptions = {},
): Promise<z.infer<S>> {
  const body = (await rawFetch(endpoint, options)) as ApiEnvelope<unknown>;

  if (body.error) {
    throw new Error(body.error);
  }

  return schema.parse(body.data);
}

/**
 * For Better Auth's own routes (/api/auth/**, mounted directly to
 * auth.handler in apps/api/src/index.ts — `app.on(['POST','GET'],
 * '/api/auth/**', c => auth.handler(c.req.raw))`). Better Auth's handler
 * returns its own native response shape, never this app's {data,error,meta}
 * envelope — that envelope is applied by hand in every custom REST route
 * this app defines itself, and Better Auth's handler bypasses those
 * entirely. Routing an auth call through apiFetch would always parse
 * `body.data` as `undefined` (Better Auth's response has no top-level
 * `data` key) and break sign-in unconditionally, so auth calls use this
 * unwrapped sibling instead.
 */
export async function authFetch<S extends z.ZodTypeAny>(
  endpoint: string,
  schema: S,
  options: FetchOptions = {},
): Promise<z.infer<S>> {
  const body = await rawFetch(endpoint, options);
  return schema.parse(body);
}
