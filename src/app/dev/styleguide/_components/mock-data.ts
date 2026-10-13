import type { ProjectColorKey } from "@/lib/constants";
import type { DerivedBadge, ProjectStatus } from "@/components/ui/status-badge";
import type { NotificationItem } from "@/components/shell/notification-bell";

/** Fixed "now" so screenshots and relative times are stable (Asia/Manila). */
export const MOCK_NOW = new Date("2026-10-12T09:00:00+08:00");

const minutesAgo = (m: number) => new Date(MOCK_NOW.getTime() - m * 60_000).toISOString();

export const MOCK_USER = {
  name: "Juan Dela Cruz",
  email: "juan@delacruzbuilders.ph",
  subtitle: "Owner PM · Dela Cruz Builders",
};

export type MockProject = {
  id: string;
  name: string;
  site: string;
  color: ProjectColorKey;
  status: ProjectStatus;
  derived: DerivedBadge[];
  start: string;
  end: string;
  progress: number;
  allocated: number;
  budget: number;
};

export const MOCK_PROJECTS: MockProject[] = [
  {
    id: "p1",
    name: "Cebu Coastal Road Widening",
    site: "Talisay, Cebu",
    color: "blue",
    status: "active",
    derived: [],
    start: "12 Jan 2026",
    end: "30 Jun 2027",
    progress: 42,
    allocated: 82_400_000,
    budget: 120_000_000,
  },
  {
    id: "p2",
    name: "Iloilo Riverside Mixed-Use Tower",
    site: "Iloilo City",
    color: "purple",
    status: "active",
    derived: ["near_budget_limit"],
    start: "3 Mar 2026",
    end: "15 Dec 2027",
    progress: 27,
    allocated: 9_350_000,
    budget: 10_000_000,
  },
  {
    id: "p3",
    name: "Davao Drainage Rehabilitation, Phase 2",
    site: "Davao City",
    color: "teal",
    status: "active",
    derived: ["delayed", "budget_exceeded"],
    start: "1 Feb 2026",
    end: "30 Sep 2026",
    progress: 88,
    allocated: 11_200_000,
    budget: 10_000_000,
  },
  {
    id: "p4",
    name: "Pampanga School Building",
    site: "San Fernando, Pampanga",
    color: "green",
    status: "completed",
    derived: [],
    start: "6 Jan 2025",
    end: "20 Aug 2026",
    progress: 100,
    allocated: 18_750_000,
    budget: 19_000_000,
  },
  {
    id: "p5",
    name: "Baguio Slope Protection",
    site: "Baguio City",
    color: "pink",
    status: "on_hold",
    derived: [],
    start: "4 May 2026",
    end: "28 Feb 2027",
    progress: 15,
    allocated: 4_100_000,
    budget: 7_500_000,
  },
  {
    id: "p6",
    name: "Laguna Warehouse Expansion",
    site: "Calamba, Laguna",
    color: "graphite",
    status: "planning",
    derived: [],
    start: "1 Dec 2026",
    end: "31 Oct 2027",
    progress: 0,
    allocated: 2_300_000,
    budget: 25_000_000,
  },
];

export const MOCK_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    type: "inspection",
    title: "Inspection proposed: Rebar inspection, Footing F-12",
    body: "Maria Santos proposed 14 Oct 2026, 9:00 AM. Approve or reschedule.",
    createdAt: minutesAgo(6),
    read: false,
    projectId: "p1",
    projectName: "Cebu Coastal Road Widening",
  },
  {
    id: "n2",
    type: "project",
    tone: "danger",
    title: "Davao Drainage Rehabilitation is now Delayed",
    body: "The end date (30 Sep 2026) has passed with 3 activities still open.",
    createdAt: minutesAgo(95),
    read: false,
    projectId: "p3",
    projectName: "Davao Drainage Rehabilitation, Phase 2",
  },
  {
    id: "n3",
    type: "invitation",
    title: "Ana Reyes accepted your invitation",
    body: "She joined Iloilo Riverside Mixed-Use Tower as Inspector.",
    createdAt: minutesAgo(60 * 26),
    read: true,
    projectId: "p2",
    projectName: "Iloilo Riverside Mixed-Use Tower",
  },
  {
    id: "n4",
    type: "activity",
    tone: "success",
    title: "1.2.3 Formworks — Level 2 marked Completed",
    createdAt: minutesAgo(60 * 24 * 9),
    read: true,
    projectId: "p1",
    projectName: "Cebu Coastal Road Widening",
  },
];

export const MOCK_NOTIFICATION_PROJECTS = MOCK_PROJECTS.slice(0, 3).map((p) => ({ id: p.id, name: p.name }));
