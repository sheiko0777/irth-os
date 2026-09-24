# Merge policy and repo settings

`CLAUDE.md` "Branch & Merge Workflow" describes how a PR is produced. This file
holds the repo-level settings that make the owner's `claude-code` label a real gate,
and the one-time `gh` setup steps.

## Prerequisites (one-time, owner)

- Project board: `gh auth refresh -h github.com -s project,read:project`, then
  `node scripts/delivery/gh-bootstrap.mjs` creates **IRTH OS Delivery** with the
  Executor / Slice / Status fields. Labels and milestones need only the `repo` scope.
- Re-run `node scripts/delivery/gh-bootstrap.mjs --dry-run` any time to see drift;
  the script never deletes labels.

## Required status checks on `main` (DL-04 — owner runs, needs admin)

Today `main` has no required checks, so a PR labelled `claude-code` auto-merges
even when CI is red. Enable, once `migration-check` (DL-05) and `schema-guard`
(DL-06) exist:

```bash
gh api -X PUT repos/sheiko0777/irth-os/branches/main/protection \
  -F enforce_admins=true \
  -F required_status_checks[strict]=true \
  -f required_status_checks[contexts][]=test \
  -f required_status_checks[contexts][]=integration \
  -f required_status_checks[contexts][]=secret-scan \
  -f required_status_checks[contexts][]=migration-check \
  -f required_status_checks[contexts][]=schema-guard \
  -F required_pull_request_reviews=null \
  -F restrictions=null
```

```bash
gh repo edit sheiko0777/irth-os --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge
```

Verify:

```bash
gh api repos/sheiko0777/irth-os/branches/main/protection --jq .required_status_checks.contexts
gh repo view sheiko0777/irth-os --json mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge
```

## Rules

- **Squash only.** One commit per packet; the PR title `type(scope): summary [ID]` becomes the commit subject.
- **The owner's `claude-code` label is the only merge trigger** for every lane. With required checks it waits for green.
- **Every non-Claude PR is reviewed by Claude first** (`docs/agents/review-protocol.md`, DL-13) and labelled `review:approved` before the owner merges.
- **`schema-guard`** blocks PRs that touch schema, RLS, or tenancy-critical paths (`packages/db/drizzle/**`, `packages/db/src/schema/**`, `packages/db/src/index.ts`, `packages/db/src/orgContext.ts`, `packages/db/src/permissions.ts`, `apps/admin/src/__tests__/tenancyGate.test.ts`, `apps/admin/src/__tests__/integration/rlsCoverage.test.ts`, `apps/admin/src/__tests__/integration/schemaDrift.test.ts`) unless the PR carries `exec:claude` or `schema:approved`. Additionally, `exec:ui` PRs are prohibited from touching server code (`apps/admin/src/server/**`). When a non-Claude PR requires schema changes, Claude inspects the schema modifications against tenancy and migration safety protocols during code review (`docs/agents/review-protocol.md`) and manually grants the `schema:approved` label to allow the PR to pass `schema-guard`.
- **`migration-check`** blocks migration files that collide, are numbered at or below `main`'s highest, are malformed, or edit/delete an existing migration.
- After a merge, the local worktree is reset to `origin/main` (`git checkout --detach origin/main`) and the branch deleted locally and remotely.
