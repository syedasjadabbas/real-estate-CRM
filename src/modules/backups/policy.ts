import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/** Backup status (Settings → Backups): Super Admin only. Restores are never started from the app. */
export function canViewBackups(actor: Pick<Actor, "role">) {
  return actor.role === "super_admin";
}

export function assertCanViewBackups(actor: Pick<Actor, "role">) {
  if (!canViewBackups(actor)) throw forbidden();
}
