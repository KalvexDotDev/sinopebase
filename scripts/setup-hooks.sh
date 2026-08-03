#!/bin/bash
# Install git hooks for local development.
# Run once after cloning: bash scripts/setup-hooks.sh

set -euo pipefail

HOOKS_DIR="$(cd "$(dirname "$0")/.." && pwd)/.git/hooks"

# pre-push: runs full CI before every push
cat > "$HOOKS_DIR/pre-push" << 'EOF'
#!/bin/bash
set -euo pipefail

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  pre-push: bun run ci"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

bun run ci
EOF

chmod +x "$HOOKS_DIR/pre-push"
echo "[setup-hooks] pre-push hook installed — bun run ci will run before every push"
