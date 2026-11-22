/**
 * Re-mounted on every navigation between project tabs, so each tab fades in while the sidebar and
 * top bar (in the layout) stay put. Opacity only, see `(home)/template.tsx`.
 */
export default function ProjectTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
