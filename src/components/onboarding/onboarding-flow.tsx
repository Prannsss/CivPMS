"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ClipboardCheck, HardHat, KeyRound, UserRound } from "lucide-react";
import { greetingName } from "@/components/app-shell/greeting-name";
import { InviteCodeForm } from "@/components/invitations/invite-code-form";
import { PendingInvitations, type PendingInvitation } from "@/components/invitations/pending-invitations";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ChoiceCard, RadioGroup } from "@/components/ui/radio-group";
import { toast } from "@/components/ui/toaster";
import { HOME_PATH } from "@/lib/auth-routes";
import { companyNameSchema, fullNameSchema } from "@/lib/domain/schemas";
import { createCompany, finishOnboardingWithoutCompany, saveOnboardingProfile } from "@/server/actions/onboarding";
import { AuthDivider } from "@/components/auth/auth-frame";
import { CompanyNameField, COMPANY_TAKEN_MESSAGE, useCompanyNameAvailability } from "./company-name-field";
import { useOnboardingPreview, type OnboardingRoleChoice } from "./onboarding-preview";
import { StepProgress } from "./step-progress";

type Step = 1 | 2 | 3;

export type OnboardingFlowProps = {
  email: string;
  initialName: string;
  initialRole: OnboardingRoleChoice | null;
  /** Name and role were already saved (e.g. the visitor left on step 3): start there. */
  profileSaved: boolean;
  invitations: ReadonlyArray<PendingInvitation>;
  /** Safe path to open when onboarding is done (defaults to home). */
  next: string | null;
};

const ROLE_COPY = {
  pm: {
    title: "Project Manager",
    description: "Plan projects, budgets and schedules, and invite your team. You'll set up your company next.",
  },
  inspector: {
    title: "Inspector / QA / QC",
    description:
      "Update progress and run inspections on site. You'll join your team with an invite code or invitation.",
  },
} as const;

function firstError(result: { success: true } | { success: false; error: { issues: { message: string }[] } }) {
  return result.success ? null : (result.error.issues[0]?.message ?? null);
}

/**
 * Onboarding (mockup 5, spec §4.1–4.3, D10–D12): 1 name → 2 role → 3 company (PM) or join (inspector).
 * Back keeps everything typed; the name and role are saved when leaving step 2.
 */
