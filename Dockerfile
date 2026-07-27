# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

# Pin the builder to the Docker Hub index digest for oven/bun:1.3.14-alpine.
# The Alpine builder emits a musl-linked Bun executable; the runtime below uses
# the same Alpine 3.22 musl family.
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS builder

WORKDIR /build

# Install server and admin dependencies from their committed Bun lockfiles
# before copying source, so dependency layers can be cached independently.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY ui/package.json ui/bun.lock ./ui/
RUN cd ui && bun install --frozen-lockfile

COPY . .

# Never consume a host-built UI artifact: create ui/dist in this builder.
RUN cd ui && bun run build

# Build a self-contained executable for the builder platform. It carries the
# Bun runtime and therefore needs no Bun installation in the final image.
# --minify reduces binary size and attack surface; --sourcemap=external keeps
# debugging symbols out of the binary while preserving them for crash forensics.
RUN bun build cmd/serve.ts --compile --minify --sourcemap=external --outfile /out/sinopebase --target bun

# Pin the Docker Official Image index digest for alpine:3.22. Alpine is kept
# deliberately small; no shell packages, package manager cache, or DB clients
# are copied into the production image.
FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce AS runtime

ARG VERSION=0.2.1
ARG REVISION=unknown
ARG CREATED=unknown

LABEL org.opencontainers.image.title="Sinopebase" \
      org.opencontainers.image.description="Sinopebase Bun backend" \
      org.opencontainers.image.source="https://github.com/sinopebase/sinopebase" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.base.name="alpine:3.22" \
      org.opencontainers.image.base.digest="sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce" \
      com.shell.cmd="/app/sinopebase" \
      com.shell.expose="8090"

WORKDIR /app

# A fixed, unprivileged identity works with ECS/Fargate and read-only root
# filesystems. DATA_DIR is the sole application write location and must be a
# writable mount in production.
RUN addgroup -S -g 10001 sinopebase \
 && adduser -S -D -H -u 10001 -G sinopebase sinopebase \
 && mkdir /data \
 && chown sinopebase:sinopebase /data

COPY --from=builder --chown=sinopebase:sinopebase /out/sinopebase /app/sinopebase
COPY --from=builder --chown=sinopebase:sinopebase /build/ui/dist /app/ui/dist

# Bun's compiled executable is self-contained at the JavaScript layer but is
# dynamically linked to the GCC/C++ runtimes. Copy the exact libraries from
# the digest-pinned Alpine builder instead of resolving floating APK packages.
COPY --from=builder /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
COPY --from=builder /usr/lib/libstdc++.so.6.0.33 /usr/lib/libstdc++.so.6.0.33
COPY --from=builder /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6

ENV DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8090

# BusyBox wget is provided by Alpine without adding a package. This checks the
# process HTTP path only; database readiness is a future application gate.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8090/api/health || exit 1

USER 10001:10001

CMD ["/app/sinopebase"]
