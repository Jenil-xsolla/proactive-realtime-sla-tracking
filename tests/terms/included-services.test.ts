import { describe, expect, it } from "vitest";
import { evaluate } from "@/engine";
import { loadContractFile, type ContractFile } from "@/terms";

const WINDOW = {
  start: new Date("2026-01-01T00:00:00.000Z"),
  end: new Date("2026-02-01T00:00:00.000Z"),
};

function at(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 0, 10, hour, minute));
}

function contract(services: ContractFile["scopes"][number]["services"]): ContractFile {
  return {
    partner: "scopely",
    lifecycle: "contract_bound",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    contractAggregateCap: null,
    scopes: [
      {
        kind: "service",
        scopeId: "scope",
        services,
        target: 99.95,
        penalty: { kind: "none" },
        sourceClause: "illustrative",
      },
    ],
  };
}

function usedMinutes(
  services: ContractFile["scopes"][number]["services"],
  outages: { pirKey: string; serviceId: string; hour: number; minute: number; outageMinutes: number }[],
): number {
  const loaded = loadContractFile(contract(services));
  const results = evaluate({
    outages: outages.map((row) => ({
      pirKey: row.pirKey,
      partnerId: "scopely" as const,
      serviceId: row.serviceId,
      incidentStarted: at(row.hour, row.minute),
      outageMinutes: row.outageMinutes,
    })),
    scopes: [{ partner: "scopely", scopes: loaded.scopes }],
    window: WINDOW,
    asOf: WINDOW.end,
  });
  const scored = results.find((result) => result.kind === "scored" && result.scopeId === "scope");
  if (scored === undefined || scored.kind !== "scored") {
    throw new Error("missing scored scope");
  }
  return scored.usedMinutes;
}

describe("included services", () => {
  it("merges IGS-BB and Subscriptions under a webshop scope to 50 minutes", () => {
    expect(
      usedMinutes(["webshop"], [
        { pirKey: "PIR-IGS", serviceId: "igs-bb", hour: 10, minute: 0, outageMinutes: 30 },
        { pirKey: "PIR-SUB", serviceId: "subscriptions", hour: 10, minute: 20, outageMinutes: 30 },
      ]),
    ).toBe(50);
  });

  it("counts an outage filed against Webshop itself", () => {
    expect(
      usedMinutes(["webshop"], [
        { pirKey: "PIR-WEB", serviceId: "webshop", hour: 10, minute: 0, outageMinutes: 30 },
      ]),
    ).toBe(30);
  });

  it("merges Webshop and IGS-BB to 45 minutes", () => {
    expect(
      usedMinutes(["webshop"], [
        { pirKey: "PIR-WEB", serviceId: "webshop", hour: 10, minute: 0, outageMinutes: 30 },
        { pirKey: "PIR-IGS", serviceId: "igs-bb", hour: 10, minute: 15, outageMinutes: 30 },
      ]),
    ).toBe(45);
  });

  it("counts nothing for a service outside the webshop set", () => {
    expect(
      usedMinutes(["webshop"], [
        { pirKey: "PIR-LOGIN", serviceId: "login", hour: 10, minute: 0, outageMinutes: 30 },
      ]),
    ).toBe(0);
  });

  it("does not count Subscriptions against a scope that names only igs-bb", () => {
    expect(
      usedMinutes(["igs-bb"], [
        { pirKey: "PIR-SUB", serviceId: "subscriptions", hour: 10, minute: 0, outageMinutes: 30 },
      ]),
    ).toBe(0);
  });

  it("counts shop-builder, payments, and login in one merged total", () => {
    expect(
      usedMinutes(["webshop", "payments", "login"], [
        { pirKey: "PIR-SHOP", serviceId: "shop-builder", hour: 10, minute: 0, outageMinutes: 30 },
        { pirKey: "PIR-PAY", serviceId: "payments", hour: 10, minute: 20, outageMinutes: 30 },
        { pirKey: "PIR-LOGIN", serviceId: "login", hour: 10, minute: 40, outageMinutes: 20 },
      ]),
    ).toBe(60);
  });
});
