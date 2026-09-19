import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/__tests__/ui/**/*.test.tsx"],
    clearMocks: true,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
