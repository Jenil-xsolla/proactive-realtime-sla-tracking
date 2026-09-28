import { eq, inArray, sql } from "drizzle-orm";
import { slaOutages, slaPirReviews, type Database, type UnresolvedValue } from "@/data";
import type { CaptureRow } from "@/ingestion/resolution";

export type ReceiptKind = "new" | "retry" | "redelivery";

export type ReceiptResult = {
  kind: ReceiptKind;
  version: number;
};

/**
 * Values extracted from a PIR (spec §2 step 3), stored on the review row so
 * the correction modal can prefill even when the PIR has zero rows (D4).
 * `affectedServices` holds display names, not ARIs.
 */
export type ExtractedValues = {
  incidentStarted: Date;
  outageMinutes: number;
  affectedServices: string[];
  severity: string;
  pirUrl: string;
};

export type CaptureResult = { kind: "written"; rowCount: number } | { kind: "corrected_untouched" };

/**
 * Records receipt of a PIR before any other ingestion work runs (the core
 * rule, spec §2 step 2): a failure after this call leaves a `failed` row,
 * never nothing.
 *
 * Runs as one transaction that locks the review row with `SELECT … FOR
 * UPDATE`, serialising concurrent deliveries of the same PIR (A8). To avoid
 * two first deliveries both reporting "new", the insert is attempted with
 * `ON CONFLICT DO NOTHING` before the locked select: whichever transaction's
 * insert actually lands is the one that reports "new"; a transaction that
 * loses the race finds the row already there and reports "retry" instead.
 *
 * - No existing row: insert `received`, receivedAt = updatedAt = now → "new".
 * - Existing row `failed`, `skipped` or `received`: set `received`, clear
 *   `error`, set updatedAt → "retry" (A8: redelivery of an in-flight or
 *   skipped PIR re-runs it the same way as a failed one).
 * - Existing row `captured`: left untouched → "redelivery". Whether this
 *   redelivery may still rewrite rows is decided later, per PIR, from
 *   `version` (D5) — not this function's concern.
 */
export async function recordReceipt(db: Database, pirKey: string, now: Date): Promise<ReceiptResult> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(slaPirReviews)
      .values({
        pirKey,
        status: "received",
        receivedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ version: slaPirReviews.version });

    if (inserted[0]) {
      return { kind: "new", version: inserted[0].version };
    }

    const rows = await tx
      .select({ status: slaPirReviews.status, version: slaPirReviews.version })
      .from(slaPirReviews)
      .where(eq(slaPirReviews.pirKey, pirKey))
      .for("update");
    const row = rows[0];
    if (!row) {
      throw new Error(`recordReceipt: no sla_pir_reviews row for ${pirKey} after a failed insert`);
    }

    if (row.status === "captured") {
      return { kind: "redelivery", version: row.version };
    }

    await tx
      .update(slaPirReviews)
      .set({ status: "received", error: null, updatedAt: now })
      .where(eq(slaPirReviews.pirKey, pirKey));
    return { kind: "retry", version: row.version };
  });
}

/**
 * Writes the system-written `sla_outages` set for a PIR: one row per
 * (partner, service), replacing the PIR's previous system-written set, and
 * marks the review `captured` (spec §2 step 5). Runs as one transaction
 * that locks the review row with `SELECT … FOR UPDATE`.
 *
 * A PIR is "corrected" per-PIR, from `version > 0` (D5), not per row. On a
 * corrected PIR this is a no-op: the review row — including whatever
 * extracted values a correction stored — is left completely untouched, and
 * `{ kind: "corrected_untouched" }` is returned. A later correction task
 * owns writing corrected values; redelivery must never overwrite them.
 *
 * On an uncorrected PIR (version 0): rows whose (partner, affected_service)
 * pair isn't in `rows` are deleted (all of them, when `rows` is empty),
 * then `rows` is upserted on `(pir_key, partner, affected_service)` as
 * `source = 'pipeline'`, `decision_type = 'system_written'`, with reviewer
 * fields null. The review is set to `captured` with the extracted values
 * and `unresolved_values`.
 */
