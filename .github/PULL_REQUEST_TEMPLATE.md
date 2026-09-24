## Summary

Closes #

## PR Checklist

- [ ] Packet ID in PR title (e.g., `[DL-03]`)
- [ ] `Closes #n` included in description
- [ ] Gate command executed (`node pnpm.cjs turbo lint typecheck test`) and counts reported
- [ ] Migration checks (if applicable): numbered above main / schema updated / new-migration skill used
- [ ] RLS policy enabled/forced/policied for new tables
- [ ] Money amounts stored as bigint minor units
- [ ] Writes executed via `withOrg`
- [ ] Evidence row per `docs/delivery/README.md` included
- [ ] Proved the gate fails (if adding new gates)
- [ ] Do-not-touch paths honored
- [ ] Screenshots attached (if UI changes)

## Gate Proof & Output Counts

```text
node pnpm.cjs turbo lint typecheck test
```

## Evidence Row

| ID | status | PR | commit | evidence/tests | migration | blocker | next |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

## Deviations from Packet

- None
