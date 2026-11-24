// Records follow-ups still pending at the end of their due day as missed (client, 24 Nov 2026).
// Usage: npm run job:mark-missed-follow-ups. Run once a day soon after midnight, Pakistan time (systemd timer or cron).
// The rule lives in src/modules/leads/missed-follow-ups.ts; this only loads it, like release-holds.mjs. Safe to repeat.
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
    console.error(JSON.stringify({ job: "mark-missed-follow-ups", status: "error", reason: "DATABASE_URL is not set" }));
    process.exit(1);
  }
  const [{ default: pg }, { drizzle }, schema, { markMissedFollowUps }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("@/server/db/schema"),
    import("@/modules/leads/missed-follow-ups"),
  ]);
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const result = await markMissedFollowUps(drizzle(pool, { schema }));
    console.log(JSON.stringify({ job: "mark-missed-follow-ups", status: "ok", at: new Date().toISOString(), ...result }));
  } catch (error) {
    console.error(JSON.stringify({ job: "mark-missed-follow-ups", status: "error", reason: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
