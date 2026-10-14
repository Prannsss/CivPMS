import { AuthFrame } from "@/components/auth/auth-frame";

/** Split layout for log in, sign up and the password screens (mockups 3–4, D32). */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <AuthFrame>{children}</AuthFrame>;
}
