import test from "node:test";
import assert from "node:assert/strict";
import { determineTier, render } from "../packet-to-brief.mjs";

const FIXTURE_PACKET = {
  title: "[DL-05] Migration numbering lock (CI check migration-check)",
  body: `Goal
Fail any PR whose migration files collide, are numbered at or below origin/main's highest,
are malformed, or edit/delete an existing migration.

Slice S0 · Domain DL · Executor jules · Size S

Files
new: packages/db/scripts/check-migrations.mjs
packages/db/package.json (script check:migrations)

Reuse
packages/db/scripts/migrate.mjs

Do-not-touch
packages/db/drizzle/** · pnpm-lock.yaml · .env*

Acceptance
- On current main the check passes.

Tests
packages/db/src/__tests__/checkMigrations.test.ts

Report contract
Evidence row for DL-05 in docs/delivery/S0.md; gate counts.`,
  labels: [{ name: "exec:jules" }, { name: "slice:S0" }, { name: "domain:DL" }],
};

test("render produces all four blocks and exact verify-gate commands", () => {
  const brief = render(FIXTURE_PACKET);

  // Four required blocks
  assert.match(brief, /<task>/);
  assert.match(brief, /<\/task>/);
  assert.match(brief, /<verification_loop>/);
  assert.match(brief, /<\/verification_loop>/);
  assert.match(brief, /<action_safety>/);
  assert.match(brief, /<\/action_safety>/);
  assert.match(brief, /<structured_output_contract>/);
  assert.match(brief, /<\/structured_output_contract>/);

  // Exact verify-gate commands from .claude/skills/verify-gate/SKILL.md
  assert.ok(
    brief.includes(
      'node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" turbo lint typecheck test'
    )
  );
  assert.ok(
    brief.includes(
      'node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" --filter @irth/db test'
    )
  );
  assert.ok(
    brief.includes(
      'node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" --filter @irth/domain test'
    )
  );
  assert.ok(
    brief.includes(
      'node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" --filter @irth/admin typecheck'
    )
  );
  assert.ok(
    brief.includes(
      'node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" --filter @irth/api typecheck'
    )
  );
  assert.ok(
    brief.includes(
      'node "C:\\Users\\sheri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" --filter @irth/admin test'
    )
  );

  // Action safety rules
  assert.match(brief, /git add or git commit/i);
  assert.match(brief, /pnpm install/i);
  assert.match(brief, /\.env/);
  assert.match(brief, /pnpm-lock\.yaml/);

  // Structured output contract
  assert.match(brief, /1\. What\/Why summary/);
  assert.match(brief, /2\. List of modified files/);
  assert.match(brief, /3\. Gate output counts/);
  assert.match(brief, /4\. Deviations \+ the evidence row/);
});

test("determineTier assigns astra for risk:rls or risk:race labels", () => {
  const rlsPacket = {
    ...FIXTURE_PACKET,
    labels: [{ name: "risk:rls" }],
  };
  assert.equal(determineTier(rlsPacket), "astra");

  const racePacket = {
    ...FIXTURE_PACKET,
    labels: [{ name: "risk:race" }],
  };
  assert.equal(determineTier(racePacket), "astra");
});

test("determineTier assigns sol for DM/OR/IN/CX domains or money/connector content", () => {
  const dmPacket = {
    ...FIXTURE_PACKET,
    labels: [{ name: "domain:DM" }],
  };
  assert.equal(determineTier(dmPacket), "sol");

  const moneyPacket = {
    title: "[OR-01] Money calculation for order total",
    body: "Calculate totals in minor units",
    labels: [{ name: "domain:DL" }],
  };
  assert.equal(determineTier(moneyPacket), "sol");
});

test("determineTier assigns terra by default", () => {
  assert.equal(determineTier(FIXTURE_PACKET), "terra");
});
