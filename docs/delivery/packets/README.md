# Task packets

One file per domain, produced by the 2026-09-16/17 reconciliation pass (six read-only agents over this repo, the Codex sol + astra reviews and the 9-agent research synthesis). Each `### <ID>` block is a self-contained task packet: goal, files (`new:` prefix = does not exist yet), reuse pointers, acceptance bullets, tests, risks.

- The integrated plan (slices, gates, task DAG, applied merges, migration sequence, delivery structure) is `docs/superpowers/specs/2026-09-17-irth-os-bos-design.md`. Where a packet and the plan disagree, the plan wins (see its sections 3 and 7.0 for the merges).
- Packets become GitHub issues via `scripts/delivery/publish-tasks.mjs` (task DL-17). Until then an executor takes the packet text as the issue body.
- `../briefs/astra-ui-brief.md` is the pending design-track brief (task UI-00). `../research/` holds the two Codex reviews the plan cites.
