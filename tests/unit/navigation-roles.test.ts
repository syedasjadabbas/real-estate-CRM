import { describe, expect, it } from "vitest";
import { navigation } from "@/config/navigation";
import { canDoBooking } from "@/modules/bookings/policy";
import { canDoClient } from "@/modules/clients/policy";
import { canDoFinance } from "@/modules/finance/policy";
import { canDoInventory } from "@/modules/inventory/policy";
import { canDo as canDoLead } from "@/modules/leads/policy";
import { canDoMeeting } from "@/modules/meetings/policy";
import { canViewPerformance } from "@/modules/performance/service";
import { canDoProject } from "@/modules/projects/policy";
import { canViewTargets } from "@/modules/targets/policy";
import { canDoTask } from "@/modules/tasks/policy";
import { canViewOwnRoster, canViewTeams } from "@/modules/teams/policy";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const items = navigation.flatMap((g) => g.items);
const shows = (href: string, role: Role) => {
  const item = items.find((i) => i.href === href);
  if (!item) throw new Error(`no menu item ${href}`);
  return !item.roles || item.roles.includes(role);
};

/** The access check each page makes before it shows anything (the page files' RestrictedState guards). */
const pageAllows: Record<string, (actor: { role: Role }) => boolean> = {
  "/dashboard/leads": (a) => canDoLead(a, "view"),
  "/dashboard/leads?stage=new_lead": (a) => canDoLead(a, "view"),
  "/dashboard/clients": (a) => canDoClient(a, "view"),
  "/dashboard/projects": (a) => canDoProject(a, "view"),
  "/dashboard/inventory": (a) => canDoInventory(a, "view"),
  "/dashboard/bookings": (a) => canDoBooking(a, "view"),
  // Managers are redirected from the payments page to their reversal approvals.
  "/dashboard/finance": (a) => canDoFinance(a, "viewAll") || canDoFinance(a, "decideReversal"),
  "/dashboard/tasks": (a) => canDoTask(a, "view"),
  "/dashboard/meetings": (a) => canDoMeeting(a, "view"),
  "/dashboard/targets": (a) => canViewTargets(a),
  "/dashboard/teams": (a) => canViewTeams(a) || canViewOwnRoster(a),
  "/dashboard/performance": (a) => canViewPerformance(a),
};

describe("sidebar links follow page permissions", () => {
  it.each(roles)("%s sees exactly the modules it may open", (role) => {
    for (const [href, allowed] of Object.entries(pageAllows)) {
      expect(shows(href, role), `${role} ${href}`).toBe(allowed({ role }));
    }
  });

  it("HR and accountants no longer see sales modules they can't open", () => {
    const visible = (role: Role) => items.filter((i) => shows(i.href, role)).map((i) => i.label);
    expect(visible("hr")).toEqual(["Dashboard", "My workplace", "HR", "Teams", "Tasks"]);
    expect(visible("accountant")).toEqual(["Dashboard", "Clients", "Projects", "Inventory", "My workplace", "HR", "Bookings", "Finance", "Tasks"]);
    expect(visible("agent")).toContain("New leads");
  });
});
