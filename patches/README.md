# Security dependency compatibility patches

These patches adapt existing dependencies to the smallest available patched releases. They do not suppress vulnerability checks. Remove them when upstream MinIO/query-string support these versions directly.

- `adm-zip` 0.6.1 fixes GHSA-vwc7-r8mq-g2x9 and GHSA-7q85-xj36-vmfc.
- `nodemailer` 10.1.4 (verified 2026-10-24) fixes GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h and GHSA-8c8m-p3m8-cjg8, on top of the 9.1.1 fix for GHSA-8m3c-c648-2xjj and the 9.1.0 address-parser fixes.
- `qs` 6.17.1 (verified 2026-10-30) fixes GHSA-6pq8-jhm2-2vcw, on top of the 6.16.0 fixes for GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g.
- `decode-uri-component` 0.5.1 (verified 2026-10-30) fixes GHSA-qr28-fpjm-wq7f, on top of the 0.5.0 fix for GHSA-vcc3-ghjq-m6fr. Its ESM-only default export requires query-string 7's CommonJS import to access `.default` under the supported Bun runtime.
- `stream-json` 3.7.0 (verified 2026-10-24) fixes GHSA-528h-pc64-c93x, GHSA-mjw6-4jj6-33hc, GHSA-hqr4-qq8f-hg3x and GHSA-jj87-hc4r-jwfw. MinIO 8.0.7 imports the old `jsonl/Parser.js` and `.make()` API. Its source, ESM and CommonJS distributions now use `jsonl/parser.js` and the explicit Node-stream `.asStream()` factory. The `{key, value}` output contract is unchanged.

Versions and advisory ranges were checked against the npm registry audit endpoint on 2026-09-21. Advisory details: https://github.com/advisories/ (append the individual GHSA ID).

`tests/integration/dependency-compatibility.test.ts` verifies URL decoding and an actual MinIO notification poller consuming a Node response stream. Storage integration tests additionally exercise PostgreSQL and S3-compatible storage. Docker must copy this directory before frozen dependency installation so Bun can apply the lockfile's patches reproducibly.
