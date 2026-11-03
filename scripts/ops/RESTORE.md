# Backups and restores (production server)

The scripts in this folder back up the database **and** the uploaded files together (`SECURITY_AND_PRIVACY.md` §9). They never delete anything.

## Nightly backup
`backup.sh` reads `DATABASE_URL`, `FILE_STORAGE_DIR`, `BACKUP_DIR` and, optionally, `BACKUP_REMOTE`. It writes `BACKUP_DIR/<UTC timestamp>/` containing:
- `database.dump`: `pg_dump` custom format;
- `storage.tar.gz`: the `FILE_STORAGE_DIR` folder;
- `SHA256SUMS`.

With `BACKUP_REMOTE` set (an rsync destination), the folder is also copied off the server.

**Schedule it** with the systemd timer or cron entry described in the runbook, as the app user, after the env file is loaded.

**Retention:** keep 7 daily, 4 weekly and 3 monthly copies using the off-server destination's lifecycle rules. The script does not prune.

**Passwords:** they never appear on a command line. `pg-env.mjs` turns the URL into libpq environment variables.

## Restore check (before handover, then monthly)

```bash
scripts/ops/restore-check.sh "$BACKUP_DIR/<timestamp>"
```

1. Verifies the checksums.
2. Restores the dump into a **scratch** database.
3. Prints row counts for the live and restored databases. The restored copy must never have more rows than live.
4. Checks that every stored file listed in the restored `files` table is in the archive.
5. Removes the scratch copy.

The live database is only read.

**Choosing the scratch database:**
- **Default:** a temporary database `crm_restore_check_<time>` is created and dropped. This needs `CREATEDB`.
- **Without `CREATEDB`:** set `RESTORE_CHECK_DATABASE` to an existing, **disposable** database. It is overwritten, and the script refuses if it is the live database.

## Real restore (after data loss), in an agreed maintenance window
1. Stop the app (`systemctl stop mz-crm`).
2. Restore the database:
   ```bash
   pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d <db> database.dump
   ```
3. Move the current storage folder aside and extract `storage.tar.gz` in its place.
4. Run `npm run db:migrate`. It only applies migrations newer than the backup.
5. Start the app, sign in, and check recent leads and one recording.

Entries deleted after the backup was taken are not recovered. Data entered after the backup is lost unless it is re-entered.

## Verified (3 Nov 2026, local machine; production not used)
- **Backup:** `backup.sh` of the development database (read only) produced the dump, the archive and valid checksums.
- **Restore check:** `restore-check.sh` with `RESTORE_CHECK_DATABASE` set to the **test** database (disposable, reset by every test run) restored the dump and reported **OK**:
  - users 11 / 11; leads 5 / 5; bookings 3 / 3; payments 6 / 6; files 0 / 0; audit 99 / 99;
  - no stored files missing.
- **Guard:** naming the live database as the scratch target is refused.
- **Earlier failure:** the default mode stopped with "permission denied to create database" because the local role has no `CREATEDB`. The production role either needs it, or the server uses a dedicated scratch database.
