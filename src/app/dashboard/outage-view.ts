import type { TechnicalOutage } from "@/feed";
import { serviceLabel, severityLabel } from "@/feed";
import { computedEnd, formatUtcTimestamp, reviewLine, ticketHref, windowMinutesLabel } from "./copy";

export type OutageView = {
  pirKey: string;
  href: string | null;
  started: string;
  ended: string;
  minutesLabel: string;
  service: string;
  severity: string;
  review: string | null;
  merchantId: string | null;
  source: string | null;
  mergeGroup: string;
  countedMinutes: number;
};

/** Newest first; ties broken by PIR key so the order is stable. */
export function toOutageViews(outages: readonly TechnicalOutage[]): OutageView[] {
  return [...outages]
    .sort((left, right) => {
      const byTime = right.incidentStarted.localeCompare(left.incidentStarted);
      return byTime !== 0 ? byTime : right.pirKey.localeCompare(left.pirKey);
    })
    .map((outage) => ({
      pirKey: outage.pirKey,
      href: ticketHref(outage.pirUrl),
      started: formatUtcTimestamp(outage.incidentStarted),
      ended: computedEnd(outage.incidentStarted, outage.totalMinutes),
      minutesLabel: windowMinutesLabel(outage.totalMinutes, outage.minutesInWindow),
      service: serviceLabel(outage.service),
      severity: severityLabel(outage.severity).replace(" — ", " · "),
      review: reviewLine(outage),
      merchantId: outage.partnerId === null ? null : String(outage.partnerId),
      source: outage.source,
      mergeGroup: outage.mergeGroup,
      countedMinutes: outage.countedMinutes,
    }));
}
