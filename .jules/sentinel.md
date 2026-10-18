## 2026-10-18 - Accounts Receivable Clearance Fix
**Vulnerability:** Online payments were not posting a clearing entry.
**Learning:** Webhooks that handle financial events must be explicitly wired to clearing accounts if they represent actual money capture.
**Prevention:** Include ledger postings directly in webhook handlers when transactions are processed.
