"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  CircleCheck,
  FolderKanban,
  LogIn,
  Mail,
  MailX,
  TimerOff,
  TriangleAlert,
  UserPlus,
  UserRound,
  UserRoundX,
} from "lucide-react";
import { greetingName } from "@/components/app-shell/greeting-name";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { LOGIN_PATH, HOME_PATH, ONBOARDING_PATH } from "@/lib/auth-routes";
import { diffDays, todayInManila } from "@/lib/domain/dates";
import { formatDate, pluralize } from "@/lib/domain/format";
import { projectRoleLabel } from "@/lib/domain/permissions";
import { fullNameSchema } from "@/lib/domain/schemas";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { acceptInvitation, declineInvitation } from "@/server/actions/invitations-incoming";
import { saveOnboardingProfile } from "@/server/actions/onboarding";
import type { InvitationPreview } from "@/server/queries/onboarding";
import { authPagePath, matchesEmailHint, SIGNUP_PATH } from "./auth-flow";

export type InviteViewer = {
  email: string | null;
  fullName: string;
  onboarded: boolean;
  /** The company the viewer already belongs to, if any. */
  companyName: string | null;
} | null;

export type InviteLandingProps = {
  token: string;
  invitation: InvitationPreview;
  viewer: InviteViewer;
};

const noopSubscribe = () => () => {};

function useToday(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => todayInManila(),
    () => null,
  );
}

function expiryLabel(expiresAt: string | null, today: string | null): string {
  if (!expiresAt) return "No expiry";
  const date = todayInManila(new Date(expiresAt));
  const absolute = formatDate(date);
  if (!today) return absolute;
  const days = diffDays(date, today);
  if (days < 0) return `Expired ${absolute}`;
  if (days === 0) return `Today · ${absolute}`;
  if (days === 1) return `Tomorrow · ${absolute}`;
  return `In ${pluralize(days, "day")} · ${absolute}`;
}

/**
 * The email-invitation landing page (spec §4.4): what the invitation is for, then the right next
 * step for the visitor: sign in / create an account, accept / decline, switch account, or a clear
 * message when the invitation can no longer be used.
 */
