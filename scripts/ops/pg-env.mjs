// Prints shell `export` lines for libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE) from a
// postgres:// URL, so backup scripts never put the password on a command line (visible in `ps`).
// Usage: eval "$(node scripts/ops/pg-env.mjs "$DATABASE_URL")"
const raw = process.argv[2];
if (!raw) {
  console.error("pg-env: pass a postgres:// URL");
  process.exit(1);
}
const u = new URL(raw);
const quote = (v) => `'${String(v).replace(/'/g, `'\''`)}'`;
const vars = {
  PGHOST: decodeURIComponent(u.hostname || "localhost"),
  PGPORT: u.port || "5432",
  PGUSER: decodeURIComponent(u.username),
  PGPASSWORD: decodeURIComponent(u.password),
  PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
};
const ssl = u.searchParams.get("sslmode");
if (ssl) vars.PGSSLMODE = ssl;
for (const [k, v] of Object.entries(vars)) if (v) console.log(`export ${k}=${quote(v)}`);