export function OnboardingFlow({
  email,
  initialName,
  initialRole,
  profileSaved,
  invitations,
  next,
}: OnboardingFlowProps) {
  const router = useRouter();
  const setPreview = useOnboardingPreview();
  const [step, setStep] = useState<Step>(profileSaved && initialRole ? 3 : 1);
  const [name, setName] = useState(initialName);
  const [nameTouched, setNameTouched] = useState(false);
  const [role, setRole] = useState<OnboardingRoleChoice | null>(initialRole);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; role: OnboardingRoleChoice } | null>(
    profileSaved && initialRole ? { name: initialName, role: initialRole } : null,
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const availability = useCompanyNameAvailability(companyName);
  const destination = next ?? HOME_PATH;

  useEffect(() => {
    setPreview({ step, name, role, companyName });
  }, [setPreview, step, name, role, companyName]);

  // Move focus to the new step's heading so keyboard and screen-reader users follow along.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const nameError = firstError(fullNameSchema.safeParse(name));

  function continueFromName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The input is uncontrolled so text typed before hydration survives: read it from the form.
    const field = event.currentTarget.elements.namedItem("fullName");
    const typed = field instanceof HTMLInputElement ? field.value : name;
    setName(typed);
    setNameTouched(true);
    if (firstError(fullNameSchema.safeParse(typed))) return;
    setStep(2);
  }

  async function continueFromRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role) {
      setRoleError("Choose your role: Project Manager or Inspector / QA / QC.");
      return;
    }
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (saved && saved.name === cleanName && saved.role === role) {
      setStep(3);
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    const result = await saveOnboardingProfile({ fullName: cleanName, role });
    setSavingProfile(false);
    if (!result.ok) {
      if (result.error.fieldErrors?.fullName) {
        setNameTouched(true);
        setStep(1);
        toast.error("Check your name", { description: result.error.fieldErrors.fullName });
        return;
      }
      setProfileError(result.error.fieldErrors?.role ?? result.error.message);
      return;
    }
    setSaved({ name: result.data.fullName, role: result.data.role });
    setName(result.data.fullName);
    setStep(3);
  }

  async function submitCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = companyNameSchema.safeParse(companyName);
    if (!parsed.success) {
      setCompanyError(parsed.error.issues[0]?.message ?? "Enter your company name.");
      return;
    }
    if (availability.state === "taken") {
      setCompanyError(COMPANY_TAKEN_MESSAGE);
      return;
    }
    setCreating(true);
    setCompanyError(null);
    const result = await createCompany({ name: parsed.data });
    if (!result.ok) {
      setCreating(false);
      setCompanyError(result.error.fieldErrors?.name ?? result.error.message);
      return;
    }
    setDone(true);
    toast.success(`Welcome to CivPMS, ${greetingName(name)}!`, {
      description: `${result.data.companyName} is ready. Create your first project to get started.`,
      duration: 8000,
    });
    router.replace(destination);
    router.refresh();
  }

  async function finishWithoutCompany() {
    setFinishing(true);
    const result = await finishOnboardingWithoutCompany();
    if (!result.ok) {
      setFinishing(false);
      toast.error("Couldn't finish setting up", { description: result.error.message });
      return;
    }
    setDone(true);
    toast.success("You're all set", {
      description: `When your Project Manager invites ${email}, the invitation shows up on your home screen.`,
      duration: 8000,
    });
    router.replace(HOME_PATH);
    router.refresh();
  }

  const stepLabels = ["Your name", "Your role", role === "inspector" ? "Join your team" : "Your company"] as const;
  const busy = done || creating || finishing;

  const heading = (title: string, description: React.ReactNode) => (
    <div className="flex flex-col gap-2">
      <h1 ref={headingRef} tabIndex={-1} className="text-display text-balance text-foreground outline-none">
        {title}
      </h1>
      <p className="text-body-lg text-pretty text-muted-foreground">{description}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-8" data-testid="onboarding">
      <StepProgress current={step} labels={stepLabels} />

      {step === 1 ? (
        <form onSubmit={continueFromName} noValidate className="flex flex-col gap-8" aria-label="Your name">
          {heading(
            initialName ? "Is this your name?" : "What's your name?",
            "Your team sees it on projects, progress updates and inspections.",
          )}
          <Field
            label="Full name"
            required
            error={nameTouched && nameError ? nameError : undefined}
            hint="Include your title if you like, e.g. Engr. Juan Dela Cruz."
          >
            <Input
              name="fullName"
              defaultValue={name}
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
          <Button type="submit" size="lg" className="w-full sm:w-auto sm:self-end">
            Continue
            <ArrowRight aria-hidden />
          </Button>
        </form>
      ) : null}

      {step === 2 ? (
        <form onSubmit={continueFromRole} noValidate className="flex flex-col gap-8" aria-label="Your role">
          {heading(
            "What's your role?",
            `Nice to meet you, ${greetingName(name)}. Your role decides what you set up next.`,
          )}
          <div className="flex flex-col gap-2">
            <RadioGroup
              value={role ?? ""}
              onValueChange={(value) => {
                setRole(value === "pm" ? "pm" : "inspector");
                setRoleError(null);
              }}
              aria-label="Your role"
              aria-describedby={roleError ? "role-error" : undefined}
              className="grid gap-3"
            >
              <ChoiceCard value="pm" icon={<HardHat />} {...ROLE_COPY.pm} />
              <ChoiceCard value="inspector" icon={<ClipboardCheck />} {...ROLE_COPY.inspector} />
            </RadioGroup>
            {roleError ? (
              <p id="role-error" role="alert" className="text-xs leading-4 font-medium text-danger-text">
                {roleError}
              </p>
            ) : null}
          </div>
          {profileError ? <FormError>{profileError}</FormError> : null}
          <StepButtons onBack={() => setStep(1)} backDisabled={savingProfile}>
            <Button type="submit" size="lg" loading={savingProfile} loadingText="Saving…" className="w-full sm:w-auto">
              Continue
              <ArrowRight aria-hidden />
            </Button>
          </StepButtons>
        </form>
      ) : null}

      {step === 3 && role === "pm" ? (
        <div className="flex flex-col gap-8">
          {heading(
            invitations.length > 0 ? "Join a team or start your company" : "Set up your company",
            invitations.length > 0
              ? "You've been invited to a project. Accept to join that company, or create your own."
              : "You'll be its Owner PM. Projects, people and settings live under your company.",
          )}
          {invitations.length > 0 ? (
            <>
              <PendingInvitations
                invitations={invitations}
                heading="You've been invited"
                description="Accept to join the company and open the project."
                onAccepted={() => setDone(true)}
              />
              <AuthDivider label="or create your own company" />
            </>
          ) : null}
          <form onSubmit={submitCompany} noValidate className="flex flex-col gap-6" aria-label="Create your company">
            <CompanyNameField
              value={companyName}
              onChange={(value) => {
                setCompanyName(value);
                setCompanyError(null);
              }}
              availability={availability}
              error={companyError}
              disabled={busy}
              autoFocus={invitations.length === 0}
            />
            <StepButtons onBack={() => setStep(2)} backDisabled={busy}>
              <Button
                type="submit"
                size="lg"
                variant={invitations.length > 0 ? "outline" : "primary"}
                loading={creating || (done && !finishing)}
                loadingText="Creating your company…"
                className="w-full sm:w-auto"
              >
                Create company
              </Button>
            </StepButtons>
          </form>
        </div>
      ) : null}

      {step === 3 && role === "inspector" ? (
        <div className="flex flex-col gap-8">
          {heading(
            "Join your team",
            "Inspectors, QA and QC join the company their Project Manager set up, with an invitation or an invite code.",
          )}
          <PendingInvitations
            invitations={invitations}
            heading="Invitations for you"
            description="Accept to join the company and open the project."
            onAccepted={() => setDone(true)}
          />
          <section
            aria-labelledby="invite-code-heading"
            className="flex flex-col gap-5 rounded-lg border border-border bg-surface-muted p-5 sm:p-6"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-foreground shadow-xs ring-1 ring-border"
              >
                <KeyRound className="size-5" />
              </span>
              <div className="flex flex-col">
                <h2 id="invite-code-heading" className="text-h3 text-foreground">
                  Have an invite code?
                </h2>
                <p className="text-[13px] leading-5 text-muted-foreground">
                  It joins you to the whole company or to one project.
                </p>
              </div>
            </div>
            <InviteCodeForm
              submitVariant={invitations.length > 0 ? "outline" : "primary"}
              onJoined={() => setDone(true)}
              autoFocus={invitations.length === 0}
            />
          </section>
          <div className="flex flex-col-reverse gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" size="lg" onClick={() => setStep(2)} disabled={busy} className="sm:-ml-4">
              <ArrowLeft aria-hidden />
              Back
            </Button>
            <div className="flex flex-col items-center gap-1 text-center sm:items-end sm:text-right">
              <Button
                variant="link"
                onClick={finishWithoutCompany}
                loading={finishing}
                loadingText="Finishing…"
                disabled={busy && !finishing}
                className="text-sm font-semibold"
              >
                I don&apos;t have a code yet
              </Button>
              <p className="text-caption text-muted-foreground">You can join a company later from your home screen.</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Back (ghost) on the left, the step's primary action on the right; stacked on phones. */
function StepButtons({
  onBack,
  backDisabled,
  children,
}: {
  onBack: () => void;
  backDisabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="ghost" size="lg" onClick={onBack} disabled={backDisabled} className="sm:-ml-4">
        <ArrowLeft aria-hidden />
        Back
      </Button>
      {children}
    </div>
  );
}
