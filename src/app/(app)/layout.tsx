import { requireOnboarded } from "@/server/context";

/**
 * Authenticated area. No session → /login (also enforced by src/proxy.ts); onboarding not
 * finished → /onboarding. Pages re-check (layouts render in parallel with pages).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireOnboarded();
  return children;
}
