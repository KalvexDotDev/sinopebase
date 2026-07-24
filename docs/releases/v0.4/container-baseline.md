# v0.4 Container Baseline

Date: 2026-07-22  
Scope: Wave 0-D clean container baseline

## Delivered baseline

`Dockerfile` now creates the admin UI and server executable from a clean
context. Both `bun install` operations use their respective committed lockfiles
with `--frozen-lockfile`; host `node_modules`, `ui/node_modules`, `dist`, and
`ui/dist` are excluded by `.dockerignore`.

The runtime is a small pinned Alpine image containing the compiled executable,
`ui/dist`, and the exact `libgcc`/`libstdc++` runtime files copied from the
digest-pinned builder. It runs as UID/GID `10001`, exposes `/data` as the
sole application-write mount (`DATA_DIR=/data`), and includes an HTTP health
check at `/api/health`. It has no `USER root` runtime step, package manager
installation, or Linux capabilities requirement. OCI metadata labels identify
the product, source, license, and build-supplied version/revision/creation time.

## Base-image evidence

The following immutable multi-architecture index digests were read from the
publisher/official Docker Hub image metadata on 2026-07-22:

| Purpose | Immutable reference | Evidence |
| --- | --- | --- |
| Builder | `oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0` | Docker Hub `oven/bun:1.3.14-alpine` index digest |
| Runtime | `alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce` | Docker Official Image `alpine:3.22` index digest |

The Bun builder image is Alpine 3.22-based. The executable is compiled in that
musl environment and is intentionally run on pinned Alpine 3.22, avoiding a
glibc-versus-musl runtime mismatch. A build must still inspect the resulting
binary on every supported target platform before release.

## Runtime contract

Run production-shaped containers with a read-only root filesystem, a writable
`/data` volume, a temporary filesystem, no ambient capabilities, and no-new-
privileges:

```sh
docker run --rm --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount type=volume,src=sinopebase-data,dst=/data \
  -p 8090:8090 \
  -e POSTGRES_URL='…' \
  -e JWT_SECRET='…' \
  sinopebase:v0.4-baseline
```

Do not use build arguments for credentials. `.dockerignore` excludes dotenv
files, common key/certificate files, `secrets/`, local data, VCS metadata, and
agent state; supply production secrets through the platform’s secret manager.

## Verification commands

```sh
docker build --pull --no-cache -t sinopebase:v0.4-baseline .
docker image inspect sinopebase:v0.4-baseline
docker run --rm --entrypoint /app/sinopebase sinopebase:v0.4-baseline --help
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount type=volume,src=sinopebase-data,dst=/data \
  -p 8090:8090 sinopebase:v0.4-baseline
```

Then query `http://127.0.0.1:8090/api/health` from the host and inspect the
container health status. Release CI must repeat this for every target platform,
scan the final image, generate an SBOM, and sign the produced image digest.

## Known gap: backup executables

`pg_dump` and `pg_restore` are intentionally absent from this minimal runtime.
`src/plugins/backup/pg-backup-manager.ts` invokes those programs directly, so
the in-process backup/restore endpoints cannot work in this image when that
plugin is enabled. v0.4 must provide a separately pinned and least-privileged
backup/restore job (or remove this runtime dependency) and prove restore
capability; this image must not be treated as that recovery solution.

## Verification status

The first approved clean build pulled the pinned bases and exposed a Bun CLI
invocation defect: `bun --cwd ui run build` printed help, returned success, and
did not create `ui/dist`, so the final copy stage failed. The Dockerfile now
uses `cd ui && bun run build`. The corrected build succeeded, then runtime
execution proved the compiled binary dynamically requires `libgcc_s.so.1` and
`libstdc++.so.6`; those exact files are now copied from the pinned builder.
A final from-scratch rebuild succeeded. The resulting local image is
`sha256:9b26ed89740592318a14f86c354b466082e2c496dc019d63d82db7cdee88e974`
(41,911,359 bytes). The binary printed CLI help under a read-only root,
`--cap-drop ALL`, no-new-privileges, and UID/GID `10001`. A service container
under the same restrictions returned HTTP 200 from `/api/health`; inspection
confirmed `ReadonlyRootfs=true`, `CapDrop=["ALL"]`, and user `10001:10001`.

The health payload reported `db=memory` and `storage=local`, which is expected
from the current development boot path and remains a Wave 1 fail-closed
production blocker. The UI build also emitted three pre-existing Svelte label
accessibility warnings. Verification containers were stopped but retained
because this engagement does not authorize deletion.
