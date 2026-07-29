#!/usr/bin/env bash
# Generate a self-signed TLS certificate for local development.
# Usage: bash scripts/gen-dev-cert.sh
# Output: dev-certs/cert.pem, dev-certs/key.pem
set -euo pipefail

OUTDIR="${1:-dev-certs}"
mkdir -p "$OUTDIR"

echo "Generating self-signed certificate for localhost..."
openssl req -x509 -newkey rsa:4096 \
  -keyout "$OUTDIR/key.pem" \
  -out "$OUTDIR/cert.pem" \
  -days 365 \
  -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Done."
echo "  Certificate: $OUTDIR/cert.pem"
echo "  Private key: $OUTDIR/key.pem"
echo ""
echo "Start the server with TLS:"
echo "  bun run cmd/serve.ts --tls-cert $OUTDIR/cert.pem --tls-key $OUTDIR/key.pem"
