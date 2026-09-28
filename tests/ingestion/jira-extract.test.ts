import { describe, expect, it } from "vitest";
import { readIncidentStart, readPir } from "@/ingestion/jira/extract";
import gto543 from "../fixtures/jira/GTO-543.pir.json";
import gto542 from "../fixtures/jira/GTO-542.incident.json";
import gto1917 from "../fixtures/jira/GTO-1917.pir.json";
import gto200 from "../fixtures/jira/GTO-200.pir.json";
import gto2454 from "../fixtures/jira/GTO-2454.pir.json";
import gto913 from "../fixtures/jira/GTO-913.pir.json";

const baseUrl = "https://xsolla.atlassian.net";

describe("readPir", () => {
  it("GTO-543: single service, merchants field is only a smartlink -> ok, merchantText is the URL", () => {
    const result = readPir(gto543, baseUrl);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value).toEqual({
      pirKey: "GTO-543",
      pirUrl: "https://xsolla.atlassian.net/browse/GTO-543",
      severity: "L1 — Critical",
      outageMinutes: 42,
      serviceAris: [
        "ari:cloud:graph::service/6184b75d-f203-4004-be12-5899d49497d2/2201284c-d00a-11eb-8ed1-0abe3f4a6601",
      ],
      merchantText: "https://docs.google.com/spreadsheets/d/1aZfBoagUmZEa5cJJgP_tB85KI05aCiCbokyukqy_AXQ/edit?usp=sharing",
      incidentKey: "GTO-542",
    });
  });

  it("GTO-1917: two services, merchants field is null -> ok, merchantText is null", () => {
    const result = readPir(gto1917, baseUrl);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.serviceAris).toEqual([
      "ari:cloud:graph::service/6184b75d-f203-4004-be12-5899d49497d2/0ba99b24-d00a-11eb-a1f5-0abe3f4a6601",
      "ari:cloud:graph::service/6184b75d-f203-4004-be12-5899d49497d2/2201284c-d00a-11eb-8ed1-0abe3f4a6601",
    ]);
    expect(result.value.merchantText).toBeNull();
    expect(result.value.severity).toBe("L2 — Major");
    expect(result.value.outageMinutes).toBe(680);
    expect(result.value.incidentKey).toBe("GTO-1916");
  });

  it("GTO-200: merchants field is a heading plus a bullet list -> each name lands on its own line", () => {
    const result = readPir(gto200, baseUrl);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const lines = result.value.merchantText?.split("\n") ?? [];
    expect(lines).toEqual([
      "Top 10 merchants:",
      "ROBLOX Corporation",
      "Niantic",
      "Valve",
      "Nexters Global Ltd",
      "Scopely | TopHat",
      "Bandai Namco Entertainment Inc.",
      "NETMARBLE CORPORATION",
      "Twitch TV",
      "VoyagerOne Pte. Ltd.",
      "MY.GAMES MENA FZ LLC",
    ]);
  });

  it("GTO-2454: outage minutes is 0 -> skip no_outage, even though severity is L3", () => {
    const result = readPir(gto2454, baseUrl);
    expect(result).toEqual({ kind: "skip", reason: "no_outage" });
  });

  it("GTO-913: severity L4 with no 11031 incident link -> skip below_l2, not invalid", () => {
    const result = readPir(gto913, baseUrl);
    expect(result).toEqual({ kind: "skip", reason: "below_l2", severity: "L4 — Minor" });
  });

  it("missing severity -> invalid", () => {
    const pir = {
      key: "GTO-9001",
      fields: {
        customfield_31331: 10,
        customfield_10399: [{ id: "ari:cloud:graph::service/x/y" }],
        issuelinks: [
          { id: "1", type: { id: "11031", name: "Post-Incident Reviews" }, outwardIssue: { key: "GTO-9000" } },
        ],
      },
    };
    const result = readPir(pir, baseUrl);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems).toContain("missing severity");
  });

  it("unrecognised severity -> invalid", () => {
    const pir = {
      key: "GTO-9002",
      fields: {
        customfield_31331: 10,
        customfield_11646: { value: "P1 — Sev1", id: "1" },
        customfield_10399: [{ id: "ari:cloud:graph::service/x/y" }],
        issuelinks: [
          { id: "1", type: { id: "11031", name: "Post-Incident Reviews" }, outwardIssue: { key: "GTO-9000" } },
        ],
      },
    };
    const result = readPir(pir, baseUrl);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems).toContain("unrecognised severity: P1 — Sev1");
  });

  it("outage minutes null -> skip no_outage", () => {
    const pir = {
      key: "GTO-9003",
      fields: {
        customfield_31331: null,
        customfield_11646: { value: "L1 — Critical", id: "1" },
      },
    };
    const result = readPir(pir, baseUrl);
    expect(result).toEqual({ kind: "skip", reason: "no_outage" });
  });

  it("outage minutes 'abc' -> invalid", () => {
    const pir = {
      key: "GTO-9004",
      fields: {
        customfield_31331: "abc",
        customfield_11646: { value: "L1 — Critical", id: "1" },
        customfield_10399: [{ id: "ari:cloud:graph::service/x/y" }],
        issuelinks: [
          { id: "1", type: { id: "11031", name: "Post-Incident Reviews" }, outwardIssue: { key: "GTO-9000" } },
        ],
      },
    };
    const result = readPir(pir, baseUrl);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems.some((problem) => problem.includes("outage minutes"))).toBe(true);
  });

  it("a numeric string for outage minutes is accepted", () => {
    const pir = {
      key: "GTO-9005",
      fields: {
        customfield_31331: "45",
        customfield_11646: { value: "L1 — Critical", id: "1" },
        customfield_10399: [{ id: "ari:cloud:graph::service/x/y" }],
        issuelinks: [
          { id: "1", type: { id: "11031", name: "Post-Incident Reviews" }, outwardIssue: { key: "GTO-9000" } },
        ],
      },
    };
    const result = readPir(pir, baseUrl);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.outageMinutes).toBe(45);
  });

  it("no 11031 link on an otherwise-valid L1 PIR -> invalid", () => {
    const pir = {
      key: "GTO-9006",
      fields: {
        customfield_31331: 10,
        customfield_11646: { value: "L1 — Critical", id: "1" },
        customfield_10399: [{ id: "ari:cloud:graph::service/x/y" }],
        issuelinks: [{ id: "1", type: { id: "10006", name: "Problem/Incident" }, inwardIssue: { key: "GTO-9000" } }],
      },
    };
    const result = readPir(pir, baseUrl);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems.some((problem) => problem.includes("incident link"))).toBe(true);
  });

  it("null or empty affected services -> invalid", () => {
    const pir = {
      key: "GTO-9007",
      fields: {
        customfield_31331: 10,
        customfield_11646: { value: "L1 — Critical", id: "1" },
        customfield_10399: [],
        issuelinks: [
          { id: "1", type: { id: "11031", name: "Post-Incident Reviews" }, outwardIssue: { key: "GTO-9000" } },
        ],
      },
    };
    const result = readPir(pir, baseUrl);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems).toContain("no affected services");
  });

  it("collects every problem instead of stopping at the first", () => {
    const pir = {
      key: "GTO-9008",
      fields: {
        customfield_31331: "not-a-number",
        customfield_10399: null,
      },
    };
    const result = readPir(pir, baseUrl);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems.length).toBeGreaterThan(1);
  });

  it("never throws on a malformed payload", () => {
    expect(() => readPir(null, baseUrl)).not.toThrow();
    expect(() => readPir("not an object", baseUrl)).not.toThrow();
    expect(() => readPir({}, baseUrl)).not.toThrow();
    // Absent outage minutes on a totally malformed payload is still "no outage" (A3).
    expect(readPir(null, baseUrl)).toEqual({ kind: "skip", reason: "no_outage" });
    // A shaped-but-empty payload has no outage minutes either.
    expect(readPir({}, baseUrl)).toEqual({ kind: "skip", reason: "no_outage" });
    expect(readPir("not an object", baseUrl).kind).toBe("skip");
  });

  it("trims a trailing slash off baseUrl when building pirUrl", () => {
    const result = readPir(gto543, "https://xsolla.atlassian.net/");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.pirUrl).toBe("https://xsolla.atlassian.net/browse/GTO-543");
  });
});

describe("readIncidentStart", () => {
  it("reads customfield_10068 as a UTC Date for GTO-542", () => {
    const start = readIncidentStart(gto542);
    expect(start).not.toBeNull();
    expect(start?.toISOString()).toBe("2026-08-03T20:43:00.000Z");
  });

  it("returns null when customfield_10068 is absent, without falling back to created", () => {
    const incident = { key: "GTO-9000", fields: { created: "2026-08-04T03:35:20.336+0500" } };
    expect(readIncidentStart(incident)).toBeNull();
  });

  it("never throws on a malformed payload", () => {
    expect(() => readIncidentStart(null)).not.toThrow();
    expect(readIncidentStart(null)).toBeNull();
  });
});
