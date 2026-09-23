# Slice Evidence Ledgers

This directory contains per-slice evidence ledgers for delivery tracking across Slices S0 through S5.

## Overview

To prevent `docs/implementation/STATUS.md` from growing indefinitely, each delivery slice maintains its own evidence ledger (`S0.md` through `S5.md`). Pull requests and automated sync routines append completed task rows to the respective slice file upon merging.

## Row Format

Every evidence row in a slice ledger must follow this standard format:

`ID | Status | PR | Commit | Evidence/Tests | Migration | Blocker | Next`

### Columns

| Column             | Description                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| **ID**             | Task packet ID (e.g., `DL-15`, `OR-01`, `DM-03`).                                                    |
| **Status**         | Current task status (see vocabulary below).                                                          |
| **PR**             | GitHub Pull Request link (e.g., `[PR #123](https://github.com/sheiko0777/irth-os/pull/123)` or `—`). |
| **Commit**         | Short git commit SHA (e.g., `a1b2c3d`) or `—`.                                                       |
| **Evidence/Tests** | Key evidence of completion (e.g., test suite names, passing CI job names, or verification outputs).  |
| **Migration**      | Migration file name if applicable (e.g., `0067_add_foo.sql`) or `none`.                              |
| **Blocker**        | Active blocking issue or dependency, or `none`.                                                      |
| **Next**           | Next action or dependent task ID, or `none`.                                                         |

## Status Vocabulary

Allowed values for the **Status** column:

- `ready` — Task defined and unblocked, ready to be picked up.
- `in-progress` — Active work underway.
- `in-review` — PR opened and awaiting review.
- `confirmed, fixed, merged` — Task completed, verified, and merged to `main`.
- `done` — Completed non-code/documentation task merged to `main`.
- `closed, not merged` — Task closed as obsolete, superseded, or rejected.
- `blocked` — Waiting on a dependency or decision issue.

## Append Rule

- **Rule**: Exactly one row per merged packet, appended at merge.
- **Location**: Append to `docs/delivery/S<n>.md` corresponding to the packet's slice (e.g., `S0.md` for `S0` tasks, `S1.md` for `S1` tasks).
- **Automation**: PRs append their row as part of the PR template report contract, and the daily sync routine (`docs/agents/daily-sync.md`) reconciles any missing rows.
