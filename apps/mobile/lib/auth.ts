import * as SecureStore from "expo-secure-store";

const ORG_ID_KEY = "irth_org_id";
const SESSION_TOKEN_KEY = "irth_session_token";

export async function setOrgId(orgId: string): Promise<void> {
  await SecureStore.setItemAsync(ORG_ID_KEY, orgId);
}

export async function getOrgId(): Promise<string | null> {
  return await SecureStore.getItemAsync(ORG_ID_KEY);
}

export async function removeOrgId(): Promise<void> {
  await SecureStore.deleteItemAsync(ORG_ID_KEY);
}

export async function setSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}

export async function getSessionToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

export async function removeSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}

export async function clearSession(): Promise<void> {
  await removeOrgId();
  await removeSessionToken();
}
