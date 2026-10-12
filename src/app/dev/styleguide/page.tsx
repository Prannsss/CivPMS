import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Styleguide } from "./_components/styleguide";

export const metadata: Metadata = {
  title: "Styleguide",
  robots: { index: false, follow: false },
};

/** Design-system showcase. Development only — 404 in production builds. */
export default function StyleguidePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Styleguide />;
}
