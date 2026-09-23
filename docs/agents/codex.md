# Codex Delegate Guidelines & Dispatch

Codex is delegated task packets using generated brief files. Briefs are rendered from GitHub issues using `scripts/delivery/packet-to-brief.mjs`.

## Dispatch Command

To dispatch Codex, run the relay script:

```bash
node <codex-delegate skill dir>/scripts/relay.mjs --brief <file> --cd E:/irth-wt/<branch>
```

Brief files are written to scratch/temp directories (not committed to the repository).

## Rules & Protocol

1. **Pre-install Rule:**
   - All workspace packages and dependencies must be pre-installed before Codex is dispatched.
   - Codex must never run `pnpm install`.

2. **Review & Commit Protocol:**
   - Codex performs code edits and runs verification checks, but **never creates git commits** (`git add` / `git commit`).
   - Claude reviews Codex's changes, verifies the full CI gate (`node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" turbo lint typecheck test`), creates the commit, and submits/merges the PR.

3. **Model Tier Selection:**
   - **`astra`**: Selected when issue labels include `risk:rls` or `risk:race` (deep tenancy/RLS, concurrency/race-condition risk).
   - **`sol`**: Selected when domain is `DM`, `OR`, `IN`, or `CX` (data model, order ingestion, inventory, connectors, or money-handling logic).
   - **`terra`**: Selected for general mechanical and routine tasks.
