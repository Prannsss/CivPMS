import { LogOut } from "lucide-react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { OnboardingAside, OnboardingPreviewProvider } from "@/components/onboarding/onboarding-preview";
import { Button } from "@/components/ui/button";
import { getSessionContext } from "@/server/context";

/** POST-only sign-out route (src/app/auth/signout/route.ts). */
const SIGN_OUT_PATH = "/auth/signout";

/** Mockup 5: the auth split layout, with a live preview of the workspace in the brand panel. */
export default async function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  const { user } = await getSessionContext();
  return (
    <OnboardingPreviewProvider>
      <AuthFrame
        width="wide"
        aside={<OnboardingAside />}
        headerAside={
          user ? (
            <form action={SIGN_OUT_PATH} method="post" className="flex min-w-0 items-center gap-2">
              {user.email ? (
                <span className="hidden max-w-56 truncate text-[13px] text-muted-foreground md:inline" title={user.email}>
                  {user.email}
                </span>
              ) : null}
              <Button type="submit" variant="ghost" size="sm" className="max-sm:h-11">
                <LogOut aria-hidden />
                Sign out
              </Button>
            </form>
          ) : null
        }
      >
        {children}
      </AuthFrame>
    </OnboardingPreviewProvider>
  );
}
