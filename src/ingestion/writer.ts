import { desc, eq, inArray, sql } from "drizzle-orm";
import { slaOutageCorrections, slaOutages, slaPirReviews, type Database, type UnresolvedValue } from "@/data";
import type { CaptureRow } from "@/ingestion/resolution";

export type ReceiptKind = "new" | "retry" | "redelivery";

export type ReceiptResult = {
  kind: ReceiptKind;
  version: number;
};

/**
 * Values extracted from a PIR (spec §2 step 3), stored on the review row so
 * the correction modal can prefill even when the PIR has zero rows.
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
 * UPDATE`, serialising concurrent deliveries of the same PIR. To avoid
 * two first deliveries both reporting "new", the insert is attempted with
 * `ON CONFLICT DO NOTHING` before the locked select: whichever transaction's
 * insert actually lands is the one that reports "new"; a transaction that
 * loses the race finds the row already there and reports "retry" instead.
 *
 * - No existing row: insert `received`, receivedAt = updatedAt = now → "new".
 * - Existing row `failed`, `skipped` or `received`: set `received`, clear
 *   `error`, set updatedAt → "retry" (redelivery of an in-flight or
 *   skipped PIR re-runs it the same way as a failed one).
 * - Existing row `captured`: left untouched → "redelivery". Whether this
 *   redelivery may still rewrite rows is decided later, per PIR, from
 *   `version` — not this function's concern.
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
 * A PIR is "corrected" per-PIR, from `version > 0`, not per row. On a
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
 * A row as it appears in `sla_outages` for correction purposes: the shape
 * the correction modal prefills from and `applyCorrection`'s before/after
 * history serialises (spec §3 "Handling a correction" step 3).
 */
export type OutageRow = {
  partner: string;
  partnerId: string | null;
  affectedService: string;
  incidentStarted: Date;
  outageMinutes: number;
  severity: string | null;
  pirUrl: string | null;
};

/** The `{ partner, partnerId, affectedService, incidentStarted, outageMinutes, severity }` shape stored in `sla_outage_corrections.before`/`after`. */
type CorrectionHistoryRow = {
  partner: string;
  partnerId: string | null;
  affectedService: string;
  incidentStarted: string;
  outageMinutes: number;
  severity: string | null;
};

function toHistoryRow(row: OutageRow): CorrectionHistoryRow {
  return {
    partner: row.partner,
    partnerId: row.partnerId,
    affectedService: row.affectedService,
    incidentStarted: row.incidentStarted.toISOString(),
    outageMinutes: row.outageMinutes,
    severity: row.severity,
  };
}

function captureRowToHistoryRow(row: CaptureRow): CorrectionHistoryRow {
  return {
    partner: row.partner,
    partnerId: row.partnerId,
    affectedService: row.affectedService,
    incidentStarted: row.incidentStarted.toISOString(),
    outageMinutes: row.outageMinutes,
    severity: row.severity,
  };
}

export type ApplyCorrectionInput = {
  pirKey: string;
  expectedVersion: number;
  after: CaptureRow[];
  extracted: ExtractedValues;
  reason: string | null;
  correctedBy: string;
};

export type ApplyCorrectionResult = { kind: "applied"; version: number } | { kind: "stale" };

/**
 * Applies a human correction to a PIR's row set (spec §3 "Handling a
 * correction" step 3): in one transaction, records the before/after in
 * `sla_outage_corrections`, replaces the (partner, service) row set —
 * deleting rows no longer listed, upserting the rest as `human_corrected` —
 * and bumps the review's version. A plain upsert is not enough: a removed
 * partner or service would leave a stale row that keeps counting (see
 * .claude/rules/ingestion.md).
 *
 * Locks the review row with `SELECT … FOR UPDATE`. If `expectedVersion`
 * no longer matches — someone else corrected it first — returns `stale`
 * with no writes at all, not even the history row.
 */
