import type { AlertStateRow } from "@/data";
import type { HealthView } from "./model";
import type { Badge } from "./nav";

export const ACTIVE_ALERT_STATUSES: ReadonlySet<string> = new Set(["at_risk", "breached", "heads_up"]);

type HealthInput = HealthView | { status: "error" } | null;
type AlertsInput = AlertStateRow[] | { status: "error" } | null;

/** Count of things a person should look at on the Health page; error when the read failed. */
export function healthBadge(health: HealthInput): Badge {
  if (health === null) return null;
  if ("status" in health) return { status: "error" };
  const ingestion = health.ingestion;
  if (ingestion.status === "error") return { status: "error" };
  return {
    count:
      health.droppedRows +
      health.unresolvedPartnerNames.length +
      health.unmatchedServiceNames.length +
      health.invalidTerms.length +
      ingestion.failed.count +
      ingestion.unresolved.count +
      ingestion.withoutMessage.count,
  };
}

/** Alerts still active in the selected window; error when the read failed. */
export function alertsBadge(alerts: AlertsInput, windowKey: string): Badge {
  if (alerts === null) return null;
  if ("status" in alerts) return { status: "error" };
  return { count: alerts.filter((row) => row.period === windowKey && ACTIVE_ALERT_STATUSES.has(row.lastStatus)).length };
}
