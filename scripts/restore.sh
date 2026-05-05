#!/bin/bash
# Restore libsql-server from a backup
# Usage: ./scripts/restore.sh <backup-file.tar.gz>
# Run on the host, not inside Docker

set -euo pipefail

BACKUP_FILE="${1:?Usage: $0 <backup-file.tar.gz>}"
TARGET_DIR="./data/libsql-primary"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "WARNING: This will replace data in $TARGET_DIR"
echo "Press Ctrl+C to cancel, or Enter to continue..."
read

# Stop primary if running
docker compose -f docker-compose.libsql.yml stop libsql-primary 2>/dev/null || true

# Restore
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
tar xzf "$BACKUP_FILE" -C "$TARGET_DIR"
echo "Restored from: $BACKUP_FILE"

# Restart
docker compose -f docker-compose.libsql.yml start libsql-primary 2>/dev/null || true
echo "Done. Replicas will re-sync on next dimind sync."
