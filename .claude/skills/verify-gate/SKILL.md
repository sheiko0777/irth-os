---
name: verify-gate
description: Run the full CI gate for this monorepo — lint, typecheck and tests across every workspace — using the pnpm invocation that actually works on Windows.
---

# Verify gate

Runs what CI runs, before CI runs it.

## The Windows problem this encodes

`pnpm` on PATH is `C:\Users\sheri\AppData\Roaming\npm\pnpm.ps1`, a PowerShell
script. It **fails under `pwsh -NoProfile`**, which is how subagents and hooks
invoke shells. A delegated task once spent its entire run fighting this and
edited nothing.

Always call the CLI entry point through node:

```
node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" <args>
```

## The gate

What `.github/workflows/ci.yml` runs, in one command:

```bash
node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" turbo lint typecheck test
```

Per package, when you want a fast loop:

```bash
node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" --filter @irth/db test
node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" --filter @irth/domain test
node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" --filter @irth/admin typecheck
node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" --filter @irth/api typecheck
node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" --filter @irth/admin test
```

`@irth/admin typecheck` takes 1–3 minutes. That is normal — let it finish.

## Integration tests

Separate config, real Postgres, not run by the unit suite:

```bash
node "C:\Users\sheri\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs" --filter @irth/admin test:integration
```

Needs `TEST_DATABASE_URL` (see `apps/admin/.env.test.local`, gitignored) pointing
at a **disposable** Neon branch. The harness truncates every table it touches and
refuses to run if that URL matches `DATABASE_URL`.

## When something fails for the wrong reason

- **`ERR_MODULE_NOT_FOUND` for a package that appears to exist** — a dangling
  junction. `Test-Path` returns true while the store target is gone. A killed
  `pnpm install` does this.
- **Peer link missing** (store dir present, symlink inside its dependent gone) —
  `--frozen-lockfile` will *not* fix it. Only `pnpm install --force` does.
- **`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`** — set `CI=true`. Required
  after any `.npmrc` change.
- Installs take 10–30 minutes here. **Never start one that could outlive the
  session**; a killed install corrupts `node_modules`.

## Do not "fix" these

- The root `.npmrc` `hoist-pattern` lines keep `@types/react` out of pnpm's
  hidden hoist directory. Remove them and admin's typecheck returns 613 errors
  (two unrelated `ReactNode` types, mostly `TS2786`).
- `turbo.json` has no `type-check` task. That name was a no-op for months
  because no package defines that script. The real one is `typecheck`.
