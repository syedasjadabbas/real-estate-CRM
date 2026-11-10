# Backups and restores (production server)

The scripts in this folder back up the database **and** the uploaded files together (`SECURITY_AND_PRIVACY.md` §9). `backup.sh`, `restore-check.sh` and `restore.mjs` never delete a backup; only the retention step of `backup-run.mjs` removes old backup folders (see "Retention").

| Script | What it does |
|---|---|
| `backup-run.mjs` | Scheduled entry point: records the run, calls `backup.sh`, verifies checksums, applies retention, prints one `backup: OK` / `backup: FAILED` line |
| `backup.sh` | Database dump + storage archive + `SHA256SUMS`, optional off-server copy |
| `restore-check.sh` | Restores a backup into a **scratch** database and compares it with live (read only) |
| `restore.mjs` | Real restore, with Super Admin approval and safety checks; `--dry-run` checks only |
| `systemd/` | `mz-crm-backup.service`, `mz-crm-backup.timer`, `mz-crm-backup-failed.service` |

## Nightly backup
`backup.sh` reads `DATABASE_URL`, `FILE_STORAGE_DIR`, `BACKUP_DIR` and, optionally, `BACKUP_REMOTE`. It writes `BACKUP_DIR/<UTC timestamp>/` containing:
- `database.dump`: `pg_dump` custom format;
- `storage.tar.gz`: the `FILE_STORAGE_DIR` folder;
- `SHA256SUMS`.

With `BACKUP_REMOTE` set (an rsync destination), the folder is also copied off the server.

**Passwords:** they never appear on a command line. `pg-env.mjs` turns the URL into libpq environment variables.

## Scheduled backups (`backup-run.mjs` + systemd timer)
```bash
node scripts/ops/backup-run.mjs --trigger manual     # one backup now, then retention
node scripts/ops/backup-run.mjs --no-prune           # backup only
```
Each run:
1. Adds a `backup_runs` row (kind `backup`, status `running`).
2. Runs `backup.sh`, then checks that the folder has all three files and that `SHA256SUMS` matches.
3. Marks the run `succeeded` (with the folder name and size) or `failed` (with the reason). The row holds the folder **name** only: no paths, URLs, contents or credentials.
4. **Only after a successful backup**, applies retention and records a `prune` run.
5. Writes an audit entry for every run (`backup.backup.succeeded`, `backup.prune.failed`, …; no user, no IP).
6. Prints one line, `backup: OK – …` or `backup: FAILED – …`, and exits non-zero on any failure.

Backup, retention and restore share one database advisory lock, so they never overlap; a second run is recorded as failed ("another run is in progress"). A run left `running` by a killed process is marked failed ("Interrupted") by the next run.

**Install the schedule** (as root, once; nothing is installed automatically):
```bash
cp scripts/ops/systemd/mz-crm-backup*.service scripts/ops/systemd/mz-crm-backup.timer /etc/systemd/system/
# adjust User=, Group=, WorkingDirectory= and EnvironmentFile= if the app is not at /srv/mz-crm
systemctl daemon-reload && systemctl enable --now mz-crm-backup.timer
systemctl list-timers mz-crm-backup.timer        # next run: 02:00 server time
systemctl start mz-crm-backup.service            # first backup now
journalctl -u mz-crm-backup.service -n 20        # look for "backup: OK"
```
- The env file (plain `KEY=value` lines) must contain `DATABASE_URL`, `FILE_STORAGE_DIR`, `BACKUP_DIR` and, optionally, `BACKUP_REMOTE`, `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_MONTHLY`. The app reads the same file, so Settings → Backups shows the same retention.
- `BACKUP_DIR` must be an absolute path outside the app folder and outside `FILE_STORAGE_DIR`, owned by the app user (mode `700`). The unit uses `ProtectHome=true`, so do not put it under `/home`.
- A failed run triggers `mz-crm-backup-failed.service`, which writes a high-priority journal entry. Replace its command with the alert agreed for H-12 (for example, an email).
- `pg_dump` must be the same major version as the server (PostgreSQL 18) or newer.

**Settings → Backups** (Super Admins only) lists the last 50 runs, the age of the last successful backup and the retention. It shows a warning when there is no successful backup or the last one is more than **26 hours** old. It has no download and no restore button, by design.