export function InviteLanding({ token, invitation, viewer }: InviteLandingProps) {
  const today = useToday();
  const [declined, setDeclined] = useState(false);
  const invitePath = `/invite/${token}`;
  const roleLabel = projectRoleLabel(invitation.role);

  const usable = invitation.status === "pending" && invitation.projectAvailable && !declined;

  return (
    <div
      className="flex flex-col gap-8"
      data-testid="invite-landing"
      data-status={declined ? "declined" : invitation.status}
    >
      <div className="flex flex-col gap-2">
        <p className="inline-flex items-center gap-2 text-[13px] leading-5 font-semibold tracking-wide text-primary-text uppercase">
          <Mail aria-hidden className="size-4" />
          Project invitation
        </p>
        <h1 className="text-display text-balance break-words text-foreground">
          {usable ? <>Join {invitation.projectName}</> : invitation.projectName || "Project invitation"}
        </h1>
        <p className="text-body-lg text-pretty text-muted-foreground">
          <span className="font-medium text-foreground">{invitation.inviterName}</span> invited you to work with{" "}
          <span className="font-medium text-foreground">{invitation.companyName}</span> as {roleLabel}.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm shadow-xs">
        <Detail wide icon={<Building2 />} label="Company" value={invitation.companyName} />
        <Detail wide icon={<FolderKanban />} label="Project" value={invitation.projectName} />
        <Detail
          icon={<UserRound />}
          label="Your role"
          value={
            <Badge tone={invitation.role === "pm" ? "primary" : "info"} size="sm">
              {roleLabel}
            </Badge>
          }
        />
        <Detail icon={<UserPlus />} label="Invited by" value={invitation.inviterName} />
        <Detail wide icon={<Mail />} label="Sent to" value={<span className="break-all">{invitation.emailHint}</span>} />
        {usable ? (
          <Detail
            wide
            icon={<CalendarClock />}
            label="Expires"
            value={<span className="tabular-nums">{expiryLabel(invitation.expiresAt, today)}</span>}
          />
        ) : (
          <Detail
            wide
            icon={<CalendarClock />}
            label="Status"
            value={
              <InvitationStatusBadge
                status={declined ? "declined" : invitation.status === "pending" ? "revoked" : invitation.status}
              />
            }
          />
        )}
      </dl>

      {declined ? (
        <Outcome
          tone="neutral"
          icon={<MailX />}
          title="Invitation declined"
          description={`We let ${invitation.inviterName} know. To join later, you'll need a new invitation.`}
          action={
            <Button size="lg" className="w-full sm:w-auto" asChild>
              <Link href={viewer?.onboarded ? HOME_PATH : ONBOARDING_PATH}>
                {viewer?.onboarded ? "Go to CivPMS" : "Finish setting up"}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          }
        />
      ) : !invitation.projectAvailable ? (
        <Outcome
          tone="warning"
          icon={<FolderKanban />}
          title="This project is no longer available"
          description={`It was removed after the invitation was sent. Ask ${invitation.inviterName} for a new invitation.`}
          action={<HomeOrLogin viewer={viewer} />}
        />
      ) : invitation.status === "expired" ? (
        <Outcome
          tone="warning"
          icon={<TimerOff />}
          title="This invitation has expired"
          description={`Invitations last 7 days. Ask ${invitation.inviterName} to send you a new one.`}
          action={<HomeOrLogin viewer={viewer} />}
        />
      ) : invitation.status === "accepted" ? (
        <Outcome
          tone="success"
          icon={<CircleCheck />}
          title="This invitation was already accepted"
          description={
            viewer
              ? "If it was you, the project is waiting on your home screen."
              : "If it was you, log in to open the project."
          }
          action={<HomeOrLogin viewer={viewer} next={HOME_PATH} />}
        />
      ) : invitation.status === "declined" || invitation.status === "revoked" ? (
        <Outcome
          tone="neutral"
          icon={<MailX />}
          title={invitation.status === "declined" ? "This invitation was declined" : "This invitation was cancelled"}
          description={`It can't be used anymore. Ask ${invitation.inviterName} for a new invitation if you still need access.`}
          action={<HomeOrLogin viewer={viewer} />}
        />
      ) : !viewer ? (
        <SignedOutActions invitePath={invitePath} emailHint={invitation.emailHint} />
      ) : !matchesEmailHint(viewer.email, invitation.emailHint) ? (
        <WrongAccount invitePath={invitePath} viewerEmail={viewer.email} emailHint={invitation.emailHint} />
      ) : viewer.companyName && viewer.companyName.toLowerCase() !== invitation.companyName.toLowerCase() ? (
        <OtherCompany token={token} invitation={invitation} viewer={viewer} onDeclined={() => setDeclined(true)} />
      ) : (
        <AcceptActions token={token} invitation={invitation} viewer={viewer} onDeclined={() => setDeclined(true)} />
      )}
    </div>
  );
}

const STATUS_BADGES = {
  pending: { tone: "primary", label: "Waiting for you", icon: <Mail /> },
  accepted: { tone: "success", label: "Accepted", icon: <CircleCheck /> },
  declined: { tone: "neutral", label: "Declined", icon: <MailX /> },
  revoked: { tone: "neutral", label: "Cancelled", icon: <MailX /> },
  expired: { tone: "warning", label: "Expired", icon: <TimerOff /> },
} as const;

