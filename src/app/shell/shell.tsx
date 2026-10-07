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
  chip: { label: string; tone: "neutral" | "warning" | "danger"; href: string | null };
};

/** Sidebar and top bar around every page. Below lg the sidebar stacks above the content. */
export function Shell({
  nav,
  frame,
  breadcrumb,
  children,
}: {
  nav: NavModel;
  frame: ShellFrame;
  breadcrumb: { label: string; href?: string }[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <Sidebar nav={nav} />
      <div className="flex min-w-0 flex-col">
        <TopBar frame={frame} breadcrumb={breadcrumb} />
        <main className="mx-auto flex w-full min-w-0 max-w-[90rem] flex-col gap-10 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
