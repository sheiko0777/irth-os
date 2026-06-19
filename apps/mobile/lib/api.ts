import { getOrgId, getSessionToken } from './auth';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

export async function apiFetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const orgId = await getOrgId();
  const token = await getSessionToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (orgId) {
    headers['org_id'] = orgId;
  }
  
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

  return response.json() as Promise<T>;
}
