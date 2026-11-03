#!/usr/bin/env bash
# Nightly backup of the CRM (VERSION_1_EXECUTION_PLAN.md §4 P2; SECURITY_AND_PRIVACY.md §9).
# Backs up the database AND the uploaded files together, with one timestamp and a checksum list.
#
# Environment (from the production env file):
#   DATABASE_URL      production database
#   FILE_STORAGE_DIR  uploaded recordings and documents
#   BACKUP_DIR        local folder for backups (outside the app folder)
#   BACKUP_REMOTE     optional rsync destination for the off-server copy (e.g. user@host:/backups/crm)
#
# Nothing is ever deleted by this script. Keep 7 daily / 4 weekly / 3 monthly copies with the
# destination's own lifecycle rules (see scripts/ops/RESTORE.md).
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${FILE_STORAGE_DIR:?FILE_STORAGE_DIR is not set}"
: "${BACKUP_DIR:?BACKUP_DIR is not set}"
[ -d "$FILE_STORAGE_DIR" ] || { echo "backup: FILE_STORAGE_DIR $FILE_STORAGE_DIR does not exist" >&2; exit 1; }

umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/$stamp"
mkdir -p "$out"

eval "$(node scripts/ops/pg-env.mjs "$DATABASE_URL")"
pg_dump --format=custom --no-owner --no-privileges --file "$out/database.dump"
tar -C "$(dirname "$FILE_STORAGE_DIR")" -czf "$out/storage.tar.gz" "$(basename "$FILE_STORAGE_DIR")"
( cd "$out" && sha256sum database.dump storage.tar.gz > SHA256SUMS )
echo "backup: wrote $out"

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a "$out" "$BACKUP_REMOTE/"
  echo "backup: copied to $BACKUP_REMOTE/$stamp"
fi
