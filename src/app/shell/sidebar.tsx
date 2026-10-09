import { StatusDot } from "@/ui";
import type { Badge, NavModel } from "../dashboard/nav";
import { withWindow } from "../dashboard/nav";

function BadgeMark({ badge }: { badge: Badge }) {
  if (badge === null) return null;
  if ("status" in badge) {
    return <span className="rounded border border-danger px-2 font-mono text-xs text-danger">!</span>;
  }
  const tone = badge.count > 0 ? "border-warning text-warning" : "border-border text-muted-foreground";
  return <span className={`rounded border px-2 font-mono text-xs ${tone}`}>{badge.count}</span>;
}

function NavLink({ href, label, active, badge }: { href: string; label: string; active: boolean; badge?: Badge }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between gap-3 border-l-2 px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
        active ? "border-primary bg-secondary text-foreground" : "border-transparent text-foreground hover:bg-muted"
      }`}
    >
      <span>{label}</span>
      {badge === undefined ? null : <BadgeMark badge={badge} />}
    </a>
  );
}

export function Sidebar({ nav }: { nav: NavModel }) {
  const active = nav.active;
  return (
    <nav aria-label="Dashboard" className="flex h-full flex-col gap-6 border-r border-border bg-sidebar py-5">
      <div className="px-4">
        <p className="text-base font-semibold tracking-tight text-foreground">SLA tracking</p>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Partner operations</p>
      </div>
      <div className="flex flex-col">
        <NavLink href={withWindow("/", nav.windowKey)} label="Overview" active={active.kind === "overview"} />
        {nav.role === "technical" ? (
          <>
            <NavLink href={withWindow("/alerts", nav.windowKey)} label="Alerts" active={active.kind === "alerts"} badge={nav.alerts} />
            <NavLink href="/health" label="Health" active={active.kind === "health"} badge={nav.health} />
          </>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <p className="px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Partners</p>
        <ul className="flex flex-col">
          {nav.partners.map((partner) => {
            const current = active.kind === "partner" && active.id === partner.id;
            return (
              <li key={partner.id}>
                <a
                  href={partner.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex items-center gap-3 border-l-2 px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                    current ? "border-primary bg-secondary" : "border-transparent hover:bg-muted"
                  } ${partner.tone === "tracking" || partner.tone === "unknown" ? "text-muted-foreground" : "text-foreground"}`}
                >
                  {partner.tone === "unknown" ? null : <StatusDot tone={partner.tone} />}
                  <span className="flex-1">{partner.name}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
