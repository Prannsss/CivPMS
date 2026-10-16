"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { CircleCheck, Copy, HardHat, Info, Mail, MailCheck, UserPlus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormError, FormField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ChoiceCard, RadioGroup } from "@/components/ui/radio-group";
import { toast } from "@/components/ui/toaster";
import { inviteSchema, type InviteInput, type InviteValues } from "@/lib/domain/schemas";
import { projectRoleLabel } from "@/lib/domain/permissions";
import { inviteCollaborator, type InviteOutcome } from "@/server/actions/collaborators";
import { copyToClipboard } from "./copy";

/** What happened to the email, in plain language. */
export function deliveryHeadline(outcome: InviteOutcome): { title: string; icon: LucideIcon; tone: "success" | "info" } {
  if (outcome.delivery === "emailed") {
    return { title: `Invitation sent to ${outcome.email}`, icon: MailCheck, tone: "success" };
  }
  if (outcome.delivery === "in_app") {
    return { title: `${outcome.email} has been invited`, icon: CircleCheck, tone: "success" };
  }
  return { title: `Invitation created for ${outcome.email}`, icon: Info, tone: "info" };
}

export function deliveryDetail(outcome: InviteOutcome): string {
  if (outcome.delivery === "emailed") {
    return `They'll join as ${projectRoleLabel(outcome.role)} when they accept. The link works for 7 days.`;
  }
  if (outcome.delivery === "in_app") {
    return `They already have a CivPMS account, so the invitation is waiting in their notifications. They join as ${projectRoleLabel(outcome.role)} when they accept.`;
  }
  return outcome.deliveryNote ?? "Copy the invitation link and share it yourself.";
}

/**
 * "Invite people" (spec §4.4): email + role (PM or Inspector). Afterwards the dialog shows what
 * happened to the email and the invitation link to copy (always available, essential when email
 * could not be sent).
 */
export function InviteDialog({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);
  const form = useForm<InviteInput, unknown, InviteValues>({
    resolver: zodResolver(inviteSchema),
    mode: "onTouched",
    defaultValues: { email: "", role: "inspector" },
  });

  function reset() {
    setOutcome(null);
    form.reset({ email: "", role: form.getValues("role") });
  }

  async function onSubmit(values: InviteValues) {
    const result = await inviteCollaborator({ projectId, email: values.email, role: values.role });
    if (!result.ok) {
      const { fieldErrors, message } = result.error;
      if (fieldErrors?.email) form.setError("email", { message: fieldErrors.email }, { shouldFocus: true });
      else if (fieldErrors?.role) form.setError("role", { message: fieldErrors.role });
      else form.setError("root.serverError", { message });
      return;
    }
    setOutcome(result.data);
    router.refresh();
    if (result.data.delivery !== "not_sent") toast.success(deliveryHeadline(result.data).title);
  }

  const headline = outcome ? deliveryHeadline(outcome) : null;
  const HeadlineIcon = headline?.icon ?? Mail;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button onClick={() => setOpen(true)} className="w-full sm:w-auto">
        <UserPlus aria-hidden />
        Invite people
      </Button>
      <DialogContent size="md" onInteractOutside={(event) => form.formState.isDirty && !outcome && event.preventDefault()}>
        {outcome && headline ? (
          <>
            <DialogHeader>
              <span
                aria-hidden
                className={
                  headline.tone === "success"
                    ? "mb-2 grid size-11 place-items-center rounded-full bg-success-soft text-success-text"
                    : "mb-2 grid size-11 place-items-center rounded-full bg-info-soft text-info-text"
                }
              >
                <HeadlineIcon className="size-5" />
              </span>
              <DialogTitle>{headline.title}</DialogTitle>
              <DialogDescription>{deliveryDetail(outcome)}</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-2">
              <label htmlFor="invite-link" className="text-label text-foreground">
                Invitation link
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="invite-link" readOnly value={outcome.inviteLink} onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
                <Button
                  variant={outcome.delivery === "not_sent" ? "primary" : "outline"}
                  onClick={() => copyToClipboard(outcome.inviteLink, "Invite link copied")}
                  className="shrink-0"
                >
                  <Copy aria-hidden />
                  Copy invite link
                </Button>
              </div>
              <p className="text-xs leading-4 text-muted-foreground">
                Only {outcome.email} can accept it. Resending the invitation creates a new link.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Invite someone else
              </Button>
              <Button variant={outcome.delivery === "not_sent" ? "outline" : "primary"} onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
              <DialogHeader>
                <DialogTitle>Invite people to {projectName}</DialogTitle>
                <DialogDescription>
                  They get an email with a link. People without an account sign up with that email first.
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-5">
                <FormError>{form.formState.errors.root?.serverError?.message}</FormError>
                <FormField
                  control={form.control}
                  name="email"
                  label="Email address"
                  required
                  render={({ field }) => (
                    <Input
                      {...field}
                      type="email"
                      autoComplete="off"
                      autoFocus
                      leading={<Mail aria-hidden className="size-4" />}
                      placeholder="name@company.com"
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  label="Role on this project"
                  required
                  render={({ field }) => (
                    <RadioGroup value={field.value} onValueChange={field.onChange} aria-label="Role on this project" className="grid gap-3">
                      <ChoiceCard
                        value="inspector"
                        icon={<HardHat />}
                        title="Inspector / QA / QC"
                        description="Views the plan and updates progress. Can't change the plan, budget or team."
                      />
                      <ChoiceCard
                        value="pm"
                        icon={<UserPlus />}
                        title="Project Manager"
                        description="Plans the work, edits the budget and dates, and manages the team."
                      />
                    </RadioGroup>
                  )}
                />
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={form.formState.isSubmitting} loadingText="Sending…">
                  <Mail aria-hidden />
                  Send invitation
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