export async function captureRows(
  db: Database,
  input: { pirKey: string; extracted: ExtractedValues; rows: CaptureRow[]; unresolved: UnresolvedValue[] },
  now: Date,
): Promise<CaptureResult> {
  return db.transaction(async (tx) => {
    const reviewRows = await tx
      .select({ version: slaPirReviews.version })
      .from(slaPirReviews)
      .where(eq(slaPirReviews.pirKey, input.pirKey))
      .for("update");
    const review = reviewRows[0];
    if (!review) {
      throw new Error(`captureRows: no sla_pir_reviews row for ${input.pirKey}; recordReceipt must run before this call`);
    }

    if (review.version > 0) {
      return { kind: "corrected_untouched" };
    }

    const keepKeys = new Set(input.rows.map((row) => `${row.partner}\u0000${row.affectedService}`));
    const existing = await tx
      .select({ id: slaOutages.id, partner: slaOutages.partner, affectedService: slaOutages.affectedService })
      .from(slaOutages)
      .where(eq(slaOutages.pirKey, input.pirKey));
    const idsToDelete = existing
      .filter((row) => !keepKeys.has(`${row.partner}\u0000${row.affectedService}`))
      .map((row) => row.id);
    if (idsToDelete.length > 0) {
      await tx.delete(slaOutages).where(inArray(slaOutages.id, idsToDelete));
    }

    if (input.rows.length > 0) {
      await tx
        .insert(slaOutages)
        .values(
          input.rows.map((row) => ({
            pirKey: row.pirKey,
            partner: row.partner,
            partnerId: row.partnerId,
            affectedService: row.affectedService,
            incidentStarted: row.incidentStarted,
            outageMinutes: String(row.outageMinutes),
            severity: row.severity,
            pirUrl: row.pirUrl,
            source: "pipeline",
            decisionType: "system_written",
            reviewedBy: null,
            reviewedAt: null,
            reason: null,
          })),
        )
        .onConflictDoUpdate({
          target: [slaOutages.pirKey, slaOutages.partner, slaOutages.affectedService],
          set: {
            partnerId: sql`excluded.partner_id`,
            incidentStarted: sql`excluded.incident_started`,
            outageMinutes: sql`excluded.outage_minutes`,
            severity: sql`excluded.severity`,
            pirUrl: sql`excluded.pir_url`,
            source: sql`excluded.source`,
            decisionType: sql`excluded.decision_type`,
            reviewedBy: sql`excluded.reviewed_by`,
            reviewedAt: sql`excluded.reviewed_at`,
            reason: sql`excluded.reason`,
          },
        });
    }

    await tx
      .update(slaPirReviews)
      .set({
        status: "captured",
        incidentStarted: input.extracted.incidentStarted,
        outageMinutes: String(input.extracted.outageMinutes),
        affectedServices: input.extracted.affectedServices,
        severity: input.extracted.severity,
        pirUrl: input.extracted.pirUrl,
        unresolvedValues: input.unresolved,
        error: null,
        updatedAt: now,
      })
      .where(eq(slaPirReviews.pirKey, input.pirKey));

    return { kind: "written", rowCount: input.rows.length };
  });
}

/**
 * Marks a PIR skipped (A3/E4: no outage, or an L3/L4 severity). `error`
 * doubles as the skip reason column — there is no separate reason field.
 * Throws if the PIR was never received, since every caller records
 * receipt first.
 */
export async function markSkipped(db: Database, pirKey: string, reason: string, now: Date): Promise<void> {
  await updateOneRow(db, pirKey, { status: "skipped", error: reason, updatedAt: now });
}

/** Marks a PIR failed with the error text (spec §2, "On failure at any step"). */
export async function markFailed(db: Database, pirKey: string, error: string, now: Date): Promise<void> {
  await updateOneRow(db, pirKey, { status: "failed", error, updatedAt: now });
}

/**
 * Restores a PIR's review status to `captured` without touching its rows or
 * its extracted values. For redelivery paths that must leave `sla_outages`
 * untouched but still need to move the review off `received` or `failed`
 * (spec §2 "Redelivery"): a corrected PIR (version > 0) redelivered after
 * `captureRows` reports `corrected_untouched`, and an already-captured PIR
 * that Jira now reports as skip (no outage, or severity below L2).
 */
export async function markCaptured(db: Database, pirKey: string, now: Date): Promise<void> {
  await updateOneRow(db, pirKey, { status: "captured", error: null, updatedAt: now });
}

/**
 * True once a PIR has ever been captured or corrected: `incident_started`
 * is set only by `captureRows` or a correction, never by `recordReceipt`
 * alone. Used on redelivery to tell "this PIR was captured, and Jira now
 * reports it as skip" (rows and status stay put) apart from "this PIR has
 * never produced rows and Jira reports it as skip" (mark it skipped).
 */
export async function wasCaptured(db: Database, pirKey: string): Promise<boolean> {
  const rows = await db
    .select({ incidentStarted: slaPirReviews.incidentStarted })
    .from(slaPirReviews)
    .where(eq(slaPirReviews.pirKey, pirKey));
  return rows[0]?.incidentStarted != null;
}

/** Records the capture message's channel/ts and clears any prior Slack error. */
export async function saveSlackMessage(
  db: Database,
  pirKey: string,
  message: { channel: string; ts: string },
  now: Date,
): Promise<void> {
  await updateOneRow(db, pirKey, {
    slackChannel: message.channel,
    slackTs: message.ts,
    slackError: null,
    updatedAt: now,
  });
}

/** Records that posting or updating the Slack message failed. */
export async function saveSlackError(db: Database, pirKey: string, error: string, now: Date): Promise<void> {
  await updateOneRow(db, pirKey, { slackError: error, updatedAt: now });
}

/**
 * Reads the review's saved Slack reference, so a redelivery can edit the
 * existing capture message in place (A9) instead of posting a new one.
 * Returns `undefined` when there is no review row at all.
 */
export async function getSlackRef(
  db: Database,
  pirKey: string,
): Promise<{ slackChannel: string | null; slackTs: string | null } | undefined> {
  const rows = await db
    .select({ slackChannel: slaPirReviews.slackChannel, slackTs: slaPirReviews.slackTs })
    .from(slaPirReviews)
    .where(eq(slaPirReviews.pirKey, pirKey));
  return rows[0];
}

async function updateOneRow(
  db: Database,
  pirKey: string,
  values: Partial<typeof slaPirReviews.$inferInsert>,
): Promise<void> {
  const updated = await db
    .update(slaPirReviews)
    .set(values)
    .where(eq(slaPirReviews.pirKey, pirKey))
    .returning({ pirKey: slaPirReviews.pirKey });
  if (updated.length === 0) {
    throw new Error(`No sla_pir_reviews row for ${pirKey}; recordReceipt must run before this call`);
  }
}
