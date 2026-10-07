import type { ReactNode } from "react";
import type { MonthOption } from "../dashboard/model";
import type { NavModel } from "../dashboard/nav";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

export type ShellFrame = {
  windowKey: string;
  windowTitle: string;
  phase: "open" | "settled";
  months: MonthOption[];
  asOfLabel: string;
  view: { active: "technical" | "business" };
};

/** Sidebar and top bar around every page. Below lg the sidebar stacks above the content. */
export function Shell({
  nav,
  frame,
  breadcrumb,
  showWindow = true,
  children,
}: {
  nav: NavModel;
  frame: ShellFrame;
  breadcrumb: { label: string; href?: string }[];
  /** False on routes that are not windowed; the month picker is then hidden. */
  showWindow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <Sidebar nav={nav} />
      <div className="flex min-w-0 flex-col">
        <TopBar frame={frame} breadcrumb={breadcrumb} showWindow={showWindow} />
        <main className="mx-auto flex w-full min-w-0 max-w-[90rem] flex-col gap-10 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
