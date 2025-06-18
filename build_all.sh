#!/usr/bin/env bash
set -e

# Optional: path to Zscaler root CA certificate
# Pass the certificate path as the ZSCALER_CA env variable
if [ -n "$ZSCALER_CA" ]; then
    export NODE_EXTRA_CA_CERTS="$ZSCALER_CA"
fi

# Ensure dependencies are installed
npm ci

# Run tests before building
npm test
npm run e2e

# Build macOS (arm64)
echo "Building macOS package..."
NODE_OPTIONS= npx electron-forge make --platform=darwin --arch=arm64

# Build Windows (x64)
echo "Building Windows package..."
NODE_OPTIONS= npx electron-forge make --platform=win32 --arch=x64

