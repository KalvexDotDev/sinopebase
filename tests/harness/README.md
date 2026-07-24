# Wave 0 test isolation harness

This directory is intentionally standalone until the coordinator adopts it in
the existing suites and package scripts.

## Primitives

- `reserveLoopbackPort()` asks the OS for a unique port and holds it until the
  suite is ready to bind its server.
- `createTestNamespace()` creates PostgreSQL database/schema, object-storage
  bucket, and temporary-directory names scoped by run, suite, and worker.
- `gateInfrastructure()` fails on missing infrastructure by default. Optional
  developer-only suites must explicitly select `onMissing: "skip"` and provide
  a visible skip reason. The gate never selects a fallback adapter.
- `stderrFixtureCommand()` and `moduleDirectory()` remove POSIX-shell and raw
  `file:` URL assumptions from Windows test paths.
- `wave0-test-taxonomy.json` assigns every current test file to exactly one
  release suite and declares its infrastructure/isolation contract.
- `wave0-test-inventory.json` records the reproduced baseline and every
  currently reviewed fixed port, skip, fallback, shared fixture, or shell
  hazard.

## Validation

Run the focused harness regression tests:

```powershell
bun test tests/harness/harness.test.ts
```

Run the taxonomy and hazard audit:

```powershell
bun tests/harness/audit.ts
```

The audit fails if a test is unclassified or multiply classified, or if a
hazard appears/disappears without updating the reviewed inventory.

## Adoption pattern

For each server-backed suite:

1. Gate its declared infrastructure before constructing the app.
2. Create one namespace from `SINOPEBASE_TEST_RUN_ID`, suite ID, and worker ID.
3. Reserve a loopback port, release it immediately before `app.start()`, and
   build all HTTP/WebSocket clients from the reservation origin.
4. Pass validated credentials and adapter URLs explicitly; do not rely on
   `.env`, `POSTGRES_URL`, or local/memory fallbacks.
5. Use the namespace for database/schema, bucket, and fixture-directory names.
6. Stop the app before releasing external resources during teardown.
