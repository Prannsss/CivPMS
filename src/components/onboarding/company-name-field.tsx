"use client";

import { useEffect, useState } from "react";
import { Building2, CircleCheck, CircleX } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { companyNameSchema } from "@/lib/domain/schemas";
import { checkCompanyName } from "@/server/actions/onboarding";

export type Availability =
  | { state: "idle" }
  | { state: "checking"; name: string }
  | { state: "available"; name: string }
  | { state: "taken"; name: string }
  | { state: "unknown"; name: string };

const DEBOUNCE_MS = 450;
export const COMPANY_TAKEN_MESSAGE = "A company with this name already exists. Ask its Owner PM to invite you.";

/** Normalises like the database does for uniqueness (case and spaces). */
function keyOf(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

type CheckResult = { key: string; name: string; state: "available" | "taken" | "unknown" };

/**
 * Debounced `company_name_available` check for a typed name. Only the answer for the current
 * name counts, so slow responses for older input are ignored.
 */
export function useCompanyNameAvailability(value: string): Availability {
  const parsed = companyNameSchema.safeParse(value);
  const candidate = parsed.success ? parsed.data : null;
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    if (!candidate) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const response = await checkCompanyName({ name: candidate });
      if (cancelled) return;
      setResult({
        key: keyOf(candidate),
        name: candidate,
        state: !response.ok ? "unknown" : response.data.available ? "available" : "taken",
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [candidate]);

  if (!candidate) return { state: "idle" };
  if (result && result.key === keyOf(candidate)) return { state: result.state, name: result.name };
  return { state: "checking", name: candidate };
}

export type CompanyNameFieldProps = {
  value: string;
  onChange: (value: string) => void;
  availability: Availability;
  /** Error from submit (validation or COMPANY_NAME_TAKEN from the server). */
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
};

/**
 * Company name with live availability: "Checking…", "<name> is available" or the taken message
 * from spec §4.2. The final word is still `create_company`.
 */
export function CompanyNameField({ value, onChange, availability, error, disabled, autoFocus }: CompanyNameFieldProps) {
  const [touched, setTouched] = useState(false);
  const parsed = companyNameSchema.safeParse(value);
  const formatError = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  const taken = availability.state === "taken";
  const shownError = error ?? (taken ? COMPANY_TAKEN_MESSAGE : touched && value.trim() ? formatError : null);

  let status: React.ReactNode = "Your team sees this on every screen. Each company name can be used once.";
  if (availability.state === "checking") {
    status = (
      <span className="inline-flex items-center gap-1.5">
        <Spinner size="xs" label={null} /> Checking availability…
      </span>
    );
  } else if (availability.state === "available") {
    status = (
      <span className="inline-flex items-center gap-1.5 font-medium text-success-text">
        <CircleCheck aria-hidden className="size-3.5 shrink-0" /> {availability.name} is available
      </span>
    );
  }

  return (
    <Field label="Company name" required error={shownError ?? undefined} hint={status}>
      <Input
        name="companyName"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setTouched(true)}
        placeholder="e.g. Dela Cruz Builders"
        autoComplete="organization"
        maxLength={100}
        leading={<Building2 />}
        trailing={
          taken ? (
            <CircleX aria-hidden className="mr-2.5 size-4 text-danger-text" />
          ) : availability.state === "available" ? (
            <CircleCheck aria-hidden className="mr-2.5 size-4 text-success-text" />
          ) : null
        }
        disabled={disabled}
        autoFocus={autoFocus}
        data-testid="company-name"
      />
      <span role="status" className="sr-only">
        {availability.state === "available" ? `${availability.name} is available.` : taken ? "That company name is taken." : ""}
      </span>
    </Field>
  );
}
