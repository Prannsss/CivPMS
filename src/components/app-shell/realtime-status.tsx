/**
 * Invisible marker of the bell's Realtime state (`data-state="live"` once subscribed). Lets e2e
 * tests wait for the subscription before they create notifications; users never see it.
 */
export function RealtimeStatus({ live }: { live: boolean }) {
  return <span hidden data-testid="notifications-realtime" data-state={live ? "live" : "connecting"} />;
}
