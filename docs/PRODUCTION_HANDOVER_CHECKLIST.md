# Production handover checklist

Prepared 3 Nov 2026 for deploying the MZ MARKETING CRM on the client's own server and handing it over. Work through it in order; each line is ticked by the person named, with the date.

Related documents:
- `VERSION_1_EXECUTION_PLAN.md` (scope and schedule);
- `DEPLOYMENT_PROXY.md` (Caddy, proxy, headers, storage);
- `SECURITY_AND_PRIVACY.md` §9 and §11 (backups and the security checklist).

The runbook (P3), setup script (P1) and backup scripts (P2) referred to here are **planned and not yet written**. They will be delivered with Version 1.

**Rules for the whole process:**
- Never copy development or test records, fixtures or fictional data into production.
- Never run `npm run db:seed` on the server.
- Never print or share passwords or secrets in chat, tickets or documents.
- The development database is left untouched.

---

## 0. Client-provided prerequisites

| ✓ | Item | Ref |
|---|---|---|
| ☐ | Server provisioned and paid by the client (≥ 2 vCPU, 4 GB RAM, 60 GB SSD, Ubuntu 24.04 LTS) | H-1 |
| ☐ | SSH access for Zeploy Tech (key-based user with sudo), or a client technician available | H-2 |
| ☐ | Domain and DNS access; hostname agreed (e.g. `crm.<domain>`) | H-3 |
| ☐ | Database choice confirmed (local PostgreSQL by default) | H-4 |
| ☐ | Off-server backup destination and credentials | H-5 |
| ☐ | First Super Admin's name and email; that person is available for the setup | H-6 |
| ☐ | Initial user list (name, email, role, team) | H-7 |
| ☐ | Confirmed lookup lists: sources, cities, budget ranges, lost reasons | H-8 |
| ☐ | Who enters projects and units (no import in Version 1) | H-9 |
| ☐ | Company name, address and logo for printed proposals | H-10 |
| ☐ | CDN or load balancer in front? (Expected: none) | H-11 |
| ☐ | Who maintains server updates and backups after handover | H-12 |
| ☐ | Signed questionnaire (needed for E4 / E5 and any log deletion) | S-1 |

## 1. Server and network
| ✓ | Check |
|---|---|
| ☐ | OS updated; automatic security updates enabled; timezone UTC (the app shows Asia/Karachi itself) |
| ☐ | Dedicated app user; the app folder is owned by that user |
| ☐ | Firewall allows **22, 80, 443 only**; the app port (3000) is reachable from localhost only |
| ☐ | SSH: key-only, root login disabled |
| ☐ | Node.js 24, PostgreSQL, Caddy 2.5+ installed from official packages |

## 2. Domain and TLS
| ✓ | Check |
|---|---|
| ☐ | DNS A record points to the server, and resolves publicly |
| ☐ | Caddyfile per `DEPLOYMENT_PROXY.md` §3; **no** duplicate security headers in Caddy (§11) |
| ☐ | HTTPS certificate issued automatically; HTTP redirects to HTTPS |

## 3. Application and environment
| ✓ | Check |
|---|---|
| ☐ | Code checked out at the agreed release commit (private repository) |
| ☐ | `npm ci` then `npm run build`, with no errors or warnings |
| ☐ | Production env file is owned by the app user with mode `600`, and contains:<br>- `NODE_ENV=production`;<br>- `DATABASE_URL` (production only);<br>- `TRUST_PROXY=true`, `TRUSTED_PROXY_COUNT=1`;<br>- `FILE_STORAGE_DIR` (persistent);<br>- `PROXY_SHARED_SECRET`, if used. |
| ☐ | **No** `TEST_DATABASE_URL` and no development values on the server |
| ☐ | Secrets generated fresh for production; none reused from development |
| ☐ | systemd service with graceful stop (`TimeoutStopSec=30`); starts on boot; restarts on failure |

## 4. Database
| ✓ | Check |
|---|---|
| ☐ | Dedicated PostgreSQL database and role for the CRM; strong password; not reachable from the internet |
| ☐ | Database starts **empty**; schema created only by `npm run db:migrate` |
| ☐ | `drizzle-kit check` reports no drift; all 13 migrations applied |
| ☐ | Development and production use separate databases and credentials; the server has no development database |
| ☐ | Connectivity check: the app starts and `/login` loads |

## 5. File storage
| ✓ | Check |
|---|---|
| ☐ | `FILE_STORAGE_DIR` on a persistent disk, outside the app folder and outside `public/` |
| ☐ | Owned by the app user; mode `700`; files are created as `600` |
| ☐ | The server log shows no "FILE_STORAGE_DIR is not set" warning |
| ☐ | A recording and a document upload and play / download through HTTPS (step 8) |

