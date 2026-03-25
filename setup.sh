#!/usr/bin/env bash
set -euo pipefail

echo "=== ArcTip Setup ==="

# Check git
if ! command -v git &> /dev/null; then
  echo "Error: git not found. Install git first."
  exit 1
fi

# Install Foundry if not present
if ! command -v forge &> /dev/null; then
  echo "Installing Foundry..."
  curl -L https://foundry.paradigm.xyz | bash
  # shellcheck disable=SC1091
  source "$HOME/.bashrc" 2>/dev/null || source "$HOME/.zshrc" 2>/dev/null || true
  foundryup
else
  echo "✓ Foundry already installed ($(forge --version))"
fi

# Install forge-std
if [ ! -d "lib/forge-std/.git" ]; then
  echo "Installing forge-std..."
  forge install foundry-rs/forge-std --no-commit
else
  echo "✓ forge-std already present"
fi

# Create .env from template
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "✓ Created .env from .env.example — add your PRIVATE_KEY before deploying"
else
  echo "✓ .env already exists"
fi

# Build
echo "Building contracts..."
forge build

# Test
echo "Running tests..."
forge test -vv

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env and add your PRIVATE_KEY"
echo "  2. Run: make deploy"
echo "  3. Copy contract addresses to .env and dashboard/index.html"
echo "  4. Load extension/  in Chrome (chrome://extensions > Load unpacked)"
