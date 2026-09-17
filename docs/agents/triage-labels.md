# Labels

The tracker's label vocabulary. Applied by the owner or Claude only (see
`docs/agents/security.md` once DL-18 lands); every other agent reads labels, never sets them.

## Delivery labels

| Label                                                                                          | Meaning                                                                                       |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `task`                                                                                         | A task packet (auto-applied by the issue form)                                                |
| `epic`                                                                                         | A slice epic (S0–S5); tasks hang off it as sub-issues                                         |
| `decision`                                                                                     | A question for the owner/accountant; carries a default that applies if unanswered             |
| `exec:claude` `exec:codex` `exec:jules` `exec:hermes` `exec:owner` `exec:accountant` `exec:ui` | Who executes (routing table in `docs/agents/domain.md`)                                       |
| `slice:S0` … `slice:S5`                                                                        | Slice; mirrors the milestone                                                                  |
| `domain:DM` `domain:OR` `domain:IN` `domain:CX` `domain:AN` `domain:DL` `domain:UI`            | Packet domain                                                                                 |
| `status:ready` `status:blocked` `status:in-review`                                             | Ready = no open blockers; blocked = open `blocked_by` or a `needs:*`; in-review = PR open     |
| `needs:owner` `needs:accountant` `needs:schema`                                                | Waiting on a decision, or on a Claude-owned schema task                                       |
| `review:approved` `review:changes-requested`                                                   | Result of the Claude review protocol on an external PR                                        |
| `schema:approved`                                                                              | Claude has reviewed a non-Claude PR that touches guarded schema paths (`schema-guard` passes) |
| `jules`                                                                                        | Trigger: Jules picks the issue up (owner or Claude only)                                      |
| `claude-code`                                                                                  | Trigger: the owner's one-click squash merge (waits for required checks)                       |
| `intent`                                                                                       | An idea captured before it is a packet (`brainstorm-to-issue`)                                |

## Mapping to the five canonical triage roles

Some engineering skills speak in terms of generic triage roles. They map as follows:

| Canonical role    | Label here                               |
| ----------------- | ---------------------------------------- |
| `needs-triage`    | `intent`                                 |
| `needs-info`      | `needs:owner` or `needs:accountant`      |
| `ready-for-agent` | `status:ready` + an `exec:*` label       |
| `ready-for-human` | `exec:owner` / `exec:accountant`         |
| `wontfix`         | close the issue with a comment; no label |