function InvitationStatusBadge({ status }: { status: InvitationPreview["status"] }) {
  const meta = STATUS_BADGES[status];
  return (
    <Badge tone={meta.tone} size="sm" icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

/** "Acme Inc." stays as is; "Acme" becomes "Acme." (no double period at the end of a sentence). */
function withPeriod(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text : `${text}.`;
}

/** One cell of the details grid (hairline separators come from the grid gap). `wide` spans both columns on phones. */
function Detail({
  icon,
  label,
  value,
  wide = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3 bg-surface p-3.5 sm:p-4", wide && "col-span-2 sm:col-span-1")}>
      <span aria-hidden className="mt-0.5 text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-xs leading-4 text-muted-foreground">{label}</dt>
        <dd className="min-w-0 font-medium break-words text-foreground">{value}</dd>
      </div>
    </div>
  );
}

const outcomeTones = {
  neutral: "bg-surface-sunken text-muted-foreground",
  warning: "bg-warning-soft text-warning-text",
  success: "bg-success-soft text-success-text",
  danger: "bg-danger-soft text-danger-text",
} as const;

function Outcome({
  tone,
  icon,
  title,
  description,
  action,
}: {
  tone: keyof typeof outcomeTones;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section
      role="status"
      aria-labelledby="invite-outcome-title"
      className="flex flex-col gap-5 rounded-lg border border-border bg-surface-muted p-5 sm:p-6"
      data-testid="invite-outcome"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className={cn("grid size-11 shrink-0 place-items-center rounded-xl [&_svg]:size-5", outcomeTones[tone])}
        >
          {icon}
        </span>
        <div className="flex flex-col gap-1">
          <h2 id="invite-outcome-title" className="text-h3 text-foreground">
            {title}
          </h2>
          <p className="text-sm leading-[1.375rem] text-pretty text-muted-foreground">{description}</p>
        </div>
      </div>
      {action ? <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">{action}</div> : null}
    </section>
  );
}

function HomeOrLogin({ viewer, next }: { viewer: InviteViewer; next?: string }) {
  if (viewer) {
    return (
      <Button size="lg" className="w-full sm:w-auto" asChild>
        <Link href={viewer.onboarded ? HOME_PATH : ONBOARDING_PATH}>
          {viewer.onboarded ? "Go to CivPMS" : "Finish setting up"}
          <ArrowRight aria-hidden />
        </Link>
      </Button>
    );
  }
  return (
    <Button size="lg" className="w-full sm:w-auto" asChild>
      <Link href={authPagePath(LOGIN_PATH, { next })}>
        <LogIn aria-hidden />
        Log in
      </Link>
    </Button>
  );
}

function SignedOutActions({ invitePath, emailHint }: { invitePath: string; emailHint: string }) {
  return (
    <section aria-label="Accept the invitation" className="flex flex-col gap-4">
      <p className="text-sm text-pretty text-muted-foreground">
        To accept, log in or create an account with the address the invitation was sent to,{" "}
        <span className="font-medium break-all text-foreground">{emailHint}</span>.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" className="w-full sm:flex-1" asChild>
          <Link href={authPagePath(LOGIN_PATH, { next: invitePath })} data-testid="invite-sign-in">
            <LogIn aria-hidden />
            Log in to accept
          </Link>
        </Button>
        <Button size="lg" variant="outline" className="w-full sm:flex-1" asChild>
          <Link href={authPagePath(SIGNUP_PATH, { next: invitePath })} data-testid="invite-sign-up">
            <UserPlus aria-hidden />
            Create account
          </Link>
        </Button>
      </div>
    </section>
  );
}

function WrongAccount({
  invitePath,
  viewerEmail,
  emailHint,
}: {
  invitePath: string;
  viewerEmail: string | null;
  emailHint: string;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  async function switchAccount() {
    setSwitching(true);
    await createClient()
      .auth.signOut({ scope: "local" })
      .catch(() => undefined);
    router.replace(authPagePath(LOGIN_PATH, { next: invitePath }));
    router.refresh();
  }

  return (
    <Outcome
      tone="warning"
      icon={<UserRoundX />}
      title={`This invitation is for ${emailHint}`}
      description={
        <>
          You&apos;re signed in as{" "}
          <span className="font-medium break-all text-foreground">{viewerEmail ?? "another account"}</span>. Sign out,
          then log in with the invited address to accept it.
        </>
      }
      action={
        <>
          <Button variant="outline" size="lg" className="w-full sm:w-auto" asChild>
            <Link href={HOME_PATH}>Stay signed in</Link>
          </Button>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={switchAccount}
            loading={switching}
            loadingText="Signing out…"
          >
            Switch account
          </Button>
        </>
      }
    />
  );
}

type ActionProps = {
  token: string;
  invitation: InvitationPreview;
  viewer: NonNullable<InviteViewer>;
  onDeclined: () => void;
};

function useDecline({ token, invitation, onDeclined }: Omit<ActionProps, "viewer">) {
  const router = useRouter();
  const confirm = useConfirm();
  const [declining, setDeclining] = useState(false);

  async function decline() {
    const ok = await confirm({
      title: `Decline the invitation to ${invitation.projectName}?`,
      description: `${invitation.inviterName} will be told you declined. To join later, you'll need a new invitation.`,
      tone: "danger",
      confirmLabel: "Decline invitation",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    setDeclining(true);
    const result = await declineInvitation({ token });
    setDeclining(false);
    if (!result.ok) {
      toast.error("Couldn't decline the invitation", { description: result.error.message });
      router.refresh();
      return;
    }
    toast.message("Invitation declined", { description: `${invitation.projectName} · ${invitation.companyName}` });
    onDeclined();
  }

  return { decline, declining };
}

function OtherCompany({ token, invitation, viewer, onDeclined }: ActionProps) {
  const { decline, declining } = useDecline({ token, invitation, onDeclined });
  return (
    <Outcome
      tone="warning"
      icon={<TriangleAlert />}
      title={`You're already part of ${viewer.companyName}`}
      description={`An account belongs to one company, so you can't join ${invitation.companyName} with this account. You can decline the invitation, or ask ${invitation.inviterName} to invite a different email.`}
      action={
        <>
          <Button variant="outline" size="lg" className="w-full sm:w-auto" asChild>
            <Link href={HOME_PATH}>Go to CivPMS</Link>
          </Button>
          <Button
            variant="danger-outline"
            size="lg"
            className="w-full sm:w-auto"
            onClick={decline}
            loading={declining}
            loadingText="Declining…"
          >
            Decline invitation
          </Button>
        </>
      }
    />
  );
}

function AcceptActions({ token, invitation, viewer, onDeclined }: ActionProps) {
  const router = useRouter();
  const { decline, declining } = useDecline({ token, invitation, onDeclined });
  const needsName = !viewer.fullName.trim();
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedName = fullNameSchema.safeParse(name);
  const nameError = parsedName.success ? null : (parsedName.error.issues[0]?.message ?? null);

  async function accept(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    // The name input is uncontrolled so text typed before hydration survives: read it from the form.
    const field = event.currentTarget.elements.namedItem("fullName");
    const typedName = field instanceof HTMLInputElement ? field.value : name;
    const parsedTyped = fullNameSchema.safeParse(typedName);
    if (needsName) {
      setName(typedName);
      setNameTouched(true);
      if (!parsedTyped.success) return;
    }
    setAccepting(true);
    if (needsName && parsedTyped.success) {
      const saved = await saveOnboardingProfile({ fullName: parsedTyped.data, role: invitation.role });
      if (!saved.ok) {
        setAccepting(false);
        setError(saved.error.fieldErrors?.fullName ?? saved.error.message);
        return;
      }
    }
    const result = await acceptInvitation({ token });
    if (!result.ok) {
      setAccepting(false);
      setError(result.error.message);
      return;
    }
    const first = greetingName(needsName && parsedTyped.success ? parsedTyped.data : viewer.fullName);
    toast.success(`Welcome to ${result.data.projectName}, ${first}!`, {
      description: `${result.data.companyName} · ${projectRoleLabel(result.data.role)}`,
      duration: 8000,
    });
    router.replace(result.data.redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={accept} noValidate className="flex flex-col gap-5" aria-label="Accept the invitation">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success-text" />
        <span>
          Signed in as <span className="font-medium break-all text-foreground">{viewer.email}</span>, the invited
          address.
          {viewer.companyName ? null : <> Accepting makes you part of {withPeriod(invitation.companyName)}</>}
        </span>
      </p>
      {needsName ? (
        <Field
          label="Your full name"
          required
          hint="Your team sees it on the project."
          error={nameTouched && nameError ? nameError : undefined}
        >
          <Input
            name="fullName"
            defaultValue=""
            onChange={(event) => setName(event.target.value)}
            onBlur={(event) => {
              setName(event.target.value);
              setNameTouched(true);
            }}
            autoComplete="name"
            placeholder="e.g. Juan Dela Cruz"
            leading={<UserRound />}
            maxLength={100}
            autoFocus
          />
        </Field>
      ) : null}
      {error ? <FormError>{error}</FormError> : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          size="lg"
          className="w-full sm:w-auto"
          onClick={decline}
          disabled={accepting}
          loading={declining}
          loadingText="Declining…"
        >
          Decline
        </Button>
        <Button
          type="submit"
          size="lg"
          className="w-full sm:w-auto"
          loading={accepting}
          loadingText="Joining…"
          disabled={declining}
        >
          <Check aria-hidden />
          Accept and open project
        </Button>
      </div>
    </form>
  );
}