## 6. Initial setup
| ✓ | Check | By |
|---|---|---|
| ☐ | P1 setup script run once with `--confirm-database <name>`: client-confirmed lookup lists inserted | Zeploy Tech |
| ☐ | First Super Admin created by P1: the client's Super Admin types their own password at the prompt; it is not printed or recorded anywhere | Client Super Admin, with Zeploy Tech |
| ☐ | Client Super Admin signs in and creates the other users through Settings → Users (E3); each user sets or receives their password privately | Client |
| ☐ | Teams created, members and managers assigned | Client, with Zeploy Tech |
| ☐ | Settings applied through the screens: manager cap 5%, down payment 25%, installments 36 (pending C-26), "Pay order" method | Client Super Admin |
| ☐ | Security settings: retention 12 months; **automatic deletion off** (it stays off until the signed approval and a dry run) | Zeploy Tech |
| ☐ | No development accounts, demo project or test data exist (check the user list and project list) | Zeploy Tech |

## 7. Scheduled jobs and backups
| ✓ | Check |
|---|---|
| ☐ | Daily `job:prune-signin-logs` scheduled. With deletion off it deletes nothing; one `--dry-run` run is reviewed |
| ☐ | Nightly backup (P2): database dump and `FILE_STORAGE_DIR` archive, copied off-server, with the 7 / 4 / 3 retention |
| ☐ | First backup completed and present at the off-server destination |
| ☐ | **Restore test:** restore into a temporary database on the server; verify row counts and that stored files are present; drop the temporary database. The live database is not touched |
| ☐ | Backup failure alert or check agreed (H-12) |

## 8. Production security checks
| ✓ | Check |
|---|---|
| ☐ | `curl -sI https://<host>/login` shows CSP, X-Frame-Options, Referrer-Policy, X-Content-Type-Options and HSTS (`DEPLOYMENT_PROXY.md` §11) |
| ☐ | Security settings shows the real public IP of the tester; a spoofed `X-Forwarded-For` sent directly is ignored |
| ☐ | App port not reachable from outside (test from another network) |
| ☐ | Same-origin check over HTTPS: notification mark-read, recording upload and document upload succeed (`DEPLOYMENT_PROXY.md` §10) |
| ☐ | Login rate limit triggers after repeated failures |
| ☐ | Signed-out access to `/dashboard` redirects to `/login`; APIs return 401 |
| ☐ | Each role sees only its permitted pages (spot-check per role with real accounts) |
| ☐ | Server, database and storage are not readable by other OS users |

## 9. Client acceptance testing

The client tests with their own accounts in production. Each line is passed or failed by the client's tester. Failures are reported through the agreed defect channel (`VERSION_1_EXECUTION_PLAN.md` §8.3).

| ✓ | Role | Test |
|---|---|---|
| ☐ | Super Admin / Admin | Create, change role, reset password, deactivate and reactivate users; inactive user cannot sign in |
| ☐ | Super Admin / Admin | Settings (proposal defaults, payment methods, Security settings) |
| ☐ | Manager | Create and assign leads; pipeline drag-and-drop; lost approvals; reviews; team dashboard filter |
| ☐ | Manager / Agent | Proposal with 25% down payment, 5% cap, only Available units; print |
| ☐ | Agent | Own leads only; follow-ups and reminders; notifications; upload a recording and a document; click-to-call |
| ☐ | Accountant | Record a payment (including Pay order); request a reversal; Admin approves; outstanding and collections reports; CSV export |
| ☐ | HR | Employees; holidays; My Workplace |
| ☐ | All | Projects, inventory, bookings, clients, meetings, tasks, teams, roster, daily reports, targets, performance, as agreed |
| ☐ | All | Use on a phone browser |

## 10. Handover
| ✓ | Item |
|---|---|
| ☐ | Administrator guide delivered (P4) |
| ☐ | Runbook delivered (P3), including the update and restore procedures |
| ☐ | Deferred features and excluded integrations listed in writing (`VERSION_1_EXECUTION_PLAN.md` §9, `EXTERNAL_INTEGRATIONS.md`) |
| ☐ | Defect log handed over; all severity 1 and 2 defects closed |
| ☐ | Zeploy Tech's temporary server access removed or kept, as the client decides |
| ☐ | Written client acceptance received (terms per `VERSION_1_EXECUTION_PLAN.md` §8.4–8.5) |
