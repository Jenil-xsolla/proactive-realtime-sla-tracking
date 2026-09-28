import { eq } from "drizzle-orm";
import { slaPirReviews, type Database } from "@/data";

export type ReceiptKind = "new" | "retry" | "redelivery";

export type ReceiptResult = {
  kind: ReceiptKind;
  version: number;
};

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
