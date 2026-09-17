#!/usr/bin/env node
// DL-02 — converge the GitHub repo on the delivery vocabulary: labels, slice milestones,
// and the "IRTH OS Delivery" project board. Idempotent: a second run reports 0 changes.
//
//   node scripts/delivery/gh-bootstrap.mjs [--dry-run] [--repo owner/name]
//
// Labels and milestones need only the `repo` scope. The project board needs
// `gh auth refresh -s project,read:project`; without it the board step is skipped with a note.
// Existing labels not in the list (bug, claude-code, …) are never deleted.

import { execFileSync } from "node:child_process";

const REPO_DEFAULT = "sheiko0777/irth-os";

// Source of truth for the vocabulary is docs/agents/triage-labels.md; keep this list in sync.
export const LABELS = [
  ["task", "1D76DB", "A task packet (docs/agents/task-packet.md)"],
  ["epic", "5319E7", "A slice epic (S0–S5); tasks hang off it as sub-issues"],
  [
    "decision",
    "FBCA04",
    "Owner/accountant question; the default applies if unanswered",
  ],
  ["intent", "C5DEF5", "An idea captured before it is a packet"],
  ["exec:claude", "0E8A16", "Executor: Claude"],
  ["exec:codex", "0E8A16", "Executor: Codex"],
  ["exec:jules", "0E8A16", "Executor: Jules"],
  ["exec:hermes", "0E8A16", "Executor: Hermes"],
  ["exec:owner", "0E8A16", "Executor: owner (decision, fixture, UAT)"],
  ["exec:accountant", "0E8A16", "Executor: accountant (decision, sign-off)"],
  [
    "exec:ui",
    "0E8A16",
    "Executor: design track (apps/admin presentation only)",
  ],
  ["slice:S0", "BFD4F2", "Slice S0 — foundation minimum"],
  ["slice:S1", "BFD4F2", "Slice S1 — order-first (Shopify)"],
  ["slice:S2", "BFD4F2", "Slice S2 — second channels + physical ops"],
  ["slice:S3", "BFD4F2", "Slice S3 — B2B, purchasing, suppliers, money"],
  ["slice:S4", "BFD4F2", "Slice S4 — accounting workbench"],
  ["slice:S5", "BFD4F2", "Slice S5 — analytics, social, API/MCP"],
  ["domain:DM", "D4C5F9", "Data model, tenancy, ledger, costing"],
  ["domain:OR", "D4C5F9", "Order ingestion, parity, reconciliation"],
  [
    "domain:IN",
    "D4C5F9",
    "Inventory, manufacturing, POS, purchasing, suppliers",
  ],
  ["domain:CX", "D4C5F9", "Connectors, API, MCP, auth, approvals, audit"],
  ["domain:AN", "D4C5F9", "Analytics, reports, observability"],
  ["domain:DL", "D4C5F9", "Delivery system"],
  ["domain:UI", "D4C5F9", "Design track"],
  ["status:ready", "0052CC", "No open blockers"],
  ["status:blocked", "B60205", "Open blocked_by or needs:* dependency"],
  ["status:in-review", "FBCA04", "PR open"],
  ["needs:owner", "E99695", "Waiting on an owner decision"],
  ["needs:accountant", "E99695", "Waiting on an accountant decision"],
  ["needs:schema", "E99695", "Waiting on a Claude-owned schema task"],
  ["review:approved", "0E8A16", "Claude review protocol: approved"],
  [
    "review:changes-requested",
    "B60205",
    "Claude review protocol: changes requested",
  ],
  [
    "schema:approved",
    "006B75",
    "Claude reviewed a non-Claude PR touching guarded schema paths",
  ],
  [
    "jules",
    "F9D0C4",
    "Trigger: Jules picks this issue up (owner or Claude only)",
  ],
];

export const MILESTONES = [
  "S0 foundation gate",
  "S1 order-first gate",
  "S2 channels+ops gate",
  "S3 B2B+money gate",
  "S4 accounting gate",
  "S5 platform gate",
];

