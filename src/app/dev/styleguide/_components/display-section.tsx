"use client";

import { CalendarDays, ClipboardCheck, Ellipsis, Flag, ListTree, TrendingUp, Wallet } from "lucide-react";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { BADGE_TONES, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Meter } from "@/components/ui/meter";
import { Progress } from "@/components/ui/progress";
import { ProjectAvatar } from "@/components/ui/project-color";
import { StatCard } from "@/components/ui/stat-card";
import { ACTIVITY_STATUSES, DERIVED_BADGES, PROJECT_STATUSES, StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Caption, Demo, Row, Section } from "./section";

const PEOPLE = [
  { name: "Juan Dela Cruz" },
  { name: "Maria Santos" },
  { name: "Ana Reyes" },
  { name: "Jose Rizal Mercado" },
  { name: "Liza Soberano" },
  { name: "Paolo Garcia" },
];

const ACTIVITIES = [
  { code: "1", name: "Site development", status: "completed", start: "12 Jan 2026", end: "20 Feb 2026", cost: 4_250_000, pct: 100, level: 0 },
  { code: "1.1", name: "Clearing and grubbing", status: "completed", start: "12 Jan 2026", end: "30 Jan 2026", cost: 1_150_000, pct: 100, level: 1 },
  { code: "2", name: "Substructure", status: "ongoing", start: "23 Feb 2026", end: "15 Jun 2026", cost: 18_900_000, pct: 64, level: 0 },
  { code: "2.1", name: "Bored piles", status: "delayed", start: "23 Feb 2026", end: "30 Apr 2026", cost: 9_400_000, pct: 71, level: 1 },
  { code: "2.1.1", name: "Rebar inspection, F-12", status: "on_hold", start: "2 Mar 2026", end: "6 Mar 2026", cost: 120_000, pct: 30, level: 2 },
  { code: "3", name: "Superstructure", status: "not_started", start: "16 Jun 2026", end: "30 Jun 2027", cost: 59_250_000, pct: 0, level: 0 },
] as const;

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

