import type { AlertStateRow } from "@/data";
import { partnerLabel, serviceLabel } from "@/feed";
import { ALERTS_NOTE, NEVER_ALERTED, alertScopeLabel, alertStatusLabel, formatUtcTimestamp, monthTitle, noAlertsFor } from "./copy";
import type { MonthOption } from "./model";
import { withWindow } from "./nav";
import type { PartnerView } from "./view";

export type AlertRowView = {
  key: string;
  partner: string;
  href: string;
  scope: string;
  month: string;
  status: string;
  statusKind: "badge" | "chip";
  badgeVariant: "warning" | "danger";
  lastAlerted: string;
  alerts: string;
};
export type AlertsView =
  | { state: "error" }
  | {
      state: "ok";
      note: string;
      filter: { label: string; href: string; selected: boolean }[];
      rows: AlertRowView[];
      /** The empty sentence, or null when there are rows. */
      empty: string | null;
    };

export function buildAlertsView(input: {
  alerts: AlertStateRow[] | { status: "error" };
  filterKey: string;
  months: MonthOption[];
  partners: readonly PartnerView[];
}): AlertsView {
  if ("status" in input.alerts) {
    return { state: "error" };
  }
  const titles = new Map<string, string>();
  for (const partner of input.partners) for (const term of partner.terms) titles.set(term.key, term.title);

  const filter = [
    { label: "All months", href: withWindow("/alerts", "all"), selected: input.filterKey === "all" },
    ...input.months.map((month) => ({ label: month.title, href: withWindow("/alerts", month.key), selected: month.key === input.filterKey })),
  ];
  const rows = input.alerts
    .filter((row) => input.filterKey === "all" || row.period === input.filterKey)
    .map((row) => ({
      key: `${row.partnerSlug}:${row.scopeId}:${row.period}`,
      partner: partnerLabel(row.partnerSlug),
      href: withWindow(`/partners/${row.partnerSlug}`, row.period),
      scope: alertScopeLabel(row.scopeId, (scopeId) => titles.get(`${row.partnerSlug}:${scopeId}`) ?? serviceLabel(scopeId)),
      month: monthTitle(row.period),
      status: alertStatusLabel(row.lastStatus),
      statusKind: row.lastStatus === "at_risk" || row.lastStatus === "breached" ? "badge" : "chip",
      badgeVariant: row.lastStatus === "breached" ? "danger" : "warning",
      lastAlerted: row.lastAlertedAt === null ? NEVER_ALERTED : formatUtcTimestamp(row.lastAlertedAt.toISOString()),
      alerts: String(row.alertCount),
    }) satisfies AlertRowView);
  const empty = rows.length === 0 ? (input.filterKey === "all" ? "No alerts recorded." : noAlertsFor(monthTitle(input.filterKey))) : null;
  return { state: "ok", note: ALERTS_NOTE, filter, rows, empty };
}
