"use client";

import { HomeShell } from "@/components/shell/home-shell";
import { RealtimeStatus } from "./realtime-status";
import { HomeGreeting } from "./shell-leading";
import type { ShellData } from "./types";
import { useConnectedShell } from "./use-connected-shell";

export type HomeShellClientProps = {
  data: ShellData;
  children: React.ReactNode;
};

/** Top-bar frame for "/", profile, settings and notifications, wired to live data. */
export function HomeShellClient({ data, children }: HomeShellClientProps) {
  const shell = useConnectedShell(data);
  return (
    <>
      <HomeShell
        topBar={{
          leading: <HomeGreeting companyName={data.viewer.company?.name ?? null} firstName={data.viewer.firstName} />,
          notifications: shell.notifications,
          user: shell.user,
          searchPlaceholder: shell.searchPlaceholder,
        }}
        palette={shell.palette}
      >
        {children}
      </HomeShell>
      <RealtimeStatus live={shell.live} />
    </>
  );
}
