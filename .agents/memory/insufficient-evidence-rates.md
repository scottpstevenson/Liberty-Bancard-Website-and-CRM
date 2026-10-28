---
name: Insufficient-evidence rates and scoped aggregates
description: Zero-denominator rates are null, not 0%; windowed dashboard counts are SQL aggregates that fail per section to null.
---
Rates with no denominator are null (shared/rate-evidence.ts); UIs show n/a. Unknown scores are excluded from averages (coverage shown), never defaulted to 100 or 0.

**Why:** a 0% bounce rate with zero sends and a green "100" health for an unscored inbox read as healthy evidence that did not exist.

**How to apply:** new rate/average DTOs carry an evidence block (basis, denominator, sufficient). Windowed dashboard counts use SQL aggregates with predicates inside SQL (no row cap), each section failing to null independently. Error-with-no-data UI is denied/unavailable (+ read-only Retry); setup guidance only for a successful empty result.

Test-running quirk: background processes started with nohup inside a ShellExec die when the call ends; use run_in_background:true, and keep logs outside /tmp (disposable runs may clear it). Browser pilot-history suite has a timing flake in its "denied" wait; rerun once.
