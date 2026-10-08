import { HIGH_CONSUMPTION, MIN_CONSUMPTION, MIN_ELAPSED } from "./constants";
import { durationMinutes, fromMs, type Interval } from "./intervals";
import type { StatusReason } from "./types";

export type Classification = {
  status: "meeting" | "at_risk" | "breached";
  remainingMinutes: number;
  projectedExhaustion: Date | null;
  reason: StatusReason;
};

export function classify(input: {
  usedMinutes: number;
  allowedMinutes: number;
  elapsedFraction: number;
  windowMinutes: number;
  merged: readonly Interval[];
  anchorMs: number;
}): Classification {
  const { usedMinutes, allowedMinutes, elapsedFraction, windowMinutes, merged, anchorMs } = input;
  const consumedFraction = allowedMinutes === 0 ? null : usedMinutes / allowedMinutes;
  const projectedMinutes = elapsedFraction > 0 ? usedMinutes / elapsedFraction : usedMinutes;
  const burnRate =
    consumedFraction !== null && elapsedFraction > 0 ? consumedFraction / elapsedFraction : 0;
  const elapsedMinutes = elapsedFraction * windowMinutes;

  const breaching = usedMinutes >= allowedMinutes;
  const fired: ("trend" | "level")[] = [];
  if (!breaching && consumedFraction !== null) {
    const trend =
      elapsedFraction >= MIN_ELAPSED &&
      consumedFraction >= MIN_CONSUMPTION &&
      projectedMinutes > allowedMinutes;
    const level = consumedFraction >= HIGH_CONSUMPTION;
    if (trend) {
      fired.push("trend");
    }
    if (level) {
      fired.push("level");
    }
  }

  const status = breaching ? "breached" : fired.length > 0 ? "at_risk" : "meeting";
  const rule = breaching ? "breaching" : (fired[0] ?? "meeting");

  return {
    status,
    remainingMinutes: Math.max(0, allowedMinutes - usedMinutes),
    projectedExhaustion: exhaustionInstant(
      merged,
      allowedMinutes,
      usedMinutes,
      elapsedMinutes,
      anchorMs,
    ),
    reason: {
      rule,
      fired,
      elapsedFraction,
      consumedFraction,
      projectedMinutes,
      usedMinutes,
      allowedMinutes,
      burnRate,
    },
  };
}

function exhaustionInstant(
  merged: readonly Interval[],
  allowedMinutes: number,
  usedMinutes: number,
  elapsedMinutes: number,
  anchorMs: number,
): Date | null {
  if (usedMinutes >= allowedMinutes && usedMinutes > 0) {
    let cumulative = 0;
    for (const interval of merged) {
      const length = durationMinutes([interval]);
      if (cumulative + length >= allowedMinutes) {
        const needed = Math.max(0, allowedMinutes - cumulative);
        return fromMs(interval.startMs + needed * 60_000);
      }
      cumulative += length;
    }
    const last = merged[merged.length - 1];
    return last === undefined ? fromMs(anchorMs) : fromMs(last.endMs);
  }

  if (!(usedMinutes > 0) || !(elapsedMinutes > 0) || !(allowedMinutes > usedMinutes)) {
    return null;
  }

  const rate = usedMinutes / elapsedMinutes;
  if (!(rate > 0)) {
    return null;
  }
  return fromMs(anchorMs + ((allowedMinutes - usedMinutes) / rate) * 60_000);
}
