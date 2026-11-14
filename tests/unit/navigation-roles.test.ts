import { describe, expect, it } from "vitest";
import { canManageAccess } from "@/modules/accounts/access";
import { navigation } from "@/config/navigation";
import { canDoBooking } from "@/modules/bookings/policy";
import { canDoClient } from "@/modules/clients/policy";
import { canDoFinance } from "@/modules/finance/policy";
import { canDoInventory } from "@/modules/inventory/policy";
import { canDo as canDoLead } from "@/modules/leads/policy";
import { canManageAssignment } from "@/modules/leads/assignment";
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
  "/dashboard/leads/todos": (a) => canDoLead(a, "view"),
  "/dashboard/settings/assignment": (a) => canManageAssignment(a),
  "/dashboard/settings/access": (a) => canManageAccess(a),
  "/dashboard/clients": (a) => canDoClient(a, "view"),
  "/dashboard/projects": (a) => canDoProject(a, "view"),
  "/dashboard/inventory": (a) => canDoInventory(a, "view"),
  "/dashboard/bookings": (a) => canDoBooking(a, "view"),
  // Managers are redirected from the payments page to their reversal approvals.
  "/dashboard/finance": (a) => canDoFinance(a, "viewAll") || canDoFinance(a, "decideReversal"),
  "/dashboard/tasks": (a) => canDoTask(a, "view"),
  "/dashboard/meetings": (a) => canDoMeeting(a, "view"),
  "/dashboard/targets": (a) => canViewTargets(a),
  // Agents can still open their own roster by address, but the menu leaves Teams out for them.
  "/dashboard/teams": (a) => (canViewTeams(a) || canViewOwnRoster(a)) && a.role !== "agent",
  "/dashboard/performance": (a) => canViewPerformance(a),
};

describe("sidebar links follow page permissions", () => {
  it.each(roles)("%s sees exactly the modules it may open", (role) => {
    for (const [href, allowed] of Object.entries(pageAllows)) {
      expect(shows(href, role), `${role} ${href}`).toBe(allowed({ role }));
    }
  });

  it("HR and accountants no longer see sales modules they can't open", () => {
    // Each menu entry by its own role list, as the sidebar filters them (a link may appear in two groups).
    const visible = (role: Role) => items.filter((i) => !i.roles || i.roles.includes(role)).map((i) => i.label);
    expect(visible("hr")).toEqual(["Dashboard", "My workplace", "HR", "Teams", "Tasks"]);
    // HR is for HR, Admins and Super Admins (13 Nov 2026); accountants keep My workplace for their leave.
    expect(visible("accountant")).toEqual(["Dashboard", "Clients", "Projects", "Inventory", "My workplace", "Bookings", "Finance", "Tasks"]);
    // Agents: no HR; their Reports group holds My performance and My workplace.
    expect(visible("agent")).not.toContain("HR");
    const agentReports = navigation.find((g) => g.label === "Reports")!.items.filter((i) => !i.roles || i.roles.includes("agent"));
    expect(agentReports.map((i) => i.labels?.agent ?? i.label)).toEqual(["My performance", "My workplace"]);
    const agentStaff = navigation.find((g) => g.label === "Staff")!.items.filter((i) => !i.roles || i.roles.includes("agent"));
    expect(agentStaff).toEqual([]);
    expect(visible("agent")).toContain("New leads");
    expect(visible("agent")).toContain("To-dos");
  });
});
