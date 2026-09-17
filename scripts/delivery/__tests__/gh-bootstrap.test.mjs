import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, LABELS, MILESTONES } from "../gh-bootstrap.mjs";

test("empty repo: every label and milestone is created", () => {
  const p = plan({ labels: [], milestones: [] });
  assert.equal(p.labelCreate.length, LABELS.length);
  assert.equal(p.labelUpdate.length, 0);
  assert.deepEqual(p.milestoneCreate, MILESTONES);
});

test("converged repo: 0 changes, and foreign labels are ignored (never deleted)", () => {
  const labels = LABELS.map(([name, color, description]) => ({
    name,
    color: color.toLowerCase(),
    description,
  }));
  labels.push({
    name: "bug",
    color: "d73a4a",
    description: "Something isn't working",
  });
  const milestones = MILESTONES.map((title, i) => ({
    title,
    number: i + 1,
    state: "open",
  }));
  const p = plan({ labels, milestones });
  assert.deepEqual(p, {
    labelCreate: [],
    labelUpdate: [],
    milestoneCreate: [],
  });
});

test("drifted colour or description → update, not create", () => {
  const labels = LABELS.map(([name, color, description]) => ({
    name,
    color,
    description,
  }));
  labels[0] = { ...labels[0], color: "000000" };
  labels[1] = { ...labels[1], description: "stale" };
  const p = plan({
    labels,
    milestones: MILESTONES.map((title) => ({ title })),
  });
  assert.equal(p.labelCreate.length, 0);
  assert.deepEqual(
    p.labelUpdate.map((l) => l.name),
    [LABELS[0][0], LABELS[1][0]],
  );
});

test("label list has no duplicates and mirrors the six slices", () => {
  const names = LABELS.map(([n]) => n);
  assert.equal(new Set(names).size, names.length);
  for (const s of ["S0", "S1", "S2", "S3", "S4", "S5"])
    assert.ok(names.includes(`slice:${s}`));
  assert.equal(MILESTONES.length, 6);
});
