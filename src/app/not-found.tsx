import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";
import { StatusPage, StatusPanel } from "@/components/app-shell/status-page";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/** Unmatched URLs and notFound() outside the app shells (spec §17.2: friendly 404 with a way back). */
export default function NotFound() {
  return (
    <StatusPage>
      <StatusPanel
        eyebrow="Error 404"
        icon={<Compass />}
        title="We couldn't find that page"
        description="The link may be broken or the page may have moved. Check the address, or go back to your projects."
        actions={
          <Button asChild>
            <Link href="/">Back to projects</Link>
          </Button>
        }
      />
    </StatusPage>
  );
}
