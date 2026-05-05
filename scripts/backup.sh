#!/bin/bash
# Backup libsql-server data directory
# Runs inside the backup container

set -euo pipefail

BACKUP_DIR="/data/backups"
SOURCE_DIR="/data/libsql-primary"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/libsql-backup-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"
tar czf "$BACKUP_FILE" -C "$SOURCE_DIR" .
echo "Backup created: $BACKUP_FILE"

# Keep 7 most recent backups
ls -t "$BACKUP_DIR"/libsql-backup-*.tar.gz | tail -n +8 | xargs -r rm

# Optional S3 sync
if [ -n "${DIMIND_BACKUP_S3_BUCKET:-}" ]; then
  aws s3 cp "$BACKUP_FILE" "s3://$DIMIND_BACKUP_S3_BUCKET/$(basename $BACKUP_FILE)"
  echo "Uploaded to S3: $DIMIND_BACKUP_S3_BUCKET"
fi
