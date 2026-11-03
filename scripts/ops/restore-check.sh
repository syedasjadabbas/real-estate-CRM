#!/usr/bin/env bash
# Verifies a backup WITHOUT touching the live database (P2): restores the dump into a scratch
# database, compares row counts with the live database, checks that every stored file is in the
# archive, then removes the scratch copy.
#
# Usage: scripts/ops/restore-check.sh <backup folder>
#   DATABASE_URL            the live database (read only: row counts)
#   RESTORE_CHECK_DATABASE  optional: an existing, disposable database to restore into. It is
#                           overwritten. Without it, a temporary database is created and dropped,
#                           which needs the CREATEDB privilege.
set -euo pipefail
cd "$(dirname "$0")/../.."

dir="${1:?pass the backup folder, e.g. \$BACKUP_DIR/20261110T020000Z}"
: "${DATABASE_URL:?DATABASE_URL is not set}"
( cd "$dir" && sha256sum --check --quiet SHA256SUMS )

eval "$(node scripts/ops/pg-env.mjs "$DATABASE_URL")"
live="$PGDATABASE"
work=""
created=""
cleanup() {
  if [ -n "$created" ]; then PGDATABASE=postgres dropdb --if-exists "$created" || true; fi
  if [ -n "$work" ]; then rm -rf "$work"; fi
}
trap cleanup EXIT

if [ -n "${RESTORE_CHECK_DATABASE:-}" ]; then
  target="$RESTORE_CHECK_DATABASE"
  [ "$target" != "$live" ] || { echo "restore-check: RESTORE_CHECK_DATABASE must not be the live database" >&2; exit 1; }
  echo "restore-check: restoring into scratch database $target (overwritten)"
  pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$target" "$dir/database.dump"
else
  target="crm_restore_check_$(date -u +%Y%m%d%H%M%S)"
  PGDATABASE=postgres createdb "$target"
  created="$target"
  pg_restore --no-owner --no-privileges --exit-on-error --dbname "$target" "$dir/database.dump"
fi

status=0
for t in users leads bookings booking_payments files audit_logs; do
  a="$(psql -XAtc "select count(*) from $t" -d "$live")"
  b="$(psql -XAtc "select count(*) from $t" -d "$target")"
  echo "restore-check: $t live=$a restored=$b"
  # The live database can grow after the backup; it must never have fewer rows than the backup.
  [ "$b" -le "$a" ] || { echo "restore-check: $t has more rows in the backup than live" >&2; status=1; }
done

work="$(mktemp -d)"
tar -C "$work" -xzf "$dir/storage.tar.gz"
root="$work/$(ls "$work" | head -n 1)"
missing=0
while IFS= read -r key; do
  [ -z "$key" ] && continue
  [ -f "$root/$key" ] || { echo "restore-check: missing file $key"; missing=$((missing + 1)); }
done < <(psql -XAtc "select storage_key from files" -d "$target")
echo "restore-check: stored files missing from the archive: $missing"
[ "$missing" -eq 0 ] || status=1
[ "$status" -eq 0 ] && echo "restore-check: OK"
exit $status
