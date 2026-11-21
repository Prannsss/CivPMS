/**
 * Re-mounted on every navigation between pages of the top-bar shell, so each page fades in.
 * Opacity only: a transform here would briefly become the containing block of `position: fixed`
 * descendants. The shell itself (top bar) lives in the layout and does not animate.
 */
export default function HomeTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
