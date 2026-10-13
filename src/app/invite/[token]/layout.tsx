import { AuthFrame } from "@/components/auth/auth-frame";

/** The invitation landing uses the auth split layout (it is often a new user's first CivPMS page). */
export default function InviteLayout({ children }: LayoutProps<"/invite/[token]">) {
  return <AuthFrame width="wide">{children}</AuthFrame>;
}
