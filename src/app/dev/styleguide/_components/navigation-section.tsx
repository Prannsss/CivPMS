"use client";

import { useState } from "react";
import {
  CalendarPlus,
  ChartSpline,
  ClipboardCheck,
  Copy,
  Download,
  Ellipsis,
  FolderPlus,
  Info,
  ListTree,
  Pencil,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProjectAvatar } from "@/components/ui/project-color";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { CommandPalette, useModifierKeyLabel, type CommandPaletteGroup } from "@/components/shell/command-palette";
import { NotificationBell } from "@/components/shell/notification-bell";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { MOCK_NOTIFICATION_PROJECTS, MOCK_NOTIFICATIONS, MOCK_NOW, MOCK_PROJECTS, MOCK_USER } from "./mock-data";
import { Caption, Demo, Row, Section } from "./section";

export const PALETTE_GROUPS: CommandPaletteGroup[] = [
  {
    id: "projects",
    heading: "Projects",
    items: MOCK_PROJECTS.slice(0, 4).map((p) => ({
      id: p.id,
      label: p.name,
      hint: p.site,
      icon: <ProjectAvatar name={p.name} color={p.color} size="sm" className="size-8" />,
      href: "#shell",
    })),
  },
  {
    id: "activities",
    heading: "Activities",
    items: [
      { id: "a1", label: "Bored piles", hint: "2.1 · Cebu Coastal Road Widening", icon: <ListTree />, keywords: ["2.1"], href: "#display" },
      { id: "a2", label: "Rebar inspection, F-12", hint: "2.1.1 · Cebu Coastal Road Widening", icon: <ClipboardCheck />, keywords: ["2.1.1"], href: "#display" },
    ],
  },
  {
    id: "actions",
    heading: "Actions",
    items: [
      { id: "create-project", label: "Create project", icon: <FolderPlus />, shortcut: ["C", "P"], onSelect: () => toast.info("Create project") },
      { id: "invite", label: "Invite collaborator", icon: <UserPlus />, onSelect: () => toast.info("Invite collaborator") },
      { id: "propose", label: "Propose inspection", icon: <CalendarPlus />, onSelect: () => toast.info("Propose inspection") },
      { id: "s-curve", label: "Go to S-curve", hint: "Coming next", icon: <ChartSpline />, disabled: true },
    ],
  },
];

export const PALETTE_RECENT = [
  { id: "r1", label: "Cebu Coastal Road Widening", hint: "Project", href: "#shell" },
  { id: "r2", label: "2.1 Bored piles", hint: "Activity", href: "#display" },
];

export function NavigationSection() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  const [showDone, setShowDone] = useState(true);
  const modifier = useModifierKeyLabel();

  return (
    <Section id="navigation" title="Navigation & menus" description="Tabs, menus, popovers, tooltips, the command palette and the top-bar widgets.">
      <div className="grid gap-6 lg:grid-cols-2">
        <Demo title="Tabs — pill">
          <Tabs defaultValue="graph">
            <TabsList aria-label="WBS view">
              <TabsTrigger value="graph">Graph</TabsTrigger>
              <TabsTrigger value="list">List</TabsTrigger>
              <TabsTrigger value="baseline">Baseline</TabsTrigger>
            </TabsList>
            <TabsContent value="graph">
              <Caption>Graph view content.</Caption>
            </TabsContent>
            <TabsContent value="list">
              <Caption>List view content.</Caption>
            </TabsContent>
            <TabsContent value="baseline">
              <Caption>Baseline content.</Caption>
            </TabsContent>
          </Tabs>
        </Demo>
        <Demo title="Tabs — underline">
          <Tabs defaultValue="general">
            <TabsList variant="underline" aria-label="Project settings">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="calendar">Working calendar</TabsTrigger>
              <TabsTrigger value="codes">Invite codes</TabsTrigger>
              <TabsTrigger value="danger" disabled>
                Archive
              </TabsTrigger>
            </TabsList>
            <TabsContent value="general">
              <Caption>General settings.</Caption>
            </TabsContent>
            <TabsContent value="calendar">
              <Caption>Calendar settings.</Caption>
            </TabsContent>
            <TabsContent value="codes">
              <Caption>Invite codes.</Caption>
            </TabsContent>
          </Tabs>
        </Demo>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Demo title="Dropdown menu">
          <Row>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  Actions
                  <Ellipsis aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Activity 2.1</DropdownMenuLabel>
                <DropdownMenuItem>
                  <Pencil aria-hidden />
                  Edit
                  <DropdownMenuShortcut>E</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Copy aria-hidden />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Download aria-hidden />
                  Export CSV
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={showDone} onCheckedChange={(v) => setShowDone(v === true)}>
                  Show completed
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="danger">
                  <Trash2 aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Row>
        </Demo>
        <Demo title="Popover & tooltip">
          <Row>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <Info aria-hidden />
                  What is weighting?
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start">
                <p className="text-sm font-semibold">Weighting</p>
                <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                  Each activity counts toward overall progress by its estimated cost (default) or its working hours.
                </p>
              </PopoverContent>
            </Popover>
            <SimpleTooltip content="Critical path: 14 activities">
              <Button variant="ghost">Hover me</Button>
            </SimpleTooltip>
          </Row>
        </Demo>
        <Demo title="Command palette" description="Global ⌘K / Ctrl+K. Data comes in through props.">
          <Row>
            <Button variant="outline" onClick={() => setPaletteOpen(true)}>
              <Search aria-hidden />
              Open palette
              <span className="ml-1 inline-flex gap-1">
                <Kbd>{modifier}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </Button>
          </Row>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            groups={PALETTE_GROUPS}
            recent={PALETTE_RECENT}
          />
        </Demo>
      </div>

      <Demo title="Top-bar widgets" description="Theme toggle, notification bell (unread badge caps at 99+, per-project filter) and user menu (big avatar, red Sign out).">
        <Row className="gap-4">
          <ThemeToggle />
          <NotificationBell
            notifications={notifications}
            projects={MOCK_NOTIFICATION_PROJECTS}
            now={MOCK_NOW}
            viewAllHref="#navigation"
            onMarkAllRead={() => setNotifications((list) => list.map((n) => ({ ...n, read: true })))}
            onItemSelect={(item) => setNotifications((list) => list.map((n) => (n.id === item.id ? { ...n, read: true } : n)))}
          />
          <NotificationBell notifications={[]} unreadCount={128} now={MOCK_NOW} />
          <NotificationBell notifications={[]} now={MOCK_NOW} onMarkAllRead={() => {}} />
          <UserMenu
            user={MOCK_USER}
            profileHref="#navigation"
            settingsHref="#navigation"
            signOut={{ onSignOut: () => toast.message("Signed out (demo)") }}
          />
          <IconButton aria-label="Invite collaborator" variant="outline">
            <UserPlus aria-hidden />
          </IconButton>
        </Row>
      </Demo>
    </Section>
  );
}