export async function applyCorrection(
  db: Database,
  input: ApplyCorrectionInput,
  now: Date,
): Promise<ApplyCorrectionResult> {
  return db.transaction(async (tx) => {
    const reviewRows = await tx
      .select({ version: slaPirReviews.version })
      .from(slaPirReviews)
      .where(eq(slaPirReviews.pirKey, input.pirKey))
      .for("update");
    const review = reviewRows[0];
    if (!review) {
      throw new Error(`applyCorrection: no sla_pir_reviews row for ${input.pirKey}`);
    }
    if (review.version !== input.expectedVersion) {
      return { kind: "stale" };
    }

    const existing = await tx
      .select({
        id: slaOutages.id,
        partner: slaOutages.partner,
        partnerId: slaOutages.partnerId,
        affectedService: slaOutages.affectedService,
        incidentStarted: slaOutages.incidentStarted,
        outageMinutes: slaOutages.outageMinutes,
        severity: slaOutages.severity,
      })
      .from(slaOutages)
      .where(eq(slaOutages.pirKey, input.pirKey));

    const before: CorrectionHistoryRow[] = existing.map((row) =>
      toHistoryRow({
        partner: row.partner,
        partnerId: row.partnerId,
        affectedService: row.affectedService,
        incidentStarted: row.incidentStarted,
        outageMinutes: Number(row.outageMinutes),
        severity: row.severity,
        pirUrl: null,
      }),
    );
    const after: CorrectionHistoryRow[] = input.after.map(captureRowToHistoryRow);

    await tx.insert(slaOutageCorrections).values({
      pirKey: input.pirKey,
      correctedBy: input.correctedBy,
      correctedAt: now,
      before,
      after,
      reason: input.reason,
    });

    const keepKeys = new Set(input.after.map((row) => `${row.partner}\u0000${row.affectedService}`));
    const idsToDelete = existing
      .filter((row) => !keepKeys.has(`${row.partner}\u0000${row.affectedService}`))
      .map((row) => row.id);
    if (idsToDelete.length > 0) {
      await tx.delete(slaOutages).where(inArray(slaOutages.id, idsToDelete));
    }

    if (input.after.length > 0) {
      await tx
        .insert(slaOutages)
        .values(
          input.after.map((row) => ({
            pirKey: row.pirKey,
            partner: row.partner,
            partnerId: row.partnerId,
            affectedService: row.affectedService,
            incidentStarted: row.incidentStarted,
            outageMinutes: String(row.outageMinutes),
            severity: row.severity,
            pirUrl: row.pirUrl,
            source: "pipeline",
            decisionType: "human_corrected",
            reviewedBy: input.correctedBy,
            reviewedAt: now,
            reason: input.reason,
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

    const newVersion = review.version + 1;
    await tx
      .update(slaPirReviews)
      .set({
        version: newVersion,
        status: "captured",
        unresolvedValues: [],
        incidentStarted: input.extracted.incidentStarted,
        outageMinutes: String(input.extracted.outageMinutes),
        affectedServices: input.extracted.affectedServices,
        severity: input.extracted.severity,
        pirUrl: input.extracted.pirUrl,
        error: null,
        updatedAt: now,
      })
      .where(eq(slaPirReviews.pirKey, input.pirKey));

    return { kind: "applied", version: newVersion };
  });
}

/**
 * Reads a PIR's current `sla_outages` rows in the shape the correction
 * modal prefills from and `applyCorrection`'s history serialises. Ordered
 * for stable snapshots in tests and messages.
 */
export async function getOutageRows(db: Database, pirKey: string): Promise<OutageRow[]> {
  const rows = await db
    .select({
      partner: slaOutages.partner,
      partnerId: slaOutages.partnerId,
      affectedService: slaOutages.affectedService,
      incidentStarted: slaOutages.incidentStarted,
      outageMinutes: slaOutages.outageMinutes,
      severity: slaOutages.severity,
      pirUrl: slaOutages.pirUrl,
    })
    .from(slaOutages)
    .where(eq(slaOutages.pirKey, pirKey))
    .orderBy(slaOutages.partner, slaOutages.affectedService);
  return rows.map((row) => ({ ...row, outageMinutes: Number(row.outageMinutes) }));
}

export type ReviewForCorrection = { version: number; extracted: ExtractedValues };

/**
 * Reads the version and extracted values the correction flow needs: the
 * "Correct" click loads this to build the modal (with `getOutageRows`),
 * and the submission handler loads it again for the PIR's `pir_url`
 * (spec §3 — the extracted values make prefill possible even with
 * zero rows). `undefined` when the PIR has never been captured, so there
 * is nothing to correct yet.
 */
export async function getReviewForCorrection(db: Database, pirKey: string): Promise<ReviewForCorrection | undefined> {
  const rows = await db
    .select({
      version: slaPirReviews.version,
      incidentStarted: slaPirReviews.incidentStarted,
      outageMinutes: slaPirReviews.outageMinutes,
      affectedServices: slaPirReviews.affectedServices,
      severity: slaPirReviews.severity,
      pirUrl: slaPirReviews.pirUrl,
    })
    .from(slaPirReviews)
    .where(eq(slaPirReviews.pirKey, pirKey));
  const row = rows[0];
  if (
    !row ||
    row.incidentStarted === null ||
    row.outageMinutes === null ||
    row.severity === null ||
    row.pirUrl === null
  ) {
    return undefined;
  }
  return {
    version: row.version,
    extracted: {
      incidentStarted: row.incidentStarted,
      outageMinutes: Number(row.outageMinutes),
      affectedServices: row.affectedServices ?? [],
      severity: row.severity,
      pirUrl: row.pirUrl,
    },
  };
}

export type LatestCorrection = { by: string; at: Date };

/**
 * Reads the most recent correction on record for a PIR, so the correction
 * followUp can render "Last corrected by" from the actual latest write
 * rather than the submission that happened to be running it — two
 * corrections can race, and `after()` callbacks are not guaranteed to run
 * in submission order. `undefined` if the PIR has never been corrected.
 */
export async function getLatestCorrection(db: Database, pirKey: string): Promise<LatestCorrection | undefined> {
  const rows = await db
    .select({ correctedBy: slaOutageCorrections.correctedBy, correctedAt: slaOutageCorrections.correctedAt })
    .from(slaOutageCorrections)
    .where(eq(slaOutageCorrections.pirKey, pirKey))
    .orderBy(desc(slaOutageCorrections.correctedAt), desc(slaOutageCorrections.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  return { by: row.correctedBy, at: row.correctedAt };
}

/**
 * Marks a PIR skipped (no outage, or an L3/L4 severity). `error`
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
 * existing capture message in place instead of posting a new one.
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
