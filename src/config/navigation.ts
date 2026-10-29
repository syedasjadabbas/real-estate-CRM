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
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** One-line page description, taken from the reference module headers. */
  description: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Sidebar groups and order exactly as observed in the reference CRM.
 * Accounts & Finance is intentionally absent until its requirements are approved.
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
      },
      {
        label: "Clients",
        href: "/dashboard/clients",
        icon: Users,
        description: "Long-term profiles, investments, contracts, and payment history.",
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
      },
      {
        label: "Inventory",
        href: "/dashboard/inventory",
        icon: Grid3x3,
        description:
          "Browse units and project inventory. Open a unit for full dimensions and details.",
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
      },
      {
        label: "Teams",
        href: "/dashboard/teams",
        icon: Users,
        description: "Manage sales teams, members, performance, and manager daily reports.",
      },
      {
        label: "Bookings",
        href: "/dashboard/bookings",
        icon: BookText,
        description:
          "Lead → negotiation → forms & payments → confirmed. Units stay aligned with inventory.",
      },
      {
        label: "Tasks",
        href: "/dashboard/tasks",
        icon: SquareCheckBig,
        description: "Create, assign, and track CRM tasks including printable plans.",
      },
      {
        label: "Meetings",
        href: "/dashboard/meetings",
        icon: CalendarDays,
        description: "Schedule, filter, and manage team meetings.",
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
        description: "Agent KPIs and CRM attendance for your scope.",
      },
    ],
  },
];

export const allNavItems = navigation.flatMap((group) => group.items);

export function findNavItem(href: string) {
  return allNavItems.find((item) => item.href === href);
}
