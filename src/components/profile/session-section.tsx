import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "./settings-layout";

/** Sign out of this browser (POST to /auth/signout, which answers with a redirect to /login). */
export function SessionSection({ email }: { email: string }) {
  return (
    <SettingsCard id="session" title="Sign out" description={`Signed in as ${email}.`}>
      <form action="/auth/signout" method="post" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-muted-foreground">Ends your session in this browser only.</p>
        <Button type="submit" variant="danger-outline" className="shrink-0">
          <LogOut aria-hidden />
          Sign out
        </Button>
      </form>
    </SettingsCard>
  );
}
