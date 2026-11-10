import {
  Activity,
  BookText,
  Building,
  CalendarDays,
  Circle,
  Database,
  Grid3x3,
  LayoutGrid,
  SquareCheckBig,
  Target,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** One-line page description, taken from the reference module headers. */
  description: string;
  /**
   * Roles that see the item; omitted = everyone. Each list matches the page's own permission check
   * (tests/unit/navigation-roles.test.ts), so a role is never sent to an "Access denied" page from
   * the menu. Hiding a link changes nothing on the server: the pages and APIs still check access.
   */
  roles?: string[];
};

/** Roles with any lead access (leads/policy.ts: HR and accountants have none). */
const LEAD_ROLES = ["super_admin", "admin", "manager", "agent"];
/** Roles that may view clients, projects, inventory and bookings (HR may not). */
const SALES_RECORD_ROLES = ["super_admin", "admin", "manager", "agent", "accountant"];

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Sidebar groups and order exactly as observed in the reference CRM, plus Accounts & Finance
 * (not in the reference). Its placement under Management, after Bookings, is an assumption (Q-F14).
 */
export const navigation: NavGroup[] = [
  {
    label: "Dashboard",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutGrid,
        description: "Live overview of the sales pipeline for the selected project.",
      },
    ],
  },
  {
    label: "Clients & Leads",
    items: [
      {
        label: "Leads",
        href: "/dashboard/leads",
        icon: Database,
        description: "Pipeline, assignments, inbound channels, and lead history — per active project.",
        roles: LEAD_ROLES,
      },
      {
        label: "New leads",
        href: "/dashboard/leads?stage=new_lead",
        icon: UserPlus,
        description: "Leads still in the New Lead stage, in the leads list.",
        roles: LEAD_ROLES,
      },
      {
        label: "Clients",
        href: "/dashboard/clients",
        icon: Users,
        description: "Long-term profiles, investments, contracts, and payment history.",
        roles: SALES_RECORD_ROLES,
      },
    ],
  },
  {
    label: "Projects & Inventory",
    items: [
      {
        label: "Projects",
        href: "/dashboard/projects",
        icon: Building,
        description:
          "Building, farmhouse, and society portfolios. Define inventory dimensions and units per project.",
        roles: SALES_RECORD_ROLES,
      },
      {
        label: "Inventory",
        href: "/dashboard/inventory",
        icon: Grid3x3,
        description:
          "Browse units and project inventory. Open a unit for full dimensions and details.",
        roles: SALES_RECORD_ROLES,
      },
    ],
  },
  {
    label: "Staff",
    items: [
      {
        label: "My workplace",
        href: "/dashboard/workspace",
        icon: Circle,
        description: "Your leave, company holidays, and CRM sign-in history.",
      },
      {
        label: "HR",
        href: "/dashboard/hr",
        icon: Users,
        description: "Employee records, holiday calendar, leave requests, and activity.",
      },
    ],
  },
  {
    label: "Management",
    items: [
      {
        label: "Targets",
        href: "/dashboard/targets",
        icon: Target,
        description: "Goals set per user for the selected period (daily / weekly / monthly).",
        roles: ["super_admin", "admin", "manager", "agent"],
      },
      {
        label: "Teams",
        href: "/dashboard/teams",
        icon: Users,
        description: "Manage sales teams, members, performance, and manager daily reports.",
        roles: ["super_admin", "admin", "manager", "agent", "hr"],
      },
      {
        label: "Bookings",
        href: "/dashboard/bookings",
        icon: BookText,
        description:
          "Lead → negotiation → forms & payments → confirmed. Units stay aligned with inventory.",
        roles: SALES_RECORD_ROLES,
      },
      {
        label: "Finance",
        href: "/dashboard/finance",
        icon: Wallet,
        description: "Booking payments, receipts, reversals and outstanding balances.",
        roles: ["super_admin", "admin", "accountant", "manager"],
      },
      {
        label: "Tasks",
        href: "/dashboard/tasks",
        icon: SquareCheckBig,
        description: "Create, assign, and track CRM tasks including printable plans.",
        roles: ["super_admin", "admin", "manager", "agent", "hr", "accountant"],
      },
      {
        label: "Meetings",
        href: "/dashboard/meetings",
        icon: CalendarDays,
        description: "Schedule, filter, and manage team meetings.",
        roles: ["super_admin", "admin", "manager", "agent"],
      },
    ],
  },
  {
    label: "Reports",
    items: [
      {
        label: "Performance",
        href: "/dashboard/performance",
        icon: Activity,
        description: "Agent KPIs and CRM sign-in activity for your scope.",
        roles: ["super_admin", "admin", "manager", "agent"],
      },
    ],
  },
];

export const allNavItems = navigation.flatMap((group) => group.items);

export function findNavItem(href: string) {
  return allNavItems.find((item) => item.href === href);
}
