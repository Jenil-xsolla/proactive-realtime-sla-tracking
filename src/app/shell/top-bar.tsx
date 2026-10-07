import { Chip } from "@/ui";
import { WindowSelect } from "../dashboard/window-select";
import type { ShellFrame } from "./shell";

export function TopBar({ frame, breadcrumb }: { frame: ShellFrame; breadcrumb: { label: string; href?: string }[] }) {
  const chip = <Chip tone={frame.chip.tone}>{frame.chip.label}</Chip>;
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
        <WindowSelect months={frame.months} title={frame.windowTitle} phase={frame.phase} />
        <p className="font-mono text-xs tabular-nums text-muted-foreground">as of {frame.asOfLabel}</p>
        {frame.chip.href === null ? chip : <a href={frame.chip.href} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{chip}</a>}
      </div>
    </header>
  );
}
