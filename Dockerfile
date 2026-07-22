# Stage 1: build the Sinopebase binary
FROM oven/bun:1.3-alpine AS builder

WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Compile the server entry point to a standalone binary.
# Bun --compile embeds the runtime — no Bun install needed at runtime.
RUN bun build cmd/serve.ts --compile --outfile sinopebase --target bun

# Stage 2: minimal runtime image
FROM alpine:3.21

WORKDIR /app

# Copy the standalone binary
COPY --from=builder /build/sinopebase /app/sinopebase

# Copy runtime assets the binary needs
COPY --from=builder /build/ui/dist /app/ui/dist

EXPOSE 8090

CMD ["/app/sinopebase"]
