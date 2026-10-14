/**
 * A quick, local password-strength hint for the sign-up and reset forms. It only guides people;
 * the rule that is enforced is the length (PASSWORD_MIN_LENGTH, also checked by Supabase Auth,
 * which may reject leaked passwords too).
 */
import { PASSWORD_MIN_LENGTH } from "@/lib/constants";

export type PasswordStrength = {
  /** 0 = empty, 1 = too short, 2 = fair, 3 = good, 4 = strong. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** What to do next, in plain language. */
  hint: string;
  tone: "neutral" | "danger" | "warning" | "success";
};

const COMMON = [
  "password",
  "qwerty",
  "letmein",
  "welcome",
  "admin",
  "civpms",
  "iloveyou",
  "abc123",
  "123456",
  "monkey",
  "dragon",
];

function isMostlyRepeatedOrSequential(value: string): boolean {
  const lower = value.toLowerCase();
  if (new Set(lower).size <= 3) return true;
  let runs = 0;
  for (let i = 1; i < lower.length; i++) {
    const diff = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (diff === 1 || diff === -1 || diff === 0) runs++;
  }
  return runs >= lower.length * 0.7;
}

export function passwordStrength(password: string): PasswordStrength {
  if (!password) {
    return {
      score: 0,
      label: "",
      hint: `Use at least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easy to remember.`,
      tone: "neutral",
    };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    const missing = PASSWORD_MIN_LENGTH - password.length;
    return {
      score: 1,
      label: "Too short",
      hint: `Add ${missing} more character${missing === 1 ? "" : "s"}.`,
      tone: "danger",
    };
  }

  const lower = password.toLowerCase();
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const weakPattern = COMMON.some((word) => lower.includes(word)) || isMostlyRepeatedOrSequential(password);

  if (weakPattern) {
    return {
      score: 2,
      label: "Easy to guess",
      hint: "Avoid common words and patterns like 123456. Try a few unrelated words.",
      tone: "warning",
    };
  }
  if (password.length >= 16 || (password.length >= 12 && variety >= 3)) {
    return { score: 4, label: "Strong", hint: "Great password.", tone: "success" };
  }
  if (variety >= 2) {
    return {
      score: 3,
      label: "Good",
      hint: "Good. Make it longer or add a symbol to make it even stronger.",
      tone: "success",
    };
  }
  return {
    score: 2,
    label: "Fair",
    hint: "Mix in capitals, numbers or symbols, or make it longer.",
    tone: "warning",
  };
}
