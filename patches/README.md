# Security dependency compatibility patches

These patches adapt existing dependencies to the smallest available patched releases. They do not suppress vulnerability checks. Remove them when upstream MinIO/query-string support these versions directly.

- `adm-zip` 0.6.1 fixes GHSA-vwc7-r8mq-g2x9 and GHSA-7q85-xj36-vmfc.
- `nodemailer` 9.1.1 fixes GHSA-8m3c-c648-2xjj plus the 9.1.0 address-parser fixes.
- `qs` 6.16.0 fixes GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g.
- `decode-uri-component` 0.5.0 fixes GHSA-vcc3-ghjq-m6fr. Its ESM-only default export requires query-string 7's CommonJS import to access `.default` under the supported Bun runtime.
- `stream-json` 3.5.0 fixes GHSA-528h-pc64-c93x. MinIO 8.0.7 imports the old `jsonl/Parser.js` and `.make()` API. Its source, ESM and CommonJS distributions now use `jsonl/parser.js` and the explicit Node-stream `.asStream()` factory. The `{key, value}` output contract is unchanged.

Versions and advisory ranges were checked against the npm registry audit endpoint on 2026-09-21. Advisory details: https://github.com/advisories/ (append the individual GHSA ID).

`tests/integration/dependency-compatibility.test.ts` verifies URL decoding and an actual MinIO notification poller consuming a Node response stream. Storage integration tests additionally exercise PostgreSQL and S3-compatible storage. Docker must copy this directory before frozen dependency installation so Bun can apply the lockfile's patches reproducibly.
