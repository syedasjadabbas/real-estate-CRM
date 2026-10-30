import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as job from "../../scripts/jobs/prune-signin-logs.mjs";
import { canManageSecurity } from "@/modules/security/policy";
import * as retention from "@/modules/security/retention";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("security settings policy (D2)", () => {
  it("is limited to super admin and admin", () => {
    expect(roles.filter((role) => canManageSecurity({ role }))).toEqual(["super_admin", "admin"]);
  });
});

describe("retention settings", () => {
  it("keeps the cleanup job and the app on the same keys and limits", () => {
    expect(job.RETENTION_MONTHS_KEY).toBe(retention.RETENTION_MONTHS_KEY);
    expect(job.CLEANUP_ENABLED_KEY).toBe(retention.CLEANUP_ENABLED_KEY);
    expect(job.LAST_RUN_KEY).toBe(retention.LAST_RUN_KEY);
    expect([job.DEFAULT_RETENTION_MONTHS, job.MIN_RETENTION_MONTHS, job.MAX_RETENTION_MONTHS]).toEqual([12, 3, 120]);
    expect([retention.DEFAULT_RETENTION_MONTHS, retention.MIN_RETENTION_MONTHS, retention.MAX_RETENTION_MONTHS]).toEqual([12, 3, 120]);
  });

  it("validates 3–120 whole months and rejects unknown fields (D3)", () => {
    const ok = (v: unknown) => retention.retentionSettingsSchema.safeParse(v).success;
    expect(ok({ retentionMonths: 3 })).toBe(true);
    expect(ok({ retentionMonths: "120" })).toBe(true);
    for (const bad of [2, 121, 12.5, "", "abc", -1]) expect(ok({ retentionMonths: bad })).toBe(false);
    expect(ok({ cleanupEnabled: "true" })).toBe(false);
    expect(ok({ deleteAuditLogs: true })).toBe(false);
  });

  it("job treats missing settings as 12 months and invalid ones as unusable", () => {
    expect(job.parseRetentionMonths(undefined)).toBe(12);
    expect(job.parseRetentionMonths("24")).toBe(24);
    for (const v of ["2", "121", "1.5", "x"]) expect(job.parseRetentionMonths(v)).toBeNull();
  });

  it("job deletes only from signin_logs and never from audit_logs", () => {
    const src = read("scripts/jobs/prune-signin-logs.mjs").toLowerCase();
    const deletes = src.match(/delete from \w+/g) ?? [];
    expect(new Set(deletes)).toEqual(new Set(["delete from signin_logs"]));
    expect(src).not.toMatch(/delete from audit_logs|truncate/);
  });
});

describe("attendance separation (C1)", () => {
  const pages = ["src/app/(app)/dashboard/performance/page.tsx", "src/app/(app)/dashboard/workspace/page.tsx", "src/config/navigation.ts"];

  it("never calls sign-in counts attendance, except to say they are not", () => {
    for (const p of pages) {
      for (const line of read(p).split("\n")) {
        if (!/attendance/i.test(line)) continue;
        expect(line, `${p}: ${line.trim()}`).toMatch(/not (an )?attendance|not attendance|attendance is not available|not used to work out/i);
      }
    }
  });

  it("derives no hours, durations, lateness or absences from sign-in logs", () => {
    for (const p of ["src/modules/performance/service.ts", "src/modules/workplace/service.ts"]) {
      // Code only: comments may explain what is deliberately not computed.
      const code = read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/duration|hoursWorked|workingHours|\blate(ness)?\b|absent|absence|present\b|attendance\s*[:=]/i);
    }
  });
});
