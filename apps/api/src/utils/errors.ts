export function handleError(error: unknown): string {
  console.error("API Error:", error);
  if (process.env.NODE_ENV === "production") {
    return "internal_server_error";
  }
  return error instanceof Error ? error.message : String(error);
}