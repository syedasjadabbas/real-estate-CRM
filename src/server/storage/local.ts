import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Private file storage on the server's disk (SYSTEM_ARCHITECTURE.md: local disk now, S3-compatible
 * storage once the client's provider is chosen). Files are never under `public/`; they are only
 * served through authenticated routes that check access to the owning record.
 *
 * `FILE_STORAGE_DIR` sets the root (default `./storage`, git-ignored). Production must point it at a
 * persistent, backed-up volume (docs/DEPLOYMENT_PROXY.md §9).
 */
let warnedDefaultRoot = false;

export function storageRoot() {
  const configured = process.env.FILE_STORAGE_DIR?.trim();
  if (!configured && process.env.NODE_ENV === "production" && !warnedDefaultRoot) {
    warnedDefaultRoot = true;
    console.warn("[storage] FILE_STORAGE_DIR is not set: uploaded files are stored in ./storage inside the app folder. Use a persistent, backed-up volume (docs/DEPLOYMENT_PROXY.md §9).");
  }
  const root = path.resolve(/* turbopackIgnore: true */ configured || path.join(/* turbopackIgnore: true */ process.cwd(), "storage"));
  if (root === path.resolve(/* turbopackIgnore: true */ process.cwd(), "public") || root.startsWith(path.resolve(/* turbopackIgnore: true */ process.cwd(), "public") + path.sep)) {
    throw new Error("FILE_STORAGE_DIR must not be inside public/");
  }
  return root;
}

const KEY = /^[a-z0-9-]+(\/[a-z0-9-]+)*\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

/** Absolute path for a storage key; rejects anything that is not a generated key (no traversal). */
export function resolveKey(key: string) {
  if (!KEY.test(key)) throw new Error("Invalid storage key");
  const root = storageRoot();
  const full = path.resolve(/* turbopackIgnore: true */ root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
  return full;
}

/** Writes bytes under `key` without overwriting; written to a temp name first, then renamed. */
export async function putObject(key: string, bytes: Uint8Array) {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  const temp = `${full}.part`;
  await writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
  try {
    await rename(temp, full);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Removes an object (used only to undo a write when the database insert fails). */
export async function removeObject(key: string) {
  await rm(resolveKey(key), { force: true });
}

export async function objectSize(key: string) {
  return (await stat(resolveKey(key))).size;
}

/** A web stream of the object, optionally limited to an inclusive byte range. */
export function readObject(key: string, range?: { start: number; end: number }) {
  const stream = createReadStream(resolveKey(key), range ? { start: range.start, end: range.end } : undefined);
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}
