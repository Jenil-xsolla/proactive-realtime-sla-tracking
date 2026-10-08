import { getDatabase } from "@/data";
import {
  calendarMonthWindow,
  getSlaFeed,
  monthKey,
  type SlaFeed,
  type TechnicalRow,
} from "@/feed";
import { trackingSignal } from "./heads-up";
import { isDuringExcludedMaintenance, loadMaintenanceWindows, type MaintenanceWindow } from "./maintenance";
import { engineerMessage, headsUpMessage, plainMessage } from "./messages";
import { postSlackMessage } from "./slack";
import { createPostgresAlertStore, type AlertKey, type AlertStateStore } from "./state";

const CHANNEL_ENV = {
  legal: "SLACK_CHANNEL_LEGAL",
  engineer: "SLACK_CHANNEL_ENGINEER",
} as const;

export type AlertAudience = keyof typeof CHANNEL_ENV;

export type PlannedAlert = {
  audience: AlertAudience;
  partnerSlug: string;
  scopeId: string;
  period: string;
  text: string;
};

export type AlertRunReport = {
  scopesEvaluated: number;
  transitionsFound: number;
  alertsSent: number;
  errors: string[];
  dryRun: boolean;
  planned: PlannedAlert[];
};

type ScoredRow = Extract<TechnicalRow, { kind: "scored" }>;
type Change = "steady" | "up" | "down";

const SCORED_RANK = {
  meeting: 0,
  at_risk: 1,
  breached: 2,
} as const;

export function trackingScopeId(service: string): string {
  return `tracking:${service}`;
}

/** The alert job and the dashboard both read this feed. The viewer is system. */
export function loadSystemFeed(asOf: Date): Promise<SlaFeed> {
  return getSlaFeed({
    asOf,
    window: calendarMonthWindow(asOf),
    viewer: { role: "system" },
  });
}

export async function runAlerts(input: {
  asOf?: Date;
  dryRun?: boolean;
  loadFeed?: (asOf: Date) => Promise<SlaFeed>;
  state?: AlertStateStore;
  maintenance?: readonly MaintenanceWindow[];
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
} = {}): Promise<AlertRunReport> {
  const asOf = input.asOf ?? new Date();
  const dryRun = input.dryRun ?? false;
  const loadFeed = input.loadFeed ?? loadSystemFeed;
  const maintenance = input.maintenance ?? loadMaintenanceWindows();
  const period = monthKey(asOf);
  const empty = (): AlertRunReport => ({
    scopesEvaluated: 0,
    transitionsFound: 0,
    alertsSent: 0,
    errors: [],
    dryRun,
    planned: [],
  });

  let feed: SlaFeed;
  try {
    feed = await loadFeed(asOf);
  } catch (error) {
    return { ...empty(), errors: [`Could not evaluate: ${failureText(error)}`] };
  }
  if (feed.role === "business") {
    return {
      ...empty(),
      errors: ["Could not evaluate: the alert job requires the system feed."],
    };
  }

  const state = input.state ?? createPostgresAlertStore(getDatabase());
  const report = empty();
  report.scopesEvaluated = feed.rows.length;

  for (const row of feed.rows) {
    const scopeId = row.kind === "scored" ? row.scopeId : trackingScopeId(row.service);
    const key: AlertKey = { partnerSlug: row.partner, scopeId, period };
    if (isDuringExcludedMaintenance(asOf, row.partner, scopeId, maintenance)) {
      continue;
    }
    try {
      await state.exclusive(key, async ({ seen, commit }) => {
        const decision = decide(row, seen);
        if (decision.change === "steady") {
          return;
        }
        if (decision.change === "down") {
          if (!dryRun) {
            await commit({ status: decision.status, alerted: false, at: asOf });
          }
          return;
        }
        const messages = messagesFor(row, period);
        report.transitionsFound += 1;
        report.planned.push(...messages);
        if (dryRun) {
          return;
        }
        const delivered = await deliver(messages, key, input.fetch, input.sleep);
        report.alertsSent += delivered.sent;
        if (!delivered.ok) {
          report.errors.push(delivered.error);
          return;
        }
        const wrote = await commit({ status: decision.status, alerted: true, at: asOf });
        if (!wrote) {
          report.errors.push(
            `Alert state for ${key.partnerSlug}/${key.scopeId}/${key.period} changed before it could be saved. Delivery already happened, so the next run may send a duplicate.`,
          );
        }
      });
    } catch (error) {
      report.errors.push(
        `Could not evaluate alert state for ${key.partnerSlug}/${key.scopeId}: ${failureText(error)}`,
      );
    }
  }

  return report;
}

function messagesFor(row: TechnicalRow, period: string): PlannedAlert[] {
  const base = {
    partnerSlug: row.partner,
    scopeId: row.kind === "scored" ? row.scopeId : trackingScopeId(row.service),
    period,
  };
  if (row.kind === "tracking_only") {
    return [{ ...base, audience: "engineer", text: headsUpMessage(row) }];
  }
  return [
    { ...base, audience: "legal", text: plainMessage(row, period) },
    { ...base, audience: "engineer", text: engineerMessage(row, period) },
  ];
}

function decide(row: TechnicalRow, seen: string | null): { change: Change; status: string } {
  if (row.kind === "scored") {
    return { change: scoredChange(seen, row.status), status: row.status };
  }
  const status = trackingSignal(row);
  return { change: trackingChange(seen, status), status };
}

function scoredChange(seen: string | null, next: ScoredRow["status"]): Change {
  if (seen !== "meeting" && seen !== "at_risk" && seen !== "breached") {
    if (seen === null) {
      return next === "meeting" ? "steady" : "up";
    }
    return next === "meeting" ? "down" : "up";
  }
  if (seen === next) {
    return "steady";
  }
  return SCORED_RANK[next] > SCORED_RANK[seen] ? "up" : "down";
}

function trackingChange(seen: string | null, next: "heads_up" | "quiet"): Change {
  if (next === "heads_up") {
    return seen === "heads_up" ? "steady" : "up";
  }
  if (seen === null || seen === "quiet") {
    return "steady";
  }
  return "down";
}

async function deliver(
  messages: readonly PlannedAlert[],
  key: AlertKey,
  doFetch: typeof fetch | undefined,
  sleep: ((ms: number) => Promise<void>) | undefined,
): Promise<{ ok: true; sent: number } | { ok: false; error: string; sent: number }> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (token === undefined || token === "") {
    return { ok: false, sent: 0, error: "SLACK_BOT_TOKEN is not set. No message was sent." };
  }
  const channels = new Map<AlertAudience, string>();
  for (const message of messages) {
    const envName = CHANNEL_ENV[message.audience];
    const channel = process.env[envName]?.trim();
    if (channel === undefined || channel === "") {
      return { ok: false, sent: 0, error: `${envName} is not set. No message was sent.` };
    }
    channels.set(message.audience, channel);
  }
  let sent = 0;
  for (const message of messages) {
    const channel = channels.get(message.audience);
    if (channel === undefined) {
      return { ok: false, sent, error: `${CHANNEL_ENV[message.audience]} is not set. No message was sent.` };
    }
    const result = await postSlackMessage({
      token,
      channel,
      text: message.text,
      fetch: doFetch,
      sleep,
    });
    if (!result.ok) {
      return {
        ok: false,
        sent,
        error: `Slack did not deliver the ${message.audience} alert for ${key.partnerSlug}/${key.scopeId}/${key.period}: ${result.error}`,
      };
    }
    sent += 1;
  }
  return { ok: true, sent };
}

function failureText(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "Unknown failure";
}
