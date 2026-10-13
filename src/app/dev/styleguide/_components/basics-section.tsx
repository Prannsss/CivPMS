"use client";

import { useState } from "react";
import { Bell, Download, Ellipsis, Plus, Search, Settings, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Caption, Demo, Row, Section } from "./section";

const TYPE_SCALE = [
  { cls: "text-display", spec: "36/44 · 600 · −0.02em (30/38 on phones)", sample: "Plan every project in minutes" },
  { cls: "text-h1", spec: "28/36 · 600 · −0.02em (24/32 on phones)", sample: "Cebu Coastal Road Widening" },
  { cls: "text-h2", spec: "22/30 · 600 · −0.015em", sample: "Work Breakdown" },
  { cls: "text-h3", spec: "18/26 · 600 · −0.01em", sample: "Budget allocation" },
  { cls: "text-body-lg", spec: "15/24 · 400", sample: "Inspectors update progress from the site, even with no signal." },
  { cls: "text-body", spec: "14/22 · 400 (default)", sample: "Parents roll up dates, hours and cost from their work packages." },
  { cls: "text-label", spec: "13/20 · 500", sample: "Estimated start date" },
  { cls: "text-caption", spec: "12/16 · 400", sample: "Updated 5 minutes ago by Maria Santos" },
] as const;

export function TypographySection() {
  return (
    <Section
      id="typography"
      title="Typography"
      description="Poppins 400/500/600/700. Poppins is wide, so body text stays at 14px. Money, dates and percentages use tabular-nums."
    >
      <Demo title="Type scale" bodyClassName="p-0 sm:p-0">
        <ul className="divide-y divide-border">
          {TYPE_SCALE.map((t) => (
            <li key={t.cls} className="flex flex-col gap-1.5 px-4 py-4 sm:flex-row sm:items-baseline sm:gap-6 sm:px-6">
              <div className="flex w-56 shrink-0 flex-col">
                <code className="font-mono text-xs font-medium text-primary-text">{t.cls}</code>
                <span className="text-caption text-muted-foreground">{t.spec}</span>
              </div>
              <p className={`${t.cls} min-w-0 text-foreground`}>{t.sample}</p>
            </li>
          ))}
        </ul>
      </Demo>
      <div className="grid gap-6 md:grid-cols-2">
        <Demo title="Numbers" description="tabular-nums keeps columns aligned">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm tabular-nums">
            <dt className="text-muted-foreground">Budget</dt>
            <dd className="text-right font-semibold">₱120,000,000.00</dd>
            <dt className="text-muted-foreground">Allocated</dt>
            <dd className="text-right font-semibold">₱82,400,000.00</dd>
            <dt className="text-muted-foreground">Progress</dt>
            <dd className="text-right font-semibold">42.0%</dd>
            <dt className="text-muted-foreground">End date</dt>
            <dd className="text-right font-semibold">30 Jun 2027</dd>
          </dl>
        </Demo>
        <Demo title="Text colors">
          <div className="flex flex-col gap-1.5 text-sm">
            <p className="text-foreground">foreground — primary text</p>
            <p className="text-muted-foreground">muted-foreground — secondary text, hints</p>
            <p>
              <a href="#typography" className="font-medium text-primary-text underline-offset-4 hover:underline">
                primary-text — links and blue text
              </a>
            </p>
            <p className="text-danger-text">danger-text — errors and destructive copy</p>
          </div>
        </Demo>
      </div>
    </Section>
  );
}

export function ButtonsSection() {
  const [loading, setLoading] = useState(false);
  return (
    <Section
      id="buttons"
      title="Buttons"
      description="One obvious primary action per screen. Danger is only for destructive actions (delete, remove, sign out). 44px tall on phones, 40px on desktop."
    >
      <Demo title="Variants">
        <Row>
          <Button>
            <Plus aria-hidden />
            Add project
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">
            <Download aria-hidden />
            Export
          </Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">
            <Trash2 aria-hidden />
            Delete
          </Button>
          <Button variant="danger-outline">Remove member</Button>
          <Button variant="link">View all projects</Button>
        </Row>
      </Demo>
      <div className="grid gap-6 lg:grid-cols-2">
        <Demo title="Sizes">
          <Row>
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" variant="outline" aria-label="Settings">
              <Settings aria-hidden />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="More">
              <Ellipsis aria-hidden />
            </Button>
          </Row>
        </Demo>
        <Demo title="States" description="Loading keeps the label, shows a spinner and sets aria-busy.">
          <Row>
            <Button
              loading={loading}
              onClick={() => {
                setLoading(true);
                window.setTimeout(() => setLoading(false), 1800);
              }}
            >
              {loading ? "Saving…" : "Save changes"}
            </Button>
            <Button loading variant="outline">
              Loading
            </Button>
            <Button disabled>Disabled</Button>
            <Button variant="outline" disabled>
              Disabled
            </Button>
          </Row>
        </Demo>
      </div>
      <Demo title="Icon buttons" description="Round, like the mockup header circles. aria-label is required and doubles as the tooltip.">
        <Row className="gap-4">
          <IconButton aria-label="Search" variant="soft">
            <Search aria-hidden />
          </IconButton>
          <IconButton aria-label="Notifications" variant="soft">
            <Bell aria-hidden />
          </IconButton>
          <IconButton aria-label="Invite collaborator" variant="outline">
            <UserPlus aria-hidden />
          </IconButton>
          <IconButton aria-label="More actions" variant="ghost">
            <Ellipsis aria-hidden />
          </IconButton>
          <IconButton aria-label="Add" variant="primary">
            <Plus aria-hidden />
          </IconButton>
          <IconButton aria-label="Delete" variant="danger">
            <Trash2 aria-hidden />
          </IconButton>
          <Separator orientation="vertical" className="h-8" />
          <IconButton aria-label="Small" size="sm" variant="soft">
            <Bell aria-hidden />
          </IconButton>
          <IconButton aria-label="Large" size="lg" variant="soft">
            <Bell aria-hidden />
          </IconButton>
          <IconButton aria-label="Busy" loading variant="soft">
            <Bell aria-hidden />
          </IconButton>
        </Row>
      </Demo>
      <div className="grid gap-6 md:grid-cols-2">
        <Demo title="Spinner">
          <Row className="gap-5 text-muted-foreground">
            <Spinner size="xs" />
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" className="text-primary-text" />
          </Row>
        </Demo>
        <Demo title="Keyboard hints">
          <Row>
            <span className="inline-flex items-center gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
            <Kbd>Esc</Kbd>
            <Caption>Use Kbd for shortcut hints.</Caption>
          </Row>
        </Demo>
      </div>
    </Section>
  );
}
