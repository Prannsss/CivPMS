import { ConnectedHomeShell } from "@/components/app-shell/connected-shells";

/** Top-bar shell for "/", profile, company settings and notifications (mockups 6–7). */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <ConnectedHomeShell>{children}</ConnectedHomeShell>;
}
