import { asc, desc, sql } from "drizzle-orm";
import type { Database } from "./db";
import { slaAlertState } from "./schema/alert-state";

export type AlertStateRow = {
  partnerSlug: string;
  scopeId: string;
  period: string;
  lastStatus: string;
  lastAlertedAt: Date | null;
  alertCount: number;
  updatedAt: Date;
};

/**
 * Everything the alert job has recorded, newest alert first. Rows that were
 * evaluated but never alerted have a null last_alerted_at and sort last.
 */
export async function listAlertState(db: Database): Promise<AlertStateRow[]> {
  return db
    .select({
      partnerSlug: slaAlertState.partnerSlug,
      scopeId: slaAlertState.scopeId,
      period: slaAlertState.period,
      lastStatus: slaAlertState.lastStatus,
      lastAlertedAt: slaAlertState.lastAlertedAt,
      alertCount: slaAlertState.alertCount,
      updatedAt: slaAlertState.updatedAt,
    })
    .from(slaAlertState)
    .orderBy(
      sql`${slaAlertState.lastAlertedAt} desc nulls last`,
      desc(slaAlertState.period),
      asc(slaAlertState.partnerSlug),
      asc(slaAlertState.scopeId),
    );
}