export const PROJECT_TITLE = "IRTH OS Delivery";
export const PROJECT_FIELDS = {
  Executor: ["claude", "codex", "jules", "hermes", "owner", "accountant", "ui"],
  Slice: ["S0", "S1", "S2", "S3", "S4", "S5"],
  Status: ["ready", "blocked", "in-review", "done"],
};

/** Pure planner: compare current vs desired, return what to create/update. */
export function plan({ labels = [], milestones = [] }) {
  const byName = new Map(labels.map((l) => [l.name, l]));
  const labelCreate = [];
  const labelUpdate = [];
  for (const [name, color, description] of LABELS) {
    const cur = byName.get(name);
    if (!cur) labelCreate.push({ name, color, description });
    else if (
      (cur.color || "").toUpperCase() !== color ||
      (cur.description || "") !== description
    )
      labelUpdate.push({ name, color, description });
  }
  const have = new Set(milestones.map((m) => m.title));
  const milestoneCreate = MILESTONES.filter((t) => !have.has(t));
  return { labelCreate, labelUpdate, milestoneCreate };
}

function gh(args, { json = true } = {}) {
  const out = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return json ? JSON.parse(out || "null") : out;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const repoIdx = argv.indexOf("--repo");
  const repo = repoIdx >= 0 ? argv[repoIdx + 1] : REPO_DEFAULT;
  const [owner] = repo.split("/");

  const labels = gh([
    "label",
    "list",
    "-R",
    repo,
    "--limit",
    "200",
    "--json",
    "name,color,description",
  ]);
  const milestones = gh([
    "api",
    `repos/${repo}/milestones?state=all&per_page=100`,
  ]);
  const p = plan({ labels, milestones });

  const lines = [];
  for (const l of p.labelCreate) lines.push(`label create  ${l.name}`);
  for (const l of p.labelUpdate) lines.push(`label update  ${l.name}`);
  for (const t of p.milestoneCreate) lines.push(`milestone create  ${t}`);
  console.log(lines.length ? lines.join("\n") : "labels/milestones: 0 changes");

  if (!dryRun) {
    for (const l of [...p.labelCreate, ...p.labelUpdate]) {
      gh(
        [
          "label",
          "create",
          l.name,
          "-R",
          repo,
          "--color",
          l.color,
          "--description",
          l.description,
          "--force",
        ],
        { json: false },
      );
    }
    for (const t of p.milestoneCreate) {
      gh(
        ["api", "-X", "POST", `repos/${repo}/milestones`, "-f", `title=${t}`],
        { json: false },
      );
    }
  }

  // Project board — needs the project scope; skip with a note when missing.
  let projects = null;
  try {
    projects = gh(["project", "list", "--owner", owner, "--format", "json"]);
  } catch {
    console.log(
      `project: skipped — run \`gh auth refresh -s project,read:project\` then re-run to create "${PROJECT_TITLE}"`,
    );
  }
  if (projects) {
    const existing = (projects.projects || []).find(
      (x) => x.title === PROJECT_TITLE,
    );
    if (existing) {
      console.log(`project: "${PROJECT_TITLE}" exists (#${existing.number})`);
    } else {
      console.log(`project create  ${PROJECT_TITLE}`);
      if (!dryRun) {
        const created = gh([
          "project",
          "create",
          "--owner",
          owner,
          "--title",
          PROJECT_TITLE,
          "--format",
          "json",
        ]);
        for (const [field, options] of Object.entries(PROJECT_FIELDS)) {
          gh(
            [
              "project",
              "field-create",
              String(created.number),
              "--owner",
              owner,
              "--name",
              field,
              "--data-type",
              "SINGLE_SELECT",
              "--single-select-options",
              options.join(","),
            ],
            { json: false },
          );
        }
      }
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("gh-bootstrap.mjs")) main();