export function BadgesSection() {
  return (
    <Section
      id="badges"
      title="Badges & status"
      description="Status is always color + icon + label. Delayed is a red chip — never a solid red button — so it is not confused with destructive actions."
    >
      <Demo title="Tones × variants">
        <div className="flex flex-col gap-3">
          {(["soft", "outline", "solid"] as const).map((variant) => (
            <Row key={variant} className="gap-2">
              <span className="w-16 text-caption text-muted-foreground">{variant}</span>
              {BADGE_TONES.map((tone) => (
                <Badge key={tone} tone={tone} variant={variant} dot={variant !== "solid"} className="capitalize">
                  {tone}
                </Badge>
              ))}
            </Row>
          ))}
          <Row className="gap-2">
            <span className="w-16 text-caption text-muted-foreground">sizes</span>
            <Badge size="sm" tone="primary">Small</Badge>
            <Badge size="md" tone="primary">Medium</Badge>
            <Badge size="lg" tone="primary" icon={<Flag />}>
              Large with icon
            </Badge>
          </Row>
        </div>
      </Demo>
      <div className="grid gap-6 lg:grid-cols-3">
        <Demo title="Activity status">
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </Demo>
        <Demo title="Project status">
          <div className="flex flex-wrap gap-2">
            {PROJECT_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </Demo>
        <Demo title="Derived project badges">
          <div className="flex flex-wrap gap-2">
            {DERIVED_BADGES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
            <StatusBadge status="delayed" label="Delayed · 12 days" />
          </div>
        </Demo>
      </div>
    </Section>
  );
}

export function DisplaySection() {
  return (
    <Section id="display" title="Data display" description="Avatars, cards, KPI tiles, progress, budget meters and tables.">
      <div className="grid gap-6 lg:grid-cols-2">
        <Demo title="Avatars" description="Image with initials fallback; color is deterministic per name.">
          <div className="flex flex-col gap-5">
            <Row className="gap-4">
              <Avatar name="Juan Dela Cruz" size="xs" />
              <Avatar name="Maria Santos" size="sm" />
              <Avatar name="Ana Reyes" size="md" />
              <Avatar name="Jose Rizal Mercado" size="lg" />
              <Avatar name="Paolo Garcia" size="xl" />
            </Row>
            <Row className="gap-6">
              <AvatarGroup people={PEOPLE} max={4} />
              <AvatarGroup people={PEOPLE.slice(0, 3)} size="md" />
            </Row>
            <Row className="gap-3">
              <ProjectAvatar name="Cebu Coastal Road" color="blue" />
              <ProjectAvatar name="Iloilo Riverside" color="purple" />
              <ProjectAvatar name="Davao Drainage" color="teal" />
              <ProjectAvatar name="Pampanga School" color="green" />
              <ProjectAvatar name="Baguio Slope" color="pink" />
              <ProjectAvatar name="Laguna Warehouse" color="graphite" />
              <Caption>ProjectAvatar</Caption>
            </Row>
          </div>
        </Demo>
        <Demo title="Progress" description="tone=auto: blue while in progress, green at 100%.">
          <div className="flex flex-col gap-5">
            <Progress value={42} label="Overall progress" showValue aria-label="Overall progress" />
            <Progress value={100} label="Site development" showValue aria-label="Site development" />
            <Progress value={18} tone="warning" size="sm" aria-label="Small warning progress" />
            <Progress value={null} size="sm" aria-label="Importing" label="Importing schedule…" />
          </div>
        </Demo>
      </div>

      <Demo title="Budget meter" description="Allocated vs budget: within (< 90%), near limit (90–100%), exceeded (> 100%).">
        <div className="grid gap-8 md:grid-cols-3">
          <Meter allocated={8_200_000} budget={10_000_000} />
          <Meter allocated={9_350_000} budget={10_000_000} />
          <Meter allocated={11_200_000} budget={10_000_000} />
        </div>
      </Demo>

      <Demo title="Stat cards" bodyClassName="bg-surface-muted">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Overall progress" value="42.0%" icon={<TrendingUp />} delta={{ value: "+3.1% this week", trend: "up", sentiment: "positive" }} />
          <StatCard
            label="Budget allocated"
            value="₱82.4M"
            icon={<Wallet />}
            tone="info"
            hint="of ₱120M budget"
            footer={<Progress value={68.7} size="sm" aria-label="Budget allocated" />}
          />
          <StatCard label="Delayed activities" value="3" icon={<ListTree />} tone="danger" delta={{ value: "+1 since Monday", trend: "up", sentiment: "negative" }} />
          <StatCard label="Inspections this week" value="5" icon={<ClipboardCheck />} tone="success" hint="2 waiting for approval" />
        </div>
      </Demo>

      <div className="grid gap-6 lg:grid-cols-2">
        <Demo title="Card" bodyClassName="bg-surface-muted">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming milestones</CardTitle>
              <CardDescription>Next 30 days · Asia/Manila</CardDescription>
              <CardAction>
                <IconButton aria-label="Milestone options" variant="ghost" size="sm">
                  <Ellipsis aria-hidden />
                </IconButton>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-4">
              {[
                ["Pile cap pour, Pier 4", "18 Oct 2026"],
                ["Deck slab inspection", "29 Oct 2026"],
              ].map(([name, date]) => (
                <div key={name} className="flex items-center gap-3">
                  <span aria-hidden className="grid size-9 place-items-center rounded-md bg-primary-soft text-primary-text">
                    <CalendarDays className="size-4" />
                  </span>
                  <span className="flex-1 text-sm font-medium">{name}</span>
                  <span className="text-[13px] text-muted-foreground tabular-nums">{date}</span>
                </div>
              ))}
            </CardContent>
            <CardFooter>
              <Button variant="link" size="sm">
                Open calendar
              </Button>
            </CardFooter>
          </Card>
        </Demo>
        <Demo title="Interactive card" bodyClassName="bg-surface-muted">
          <Card variant="interactive" className="p-5">
            <div className="flex items-center gap-3">
              <ProjectAvatar name="Davao Drainage" color="teal" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">Davao Drainage Rehabilitation, Phase 2</p>
                <p className="text-xs text-muted-foreground">Davao City · ends 30 Sep 2026</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <StatusBadge status="active" size="sm" />
              <StatusBadge status="delayed" size="sm" />
              <StatusBadge status="budget_exceeded" size="sm" />
            </div>
            <Meter className="mt-4" allocated={11_200_000} budget={10_000_000} size="sm" />
          </Card>
        </Demo>
      </div>

      <Demo title="Table" description="Sticky header (scroll inside), zebra rows, dense mode, numeric alignment." bodyClassName="p-0 sm:p-0 border-0 bg-transparent">
        <TableContainer className="max-h-80">
          <Table zebra>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">WBS</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Start</TableHead>
                <TableHead className="hidden md:table-cell">End</TableHead>
                <TableHead numeric>Est. cost</TableHead>
                <TableHead numeric className="w-36">Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ACTIVITIES.map((a) => (
                <TableRow key={a.code} data-state={a.code === "2.1" ? "selected" : undefined}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{a.code}</TableCell>
                  <TableCell>
                    <span className={a.level === 0 ? "font-semibold" : ""} style={{ paddingLeft: `${a.level * 16}px` }}>
                      {a.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} size="sm" />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">{a.start}</TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">{a.end}</TableCell>
                  <TableCell numeric>{peso.format(a.cost)}</TableCell>
                  <TableCell numeric>
                    <div className="flex items-center justify-end gap-2">
                      <Progress value={a.pct} size="sm" className="w-16" aria-label={`${a.name} progress`} />
                      <span className="w-9 text-xs tabular-nums">{a.pct}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TableContainer className="mt-4">
          <Table dense>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-muted-foreground tabular-nums">12 Oct 2026, 8:41 AM</TableCell>
                <TableCell>Maria Santos</TableCell>
                <TableCell>2.1 Bored piles: progress 64% → 71%</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-muted-foreground tabular-nums">11 Oct 2026, 4:02 PM</TableCell>
                <TableCell>Juan Dela Cruz</TableCell>
                <TableCell>Budget ₱115,000,000.00 → ₱120,000,000.00</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Demo>
    </Section>
  );
}
