// FR-081 unit-hold release (client confirmation, 10 Nov 2026: "expires after 7 days, unit returns to Available").
// Usage: npm run job:release-holds              (cancels expired, unpaid holds and frees their units)
//        npm run job:release-holds -- --dry-run  (changes nothing; lists what would be released)
//
// Run every hour by the host (systemd timer, cron or a Compose one-shot; see docs/DEPLOYMENT_PROXY.md §7b).
// The rule and the writes live in src/modules/bookings/hold-release.ts, which the app's tests cover;
// this script only loads that TypeScript module with Node's built-in type stripping (Node 22.18+ / 24)
// and a small resolver for the app's "@/..." imports, so no build step or extra package is needed.
// Each booking is released in its own transaction (booking row locked first, rule re-checked under the
// lock), so repeated or overlapping runs are safe. Prints one JSON line; exits non-zero on errors.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");

function resolveTs(base) {
  for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep) && path.extname(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // `server-only` guards React Server Components; this is a plain Node process.
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", format: "module", shortCircuit: true };
    let file = null;
    if (specifier.startsWith("@/")) file = resolveTs(path.join(SRC, specifier.slice(2)));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts")) {
      file = resolveTs(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    }
    if (file) return { url: pathToFileURL(file).href, format: file.endsWith(".ts") ? "module-typescript" : undefined, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

async function main() {
  try {
    process.loadEnvFile(path.join(ROOT, ".env.local"));
  } catch {
    // rely on the shell environment (production)
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(JSON.stringify({ job: "release-holds", status: "error", reason: "DATABASE_URL is not set" }));
    process.exit(1);
  }
  const [{ default: pg }, { drizzle }, schema, { releaseExpiredHolds }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("@/server/db/schema"),
    import("@/modules/bookings/hold-release"),
  ]);
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const result = await releaseExpiredHolds(drizzle(pool, { schema }), { dryRun: process.argv.includes("--dry-run") });
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
    if (result.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ job: "release-holds", status: "error", reason: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
