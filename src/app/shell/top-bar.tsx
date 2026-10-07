import { BUSINESS_VIEW, ENGINEER_VIEW } from "../dashboard/copy";
import { WindowSelect } from "../dashboard/window-select";
import type { ShellFrame } from "./shell";

export function TopBar({
  frame,
  breadcrumb,
  showWindow = true,
}: {
  frame: ShellFrame;
  breadcrumb: { label: string; href?: string }[];
  showWindow?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-8 py-4">
      <ol className="flex items-center gap-2 text-sm">
        {breadcrumb.map((crumb, index) => (
          <li key={`${crumb.label}:${index}`} className="flex items-center gap-2">
            {index > 0 ? <span className="text-muted-foreground">›</span> : null}
            {crumb.href === undefined ? (
              <span className="text-foreground">{crumb.label}</span>
            ) : (
              <a href={crumb.href} className="text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                {crumb.label}
              </a>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {showWindow ? <WindowSelect months={frame.months} title={frame.windowTitle} phase={frame.phase} /> : null}
        <p className="font-mono text-xs tabular-nums text-muted-foreground">as of {frame.asOfLabel}</p>
        <ViewToggle active={frame.view.active} />
      </div>
    </header>
  );
}

const SEGMENT = "rounded border px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
const SEGMENT_ACTIVE = "border-primary bg-secondary text-foreground";
const SEGMENT_INACTIVE = "border-border text-muted-foreground hover:bg-muted";

/** Plain links to the route that sets the view cookie; no client code. */
function ViewToggle({ active }: { active: "technical" | "business" }) {
  const segments = [
    { role: "technical", label: ENGINEER_VIEW },
    { role: "business", label: BUSINESS_VIEW },
  ] as const;
  return (
    <nav aria-label="View" className="flex items-center gap-1">
      {segments.map((segment) => (
        <a
          key={segment.role}
          href={`/view/${segment.role}`}
          aria-current={active === segment.role ? "page" : undefined}
          className={`${SEGMENT} ${active === segment.role ? SEGMENT_ACTIVE : SEGMENT_INACTIVE}`}
        >
          {segment.label}
        </a>
      ))}
    </nav>
  );
}
