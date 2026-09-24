#!/usr/bin/env node
// DL-09 — generate Codex briefs from GitHub issues or packet objects
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Determine model tier for Codex dispatch based on labels and domain/content.
 * @param {object} packet - { title, body, labels } where labels is array of strings or objects { name }
 */
export function determineTier(packet = {}) {
  const labelNames = (packet.labels || []).map((l) =>
    typeof l === "string" ? l : l.name
  );

  if (labelNames.some((l) => l === "risk:rls" || l === "risk:race")) {
    return "astra";
  }

  const hasSolDomainLabel = labelNames.some((l) =>
    ["domain:DM", "domain:OR", "domain:IN", "domain:CX"].includes(l)
  );

  const text = `${packet.title || ""} ${packet.body || ""}`;
  const mentionsMoneyOrConnector =
    /\b(money|connector|stripe|shopify|paymob|fx|ledger)\b/i.test(text);

  const hasSolDomainInText = /\bdomain\s*:\s*(DM|OR|IN|CX)\b/i.test(text);

  if (hasSolDomainLabel || hasSolDomainInText || mentionsMoneyOrConnector) {
    return "sol";
  }

  return "terra";
}

/**
 * Render brief text for Codex given a packet.
 * @param {object} packet - { title, body, labels }
 */
export function render(packet = {}) {
  const title = packet.title || "";
  const body = packet.body || "";
  const labels = (packet.labels || []).map((l) =>
    typeof l === "string" ? l : l.name
  );

  const canDoMigrations = labels.includes("exec:claude");

  return `<task>
Title: ${title}

${body}
</task>

<verification_loop>
Run the full CI gate for this monorepo — lint, typecheck and tests across every workspace — using the pnpm invocation that actually works on Windows:

Full gate:
node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" turbo lint typecheck test

Per package fast loop:
node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" --filter @irth/db test
node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" --filter @irth/domain test
node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" --filter @irth/admin typecheck
node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" --filter @irth/api typecheck
node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" --filter @irth/admin test
</verification_loop>

<action_safety>
- Do NOT run git add or git commit. Codex does not commit; Claude handles review and commits.
- Do NOT run pnpm install. All dependencies must be pre-installed.
${canDoMigrations ? "- Migrations permitted (label exec:claude present)." : "- Do NOT touch or create database migrations (label exec:claude is absent)."}
- Do NOT edit .env, .env.*, or pnpm-lock.yaml.
</action_safety>

<structured_output_contract>
Your report in response must include:
1. What/Why summary
2. List of modified files
3. Gate output counts (lint, typecheck, test results from verify-gate)
4. Deviations + the evidence row for docs/delivery/
</structured_output_contract>`;
}

function gh(args) {
  const out = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out || "null");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help")) {
    console.log(
      "Usage: node scripts/delivery/packet-to-brief.mjs <issue> [--out <file>]"
    );
    process.exit(1);
  }

  const issue = argv[0];
  const outIdx = argv.indexOf("--out");
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;

  const issueData = gh(["issue", "view", issue, "--json", "title,body,labels"]);

  const tier = determineTier(issueData);
  const briefText = render(issueData);

  console.log(`tier: ${tier}`);

  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, briefText, "utf8");
    console.log(`Wrote brief to ${outFile}`);
  } else {
    console.log("\n" + briefText);
  }
}

if (process.argv[1] && process.argv[1].endsWith("packet-to-brief.mjs")) {
  main();
}
