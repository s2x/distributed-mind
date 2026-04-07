#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="mind-curl-test"

echo "=== Building Docker image: $IMAGE_NAME ==="
docker build -f "$REPO_ROOT/Dockerfile.test-curl-installer" -t "$IMAGE_NAME" "$REPO_ROOT"

echo
echo "=== Verifying mind --version equivalent (update --check) ==="
docker run --rm "$IMAGE_NAME" mind update --check

echo
echo "=== Verifying mind --help equivalent ==="
docker run --rm "$IMAGE_NAME" mind help | head -20

echo
echo "✅ Docker image verified successfully!"
