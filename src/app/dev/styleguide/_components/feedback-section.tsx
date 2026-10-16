"use client";

import { useState } from "react";
import { FolderPlus, Inbox, Plus, SlidersHorizontal, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Modal,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton, SkeletonCard, SkeletonText } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { Demo, Row, Section } from "./section";

export function FeedbackSection() {
  const confirm = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Section
      id="feedback"
      title="Feedback & overlays"
      description="Skeletons for page loads, empty states that explain and offer the action, snackbars with Undo for reversible actions, confirm dialogs for destructive ones."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Demo title="Snackbars (toast)" description="Bottom-right on desktop, full-width bottom on phones. Actions get 8 s.">
          <Row className="gap-2">
            <Button variant="outline" size="sm" onClick={() => toast.success("Project created", { description: "Cebu Coastal Road Widening" })}>
              Success
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.error("Couldn't save changes", {
                  description: "You're offline. We'll keep your edits — try again when you're back online.",
                  action: { label: "Retry", onClick: () => toast.info("Retrying…") },
                })
              }
            >
              Error
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.warning("Budget exceeded", {
                  description: "Allocated ₱11.2M is ₱1.2M over the ₱10M budget.",
                  action: { label: "Review", onClick: () => {} },
                })
              }
            >
              Warning
            </Button>
            <Button variant="outline" size="sm" onClick={() => toast.info("Baseline v1 captured", { description: "Project moved to Active." })}>
              Info
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.undo("Work package moved to 2.1", () => toast.success("Move undone"))}
            >
              Undo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.promise(new Promise((resolve) => setTimeout(resolve, 1600)), {
                  loading: "Importing schedule…",
                  success: "Imported 48 activities",
                  error: "Import failed",
                })
              }
            >
              Promise
            </Button>
          </Row>
        </Demo>
        <Demo title="Confirm dialogs" description="useConfirm() → Promise<boolean>. Danger tone states the impact.">
          <Row className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const ok = await confirm({
                  title: "Set project to Active?",
                  description: "Baseline v1 will be captured from the current plan. You can still edit activities afterwards.",
                  confirmLabel: "Set Active",
                });
                toast.message(ok ? "Confirmed" : "Cancelled");
              }}
            >
              Default
            </Button>
            <Button
              variant="danger-outline"
              size="sm"
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete “Substructure”?",
                  description: "Deletes 4 sub-deliverables and 11 work packages. You can restore them from Audit Trail within 30 days.",
                  tone: "danger",
                  confirmLabel: "Delete deliverable",
                });
                if (ok) toast.undo("Deliverable deleted", () => toast.success("Deliverable restored"));
              }}
            >
              Danger
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                const ok = await confirm({
                  title: "Cancel this project?",
                  description: "Cebu Coastal Road Widening will become read-only for everyone. Collaborators keep their history.",
                  tone: "danger",
                  confirmLabel: "Cancel project",
                  cancelLabel: "Keep project",
                  confirmText: "Cebu Coastal Road Widening",
                });
                toast.message(ok ? "Project cancelled" : "Kept the project");
              }}
            >
              Type to confirm
            </Button>
          </Row>
        </Demo>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Demo title="Dialog / Modal" description="Centered on desktop, bottom sheet on phones. Esc closes.">
          <Row className="gap-2">
            <Modal
              open={modalOpen}
              onOpenChange={setModalOpen}
              trigger={
                <Button size="sm">
                  <UserPlus aria-hidden />
                  Invite collaborator
                </Button>
              }
              title="Invite a collaborator"
              description="They'll get an email invitation that expires in 7 days."
              footer={
                <>
                  <Button variant="outline" onClick={() => setModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      setModalOpen(false);
                      toast.success("Invitation sent", { description: "ana.reyes@gmail.com" });
                    }}
                  >
                    Send invitation
                  </Button>
                </>
              }
            >
              <div className="grid gap-5">
                <Field label="Email" required>
                  <Input type="email" placeholder="name@company.ph" />
                </Field>
                <Field label="Role" hint="Inspectors can update progress and propose inspections.">
                  <Select defaultValue="inspector">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pm">Project Manager</SelectItem>
                      <SelectItem value="inspector">Inspector / QA / QC</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </Modal>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Large dialog
                </Button>
              </DialogTrigger>
              <DialogContent size="lg">
                <DialogHeader>
                  <DialogTitle>Import preview</DialogTitle>
                  <DialogDescription>48 rows · 2 warnings · nothing is applied until you confirm.</DialogDescription>
                </DialogHeader>
                <DialogBody className="flex flex-col gap-3">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-md border border-border p-3">
                      <Skeleton className="size-8 rounded-full" />
                      <SkeletonText lines={2} className="flex-1" />
                    </div>
                  ))}
                </DialogBody>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Back</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button>Import 48 activities</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Row>
        </Demo>
        <Demo title="Sheet" description="Side drawer for filters and details.">
          <Row className="gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <SlidersHorizontal aria-hidden />
                  Filters
                </Button>
              </SheetTrigger>
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>Filter activities</SheetTitle>
                  <SheetDescription>Show only what you need.</SheetDescription>
                </SheetHeader>
                <SheetBody className="flex flex-col gap-4">
                  <Checkbox label="Delayed" defaultChecked />
                  <Checkbox label="On-Hold" />
                  <Checkbox label="Ongoing" defaultChecked />
                  <Checkbox label="Completed" />
                </SheetBody>
                <SheetFooter>
                  <SheetClose asChild>
                    <Button variant="outline">Clear</Button>
                  </SheetClose>
                  <SheetClose asChild>
                    <Button>Apply filters</Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  Bottom sheet
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom">
                <SheetHeader>
                  <SheetTitle>Update progress</SheetTitle>
                  <SheetDescription>2.1 Bored piles</SheetDescription>
                </SheetHeader>
                <SheetBody>
                  <Field label="Percent complete">
                    <Input type="number" inputMode="decimal" defaultValue={71} />
                  </Field>
                </SheetBody>
                <SheetFooter>
                  <SheetClose asChild>
                    <Button>Save update</Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </Row>
        </Demo>
      </div>

      <Demo title="Skeletons" description="Match the final layout so nothing jumps when data arrives.">
        <div className="grid gap-4 md:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard media />
          <div className="flex flex-col gap-4 rounded-lg border border-border p-5">
            <Skeleton className="h-5 w-2/5" />
            <SkeletonText lines={4} />
            <Skeleton className="h-10 w-32 rounded-md" />
          </div>
        </div>
      </Demo>

      <div className="grid gap-6 lg:grid-cols-2">
        <Demo title="Empty state — first project (PM)" bodyClassName="p-0 sm:p-0 border-0 bg-transparent">
          <EmptyState
            icon={<FolderPlus />}
            title="No projects yet"
            description="Create your first project to plan the work breakdown, schedule and budget. It takes about a minute."
            action={
              <Button>
                <Plus aria-hidden />
                Add project
              </Button>
            }
            secondaryAction={<Button variant="outline">Open sample project</Button>}
            checklist={[
              { label: "Create your company", done: true },
              { label: "Create a project", description: "Name, dates and budget" },
              { label: "Add deliverables" },
              { label: "Invite your team" },
            ]}
          />
        </Demo>
        <div className="flex flex-col gap-6">
          <Demo title="Empty state — inspector without projects" bodyClassName="p-0 sm:p-0 border-0 bg-transparent">
            <EmptyState
              icon={<Inbox />}
              size="sm"
              title="You haven't been added to a project yet"
              description={
                <>
                  Ask your Project Manager to invite you using <strong className="font-semibold text-foreground">maria@site.ph</strong>, or
                  enter an invite code.
                </>
              }
              action={<Button>Enter invite code</Button>}
            />
          </Demo>
          <Demo title="Empty state — inside a card" bodyClassName="p-0">
            <EmptyState
              variant="plain"
              size="sm"
              headingLevel="h3"
              icon={<Users />}
              title="No collaborators"
              description="Invite inspectors to update progress from the site."
              action={
                <Button size="sm" variant="outline">
                  <UserPlus aria-hidden />
                  Invite
                </Button>
              }
            />
          </Demo>
        </div>
      </div>
    </Section>
  );
}
