# Restoring the production database

Neon project `winter-dust-10479439` ("irth-2026-09"), branch `production`. Free plan: **6 hours** of point-in-time history, 10 branches max.

There are two restore points:

| Problem noticed | Restore from | How far back |
|---|---|---|
| Within 6 hours | Point-in-time restore on `production` | Any second in the last 6 h |
| Later, and caused by a deploy | Snapshot branch `pre-migrate-api` / `pre-migrate-admin` | Moment right before the **latest** deploy's migrations |

`pre-migrate-*` branches are recreated by every deploy (`packages/db/scripts/pre-migrate-snapshot.sh`, run from `deploy-api.yml` / `deploy-admin.yml` before `db:migrate`), so they only ever hold the state before the most recent deploy. If a bad deploy is followed by another deploy, that snapshot is gone. Stop deploying first.

## 1. Stop writes

Pause the deploy workflows (GitHub → Actions → disable `Deploy API` / `Deploy Admin`) so the next push doesn't overwrite the snapshot.

## 2a. Point-in-time restore (within 6 h)

Neon console → project → Branches → `production` → **Restore** → *From history* → pick the timestamp just before the bad change → restore. Neon keeps the pre-restore state as a backup branch (`production_old_<timestamp>`) automatically.

## 2b. Restore from the pre-migrate snapshot

Neon console → Branches → `production` → **Restore** → *From another branch* → choose `pre-migrate-api` (or `-admin`, whichever ran first for that deploy: check the Actions log line `Snapshot branch ... (…timestamp)`) → restore.

Anything written to production **after** the snapshot is lost by this restore. Check `orders` / `outbox_events` created after the snapshot timestamp first, and export them if needed:

```sql
select id, order_number, created_at from orders where created_at > '<snapshot timestamp>';
```

## 3. Verify

- `https://app.irth-house.com/api/health` and the API `/health` return `db: up`.
- `select filename from public._migrations order by filename desc limit 5;` shows the migration you expect to be the last applied (`migrate.mjs` ledger).
- Re-enable the deploy workflows. Revert the bad migration in git **before** re-enabling, otherwise the next deploy re-applies it.

## Drill

Run once per slice, record the result in `docs/delivery/S<n>.md`:

1. Create a scratch branch from `pre-migrate-api` (Branches → pre-migrate-api → Create child branch, with compute).
2. Connect with its connection string and run the step 3 checks against it.
3. Delete the scratch branch.
