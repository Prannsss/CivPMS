import { cn } from "@/lib/utils";
import { passwordStrength } from "./password-strength";

const segmentTone = {
  neutral: "bg-border-strong",
  danger: "bg-danger",
  warning: "bg-warning",
  success: "bg-success",
} as const;

const labelTone = {
  neutral: "text-muted-foreground",
  danger: "text-danger-text",
  warning: "text-warning-text",
  success: "text-success-text",
} as const;

/**
 * Four-segment strength bar + label + what to do next. Rendered as the password field's hint, so
 * it is announced through aria-describedby (the label is text, never color alone).
 */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const strength = passwordStrength(password);
  return (
    <span className="flex flex-col gap-1.5" data-testid="password-strength" data-score={strength.score}>
      <span aria-hidden className="grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1 rounded-full transition-colors duration-200",
              strength.score >= step ? segmentTone[strength.tone] : "bg-border",
            )}
          />
        ))}
      </span>
      <span>
        {strength.label ? (
          <span className={cn("font-semibold", labelTone[strength.tone])}>{strength.label}. </span>
        ) : null}
        {strength.hint}
      </span>
    </span>
  );
}