## Retention
The client requires **30 daily and 12 monthly** copies. Days and months are counted in Pakistan time.
- `BACKUP_KEEP_DAILY` (default **30**): keeps the newest complete backup from each of the last 30 days, today included.
- `BACKUP_KEEP_MONTHLY` (default **12**; `0` = none): also keeps the newest complete backup from each of the last 12 calendar months, this month included.
- Everything else is removed: extra copies from the same day, and incomplete folders once they are older than the daily window. The newest complete backup is **always** kept, however old.
- The old `BACKUP_RETENTION_DAYS` and `BACKUP_RETENTION_COUNT` are refused with a message naming the replacements, so an old env file can't silently change the rule.
- Only folders **directly** inside `BACKUP_DIR` whose name is exactly a backup timestamp (`20261110T020000Z`) are considered. Symbolic links, other files and folders, and folders dated in the future are never touched.
- Retention runs only after a successful backup, so a broken backup job never wears away the good backups.
- An invalid retention value stops the backup before it starts, with the reason in the run record.
- **Retention applies to `BACKUP_DIR` only.** `backup.sh` copies each new folder to `BACKUP_REMOTE` with `rsync -a` and never deletes there, so the off-server destination needs its own lifecycle rule for the same 30 daily and 12 monthly copies (for example a bucket lifecycle policy or a pruning job on the backup host). Until that exists the remote copy only grows.

## Restore check (before handover, then at least every quarter)

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

To record a restore check on the Backups page, run it through the runner (same script, same scratch rules):
```bash
node scripts/ops/backup-run.mjs --restore-check 20261110T020000Z
```

## Real restore (after data loss), in an agreed maintenance window
Restores are **never** started from the app. They need a Super Admin, on the server:

1. Agree the window and the backup folder to use. Stop the app: `systemctl stop mz-crm`. Stop the timer too: `systemctl stop mz-crm-backup.timer`.
2. Load the production env file, then run a **dry run** first:
   ```bash
   set -a && . ./.env && set +a
   NODE_ENV=production node scripts/ops/restore.mjs --backup 20261110T020000Z \
     --confirm-database <database name> --approved-by <super admin email> --dry-run
   ```
3. If every check is `ok`, run the same command without `--dry-run`.
4. Start the app and the timer again: `systemctl start mz-crm mz-crm-backup.timer`. Sign in, then check recent leads and one recording.

**Super Admin protection:** `--approved-by` must be an **active** Super Admin. That person types their CRM password at a hidden prompt; it is checked against the app's argon2 hash and is never shown, logged or stored. A wrong password, an inactive account or another role refuses the restore, and the refusal is recorded.

**Safety checks (all run before anything is changed; every failure is listed):**
1. `NODE_ENV=production`, and `--confirm-database` matches the database in `DATABASE_URL`.
2. The backup is a timestamped folder directly inside `BACKUP_DIR` (a name, not a path), all three files are present and `SHA256SUMS` verifies.
3. `pg_restore`, `psql`, `pg_dump`, `tar` and `bash` are available.
4. The dump can be read, and its migrations are **not newer** than this code (`drizzle/meta/_journal.json`). If they are, deploy the matching code first.
5. The storage archive has one top-level folder and no unsafe paths.
6. Next to `FILE_STORAGE_DIR` is writable.
7. **No other session** is connected to the database (the app is stopped).
8. (Real restore only) A **fresh pre-restore backup** of the current database and files succeeds. It is a normal backup folder (trigger `pre-restore`) and is the way back if the restore was a mistake.

**What a real restore does after the checks:**
- Extracts the archive into a staging folder next to `FILE_STORAGE_DIR`.
- Replaces the database in **one transaction**: it drops the `public` and `drizzle` schemas and applies the dump. `COMMIT` is sent only after the whole dump has been read without error. Any error rolls everything back, and the database and files are unchanged.
- Applies migrations newer than the backup.
- Renames the current storage folder to `<name>.before-restore-<time>` (kept, not deleted). The restored folder then takes its place.
- Writes the run records into the restored database. The restore replaces the `backup_runs` and `audit_logs` tables with the backup's copies, so the records of this restore and its pre-restore backup are written again. Then it prints row counts and the number of stored files that are missing.

Every attempt is recorded as a `restore` run and in the audit log (`backup.restore.succeeded` / `failed`): refused, dry run, failed or succeeded. Dry runs have the trigger `dry-run`.

**Notes:**
- If `FILE_STORAGE_DIR` itself was lost, create it empty first (`mkdir`). Otherwise the pre-restore backup cannot archive it.
- The database role must be able to drop and create the `public` schema (owner of the database).
- After a restore, delete the `…before-restore-…` folder only when everyone agrees that the restore is good.

Entries deleted after the backup was taken are not recovered. Data entered after the backup is lost unless it is re-entered.

## Verified (3 Nov 2026, local machine; production not used)
- **Backup:** `backup.sh` of the development database (read only) produced the dump, the archive and valid checksums.
- **Restore check:** `restore-check.sh` with `RESTORE_CHECK_DATABASE` set to the **test** database (disposable, reset by every test run) restored the dump and reported **OK**:
  - users 11 / 11; leads 5 / 5; bookings 3 / 3; payments 6 / 6; files 0 / 0; audit 99 / 99;
  - no stored files missing.
- **Guard:** naming the live database as the scratch target is refused.
- **Earlier failure:** the default mode stopped with "permission denied to create database" because the local role has no `CREATEDB`. The production role either needs it, or the server uses a dedicated scratch database.
