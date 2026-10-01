import { partnerLabel, serviceLabel, type TechnicalRow } from "@/feed";

type ScoredRow = Extract<TechnicalRow, { kind: "scored" }>;
type TrackingRow = Extract<TechnicalRow, { kind: "tracking_only" }>;

export function plainMessage(row: ScoredRow, period: string): string {
  const partner = mrkdwn(partnerLabel(row.partner));
  const scope = mrkdwn(scopePhrase(row));
  return [
    `*${partner}* ${scope} is *${statusWord(row.status)}* for ${period}.`,
    `Projected credit at stake: *${creditText(row.penalty.projected)}*.`,
    plainReason(row.reason),
  ].join("\n");
}

export function engineerMessage(row: ScoredRow, period: string): string {
  const partner = mrkdwn(partnerLabel(row.partner));
  const scope = mrkdwn(scopePhrase(row));
  const consumed =
    row.reason.consumedFraction === null ? "n/a" : formatNumber(row.reason.consumedFraction);
  return [
    `*${partner}* · ${scope} · \`${mrkdwn(row.scopeId)}\``,
    `*${statusWord(row.status)}* for ${period}`,
    labeled("Rule", row.reason.rule),
    labeled("Elapsed", formatNumber(row.reason.elapsedFraction)),
    labeled("Consumed", consumed),
    labeled("Burn rate", formatNumber(row.reason.burnRate)),
    labeled("Used minutes", formatNumber(row.reason.usedMinutes)),
    labeled("Allowed minutes", formatNumber(row.reason.allowedMinutes)),
    labeled("Projected minutes", formatNumber(row.reason.projectedMinutes)),
    ...row.outages.map((outage) => slackLink(outage.pirUrl, outage.pirKey)),
  ].join("\n");
}

export function headsUpMessage(row: TrackingRow): string {
  const partner = mrkdwn(partnerLabel(row.partner));
  const service = mrkdwn(serviceLabel(row.service));
  const lines = [`*${partner}* · ${service}`, headsUpLead(row)];
  for (const outage of row.outages) {
    lines.push(slackLink(outage.pirUrl, outage.pirKey));
  }
  return lines.join("\n");
}

function headsUpLead(row: TrackingRow): string {
  const comparison = row.comparison;
  if (comparison.kind === "no_prior_downtime") {
    return `First recorded downtime in the last ${comparison.coveredMonths} covered months: *${formatMinutes(row.usedMinutes)}*.`;
  }
  if (comparison.kind === "compared") {
    return `*${formatMinutes(comparison.currentMinutes)}* this month, above the prior-month median of *${formatMinutes(comparison.medianMinutes)}* across ${comparison.coveredMonths} covered months.`;
  }
  return "";
}

function scopePhrase(row: ScoredRow): string {
  const names = [...new Set(row.outages.map((outage) => serviceLabel(outage.service)))];
  if (names.length === 0) {
    return row.scopeId;
  }
  return names.join(", ");
}

function plainReason(reason: ScoredRow["reason"]): string {
  if (reason.rule === "breaching") {
    return "Downtime has used the full allowance for this window.";
  }
  if (reason.rule === "trend" && reason.fired.includes("level")) {
    return "Most of the allowance is already used, and the current pace would exhaust it before the window closes.";
  }
  if (reason.rule === "trend") {
    return "At the current pace, downtime will exhaust the allowance before the window closes.";
  }
  if (reason.rule === "level") {
    return "Most of the downtime allowance is already used.";
  }
  return "Downtime is within the allowance at this point in the window.";
}

function labeled(label: string, value: string): string {
  return `*${label}*: ${value}`;
}

function statusWord(status: ScoredRow["status"]): string {
  if (status === "at_risk") {
    return "at risk";
  }
  return status;
}

function creditText(figure: ScoredRow["penalty"]["projected"]): string {
  if (figure.kind === "none" || figure.kind === "unknown") {
    return figure.statement;
  }
  return `${formatNumber(figure.creditFraction * 100)}%`;
}

function formatMinutes(value: number): string {
  return `${formatNumber(value)} min`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function slackLink(url: string | null, label: string): string {
  if (url !== null && /^https?:\/\//.test(url) && !/[<>|\s]/.test(url)) {
    return `<${url}|${mrkdwn(label)}>`;
  }
  return mrkdwn(label);
}

function mrkdwn(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
