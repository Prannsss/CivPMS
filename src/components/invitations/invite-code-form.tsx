"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, FolderKanban, KeyRound, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { companyRoleLabel } from "@/lib/domain/permissions";
import { inviteCodeSchema } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import {
  previewInviteCode,
  redeemInviteCode,
  type InviteCodePreview,
  type JoinResult,
} from "@/server/actions/invitations-incoming";
import { formatInviteCodeInput } from "./invite-code-input";

function validate(value: string): { code: string } | { error: string } {
  const parsed = inviteCodeSchema.safeParse(value);
  if (parsed.success) return { code: parsed.data };
  return { error: parsed.error.issues[0]?.message ?? "Enter your invite code." };
}

export type InviteCodeFormProps = {
  /** Called after joining (before navigating). */
  onJoined?: (result: JoinResult) => void;
  /** Go to the project (project codes) or home after joining. Default true. */
  redirectOnJoin?: boolean;
  autoFocus?: boolean;
  label?: string;
  hint?: string;
  /** Use `outline` when another primary action shares the screen (e.g. pending invitations). */
  submitVariant?: "primary" | "outline";
  className?: string;
};

/**
 * Join a company with an invite code (D11): type or paste `XXXX-XXXX`, check it, see
 * "Join <Company> · <Project>?", then join as an inspector. Errors explain what to do next,
 * including the rate limit (10 wrong codes per hour).
 */
export function InviteCodeForm({
  onJoined,
  redirectOnJoin = true,
  autoFocus = false,
  label = "Invite code",
  hint = "Ask your Project Manager for the 8-character code, like 7KQ2-M9XA.",
  submitVariant = "primary",
  className,
}: InviteCodeFormProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);
  const [joining, setJoining] = useState(false);
  const [preview, setPreview] = useState<InviteCodePreview | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (preview) previewHeadingRef.current?.focus();
  }, [preview]);

  async function check(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    const result = validate(value);
    if ("error" in result) {
      setError(result.error);
      inputRef.current?.focus();
      return;
    }
    setChecking(true);
    setError(null);
    const response = await previewInviteCode({ code: result.code });
    setChecking(false);
    if (!response.ok) {
      setError(response.error.fieldErrors?.code ?? response.error.message);
      inputRef.current?.focus();
      return;
    }
    setValue(response.data.code);
    setPreview(response.data);
  }

  async function join() {
    if (!preview) return;
    setJoining(true);
    const response = await redeemInviteCode({ code: preview.code });
    if (!response.ok) {
      setJoining(false);
      setPreview(null);
      setError(response.error.fieldErrors?.code ?? response.error.message);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    const joined = response.data;
    toast.success(joined.alreadyMember ? `You're already in ${joined.companyName}` : `Welcome to ${joined.companyName}`, {
      description: joined.projectName
        ? `You now have access to ${joined.projectName}.`
        : "Your Project Manager will add you to projects.",
    });
    onJoined?.(joined);
    if (redirectOnJoin) router.push(joined.redirectTo);
    router.refresh();
  }

  function reset() {
    setPreview(null);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.select());
  }

  if (preview) {
    const Icon = preview.projectName ? FolderKanban : Building2;
    return (
      <section aria-labelledby={headingId} aria-live="polite" className={cn("flex flex-col gap-5", className)}>
        <div className="flex items-start gap-4 rounded-lg border border-primary/30 bg-primary-soft/60 p-4 sm:p-5">
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Icon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h3
              id={headingId}
              ref={previewHeadingRef}
              tabIndex={-1}
              className="text-base leading-6 font-semibold tracking-[-0.01em] break-words text-foreground outline-none"
            >
              Join {preview.companyName}
              {preview.projectName ? <span className="text-muted-foreground"> · </span> : null}
              {preview.projectName}?
            </h3>
            <p className="text-sm leading-[1.375rem] text-pretty text-muted-foreground">
              You&apos;ll join as {companyRoleLabel("inspector")}
              {preview.projectName ? <> with access to {preview.projectName}.</> : <>. Your PM adds you to projects.</>} An
              account belongs to one company.
            </p>
            <p className="mt-1 font-mono text-xs leading-4 font-medium tracking-widest text-primary-text tabular-nums">
              Code {preview.code}
            </p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={reset} disabled={joining}>
            <ArrowLeft aria-hidden />
            Use a different code
          </Button>
          <Button onClick={join} loading={joining} loadingText="Joining…">
            <LogIn aria-hidden />
            Join {preview.companyName}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={check} noValidate className={cn("flex flex-col gap-4", className)}>
      <Field label={label} hint={hint} error={touched && error ? error : undefined} required>
        <Input
          ref={inputRef}
          name="code"
          value={value}
          onChange={(event) => {
            setValue(formatInviteCodeInput(event.target.value));
            if (error) setError(null);
          }}
          onBlur={() => {
            if (!value) return;
            setTouched(true);
            const result = validate(value);
            setError("error" in result ? result.error : null);
          }}
          leading={<KeyRound />}
          placeholder="ABCD-2345"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={9}
          autoFocus={autoFocus}
          className="font-mono text-base tracking-[0.12em] uppercase placeholder:tracking-[0.12em] sm:text-[15px]"
        />
      </Field>
      <Button type="submit" variant={submitVariant} loading={checking} loadingText="Checking…" className="w-full sm:w-auto sm:self-start">
        Check code
      </Button>
    </form>
  );
}
