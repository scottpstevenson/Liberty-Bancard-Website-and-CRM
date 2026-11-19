# Historical repair and template snapshots

Archived November 19, 2026 by Phase 8. These files are retained byte-for-byte as historical evidence, not runtime assets or current operational instructions. Do not execute the repair scripts against production.

The snapshots contain historical template/step content. No new recipients or customer identity exports were added. Keep them within the existing repository's access boundary. Hashes and original paths are in `docs/certification/phase8/archive-manifest.json`; copying an archived file back to its original path reproduces its recorded SHA-256. The completed CTA script can be retrieved with `git show` using the exact recorded restoreSource. No Git history was rewritten.

Current fixture-only backup tools write private files under ignored `generated-artifacts/legacy-backups/`. Apply requires the exact `--backup=... --sha256=...` from a matching dry-run, matching source/target/content/flags and a fresh timestamp, inside a serializable transaction. Historical snapshots cannot satisfy this contract. Normal live content changes belong in the governed Content Workspace.
