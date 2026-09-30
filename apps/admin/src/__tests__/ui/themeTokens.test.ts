import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const globalsPath = path.join(sourceRoot, "app", "[locale]", "globals.css");

const semanticTokens = {
  "--canvas": { light: "#EEF2F8", dark: "#0B1220" },
  "--surface": { light: "#FFFFFF", dark: "#131C2E" },
  "--raised": { light: "#F2F5FA", dark: "#1B2640" },
  "--text-primary": { light: "#0F1B33", dark: "#EEF2FA" },
  "--text-secondary": { light: "#536179", dark: "#A3B1C9" },
  "--accent": { light: "#1F3B7A", dark: "#8FB0F5" },
  "--accent-fg": { light: "#FFFFFF", dark: "#0B1220" },
  "--input-border": { light: "#8391A8", dark: "#5F6F8C" },
  "--separator": { light: "#DDE4EF", dark: "#26324A" },
  "--success": { light: "#166534", dark: "#6EE7A0" },
  "--success-bg": { light: "#ECFDF3", dark: "#0F2A1E" },
  "--warning": { light: "#92400E", dark: "#FBBF5A" },
  "--warning-bg": { light: "#FFF7E6", dark: "#2C2111" },
  "--critical": { light: "#B42318", dark: "#FCA5A5" },
  "--critical-bg": { light: "#FEF3F2", dark: "#331A1F" },
  "--info": { light: "#1D4ED8", dark: "#93C5FD" },
  "--info-bg": { light: "#EEF4FF", dark: "#14233D" },
} as const;

function ruleBody(css: string, selector: string) {
  const selectorStart = css.indexOf(`${selector} {`);
  expect(selectorStart, `Missing ${selector} rule`).toBeGreaterThanOrEqual(0);
  const openBrace = css.indexOf("{", selectorStart);
  let depth = 0;

  for (let index = openBrace; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(openBrace + 1, index);
  }

  throw new Error(`Unclosed ${selector} rule`);
}

function declarations(css: string, selector: string) {
  return new Map(
    [...ruleBody(css, selector).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
      ([, name, value]) => [name, value.trim()],
    ),
  );
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(entryPath);
      return /\.(?:css|scss|js|jsx|ts|tsx)$/.test(entry.name)
        ? [entryPath]
        : [];
    }),
  );
  return files.flat();
}

describe("admin theme tokens", () => {
  it("defines the complete palette for light, system dark, and explicit dark", async () => {
    const css = await readFile(globalsPath, "utf8");
    const light = declarations(css, ":root");
    const systemDark = declarations(css, ':root:not([data-theme="light"])');
    const explicitDark = declarations(css, ':root[data-theme="dark"]');

    for (const [token, values] of Object.entries(semanticTokens)) {
      expect(light.get(token)?.toLowerCase(), `${token} light`).toBe(
        values.light.toLowerCase(),
      );
      expect(systemDark.get(token)?.toLowerCase(), `${token} system dark`).toBe(
        values.dark.toLowerCase(),
      );
      expect(
        explicitDark.get(token)?.toLowerCase(),
        `${token} explicit dark`,
      ).toBe(values.dark.toLowerCase());
    }
  });

  it("defines every application-owned CSS variable used in admin source", async () => {
    const css = await readFile(globalsPath, "utf8");
    const defined = new Set(
      [...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(([, name]) => name),
    );
    const files = (await sourceFiles(sourceRoot)).filter(
      (file) => file !== globalsPath && file !== fileURLToPath(import.meta.url),
    );
    const used = new Set<string>();

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const [, name] of source.matchAll(/var\(\s*(--[\w-]+)/g)) {
        // Carbon and Radix publish these runtime variables themselves.
        if (!name.startsWith("--cds-") && !name.startsWith("--radix-")) {
          used.add(name);
        }
      }
    }

    expect([...used].filter((name) => !defined.has(name)).sort()).toEqual([]);
  });
});
