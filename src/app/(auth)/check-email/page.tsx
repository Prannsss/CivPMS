import type { Metadata } from "next";
import { cleanNext, emailParam, firstParam } from "@/components/auth/auth-flow";
import { CheckEmailPanel } from "@/components/auth/check-email-panel";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: PageProps<"/check-email">) {
  const params = await searchParams;
  const email = emailParam(params.email);
  return (
    <CheckEmailPanel
      email={email || null}
      type={firstParam(params.type) === "recovery" ? "recovery" : "signup"}
      next={cleanNext(firstParam(params.next))}
    />
  );
}
