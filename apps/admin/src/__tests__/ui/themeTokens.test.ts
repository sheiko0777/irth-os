import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const globalsPath = path.join(sourceRoot, "app", "[locale]", "globals.css");

const semanticTokens = {
  "--canvas": { light: "#F6F5F2", dark: "#191917" },
  "--surface": { light: "#FFFFFF", dark: "#23221F" },
  "--raised": { light: "#EFEEE9", dark: "#2D2B27" },
  "--text-primary": { light: "#252420", dark: "#F3F1EC" },
  "--text-secondary": { light: "#65615A", dark: "#B8B2A8" },
  "--accent": { light: "#76502C", dark: "#D2AC80" },
  "--accent-fg": { light: "#FFFFFF", dark: "#23221F" },
  "--input-border": { light: "#8C867D", dark: "#898277" },
  "--separator": { light: "#DDDAD3", dark: "#454139" },
  "--success": { light: "#166534", dark: "#86EFAC" },
  "--success-bg": { light: "#F0FDF4", dark: "#14291D" },
  "--warning": { light: "#854D0E", dark: "#FDE047" },
  "--warning-bg": { light: "#FEFCE8", dark: "#302A13" },
  "--critical": { light: "#991B1B", dark: "#FCA5A5" },
  "--critical-bg": { light: "#FEF2F2", dark: "#351C1C" },
  "--info": { light: "#1E40AF", dark: "#93C5FD" },
  "--info-bg": { light: "#EFF6FF", dark: "#1B273A" },
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
