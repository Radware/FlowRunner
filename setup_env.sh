#!/usr/bin/env bash
set -e

# Ensure npm is available
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found. Please install Node.js and npm." >&2
  exit 1
fi

# Warn if Node.js version is below 18
node_ver=$(node -v | sed 's/^v//')
node_major=${node_ver%%.*}
if [ "$node_major" -lt 18 ]; then
  echo "Warning: Node.js 18 or higher is recommended. Current version: v$node_ver" >&2
fi

# Install Node dependencies
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# Install Playwright browsers
npx playwright install --with-deps

# Start a virtual display if none is available (for Electron)
if [ -z "$DISPLAY" ] && command -v Xvfb >/dev/null 2>&1; then
    Xvfb :99 -screen 0 1280x720x24 >/tmp/xvfb.log 2>&1 &
    export DISPLAY=:99
fi

echo "Environment setup complete."
