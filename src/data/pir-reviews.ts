import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Database } from "./db";
import { slaPirReviews, type UnresolvedValue } from "./schema/pir-reviews";

/**
 * Each list in the health panel is capped at this many rows, ordered by
 * updatedAt desc, with the true count kept alongside so "50" never reads
 * as "everything".
 */
const LIST_CAP = 50;

export type FailedPirReview = {
  pirKey: string;
  pirUrl: string | null;
  error: string | null;
  updatedAt: Date;
};

export type UnresolvedPirReview = {
  pirKey: string;
  pirUrl: string | null;
  values: UnresolvedValue[];
};

export type PirWithoutMessage = {
  pirKey: string;
  pirUrl: string | null;
  slackError: string;
};

export type IngestionHealthList<T> = {
  items: T[];
  totalCount: number;
};

/**
 * Read-only view of sla_pir_reviews for the dashboard's health panel (main
 * spec §9.3: the health panel is first-class). Each list is ordered by
 * updatedAt desc and capped at 50, with the true count kept alongside.
 */
export type IngestionHealth = {
  /** status = 'failed'. */
  failed: IngestionHealthList<FailedPirReview>;
  /** status = 'captured' with a non-empty unresolved_values. */
  unresolved: IngestionHealthList<UnresolvedPirReview>;
  /** status = 'captured' with slack_error set. */
  withoutMessage: IngestionHealthList<PirWithoutMessage>;
};

/**
 * Counts rows matching `where` without loading them, so the true total is
 * known even though only LIST_CAP rows are fetched. `::int` keeps the
 * result a plain number under both node-postgres (which otherwise returns
 * bigint aggregates as strings) and PGlite.
 */
async function countMatching(db: Database, where: SQL): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(slaPirReviews).where(where);
  return Number(rows[0]?.count ?? 0);
}

const FAILED_WHERE = eq(slaPirReviews.status, "failed");

async function loadFailed(db: Database): Promise<IngestionHealthList<FailedPirReview>> {
  const [items, totalCount] = await Promise.all([
    db
      .select({
        pirKey: slaPirReviews.pirKey,
        pirUrl: slaPirReviews.pirUrl,
        error: slaPirReviews.error,
        updatedAt: slaPirReviews.updatedAt,
      })
      .from(slaPirReviews)
      .where(FAILED_WHERE)
      .orderBy(desc(slaPirReviews.updatedAt))
      .limit(LIST_CAP),
    countMatching(db, FAILED_WHERE),
  ]);
  return { items, totalCount };
}

function unresolvedWhere(): SQL {
  return and(
    eq(slaPirReviews.status, "captured"),
    sql`jsonb_array_length(${slaPirReviews.unresolvedValues}) > 0`,
  )!;
}

async function loadUnresolved(db: Database): Promise<IngestionHealthList<UnresolvedPirReview>> {
  const where = unresolvedWhere();
  const [items, totalCount] = await Promise.all([
    db
      .select({
        pirKey: slaPirReviews.pirKey,
        pirUrl: slaPirReviews.pirUrl,
        values: slaPirReviews.unresolvedValues,
      })
      .from(slaPirReviews)
      .where(where)
      .orderBy(desc(slaPirReviews.updatedAt))
      .limit(LIST_CAP),
    countMatching(db, where),
  ]);
  return { items, totalCount };
}

function withoutMessageWhere(): SQL {
  return and(eq(slaPirReviews.status, "captured"), isNotNull(slaPirReviews.slackError))!;
}

async function loadWithoutMessage(db: Database): Promise<IngestionHealthList<PirWithoutMessage>> {
  const where = withoutMessageWhere();
  const [rows, totalCount] = await Promise.all([
    db
      .select({
        pirKey: slaPirReviews.pirKey,
        pirUrl: slaPirReviews.pirUrl,
        slackError: slaPirReviews.slackError,
      })
      .from(slaPirReviews)
      .where(where)
      .orderBy(desc(slaPirReviews.updatedAt))
      .limit(LIST_CAP),
    countMatching(db, where),
  ]);
  // slackError is non-null by the WHERE clause; isNotNull doesn't narrow the select's type.
  const items = rows.map((row) => ({ pirKey: row.pirKey, pirUrl: row.pirUrl, slackError: row.slackError as string }));
  return { items, totalCount };
}

/**
 * Read-only SELECT on sla_pir_reviews, which the dashboard's app_user can
 * do (main spec §5.1). Backs the health panel: failed PIRs, captured PIRs
 * with unresolved values, and captured PIRs without a Slack message
 * (design §2, §4). Filters, ordering and the cap all run in SQL, since this
 * runs on every dashboard load and every alert run.
 */
export async function loadIngestionHealth(db: Database): Promise<IngestionHealth> {
  const [failed, unresolved, withoutMessage] = await Promise.all([
    loadFailed(db),
    loadUnresolved(db),
    loadWithoutMessage(db),
  ]);
  return { failed, unresolved, withoutMessage };
}
