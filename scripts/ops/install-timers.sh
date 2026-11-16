#!/usr/bin/env sh
# Installs and starts every scheduled job of the CRM on a systemd server, in one go (run as root):
#   sh scripts/ops/install-timers.sh
#   - nightly backup            mz-crm-backup.timer          02:00
#   - unit-hold release         mz-crm-release-holds.timer   every hour
#   - sign-in history clean-up  mz-crm-prune-signins.timer   03:15
# The units assume the app in /srv/mz-crm run by user "mzcrm" with its settings in /srv/mz-crm/.env;
# edit the .service files first if yours differ. Safe to run again after an update.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
units="$here/systemd"
[ "$(id -u)" -eq 0 ] || { echo "install-timers: run as root" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "install-timers: systemd not found; schedule the jobs with cron instead (docs/DEPLOYMENT_PROXY.md §7)" >&2; exit 1; }
cp "$units"/mz-crm-*.service "$units"/mz-crm-*.timer /etc/systemd/system/
systemctl daemon-reload
for t in mz-crm-backup.timer mz-crm-release-holds.timer mz-crm-prune-signins.timer; do
  systemctl enable --now "$t"
done
systemctl list-timers 'mz-crm-*'
echo "Scheduled. First checks: journalctl -u mz-crm-release-holds.service ; Settings → Security shows the last clean-up run."
