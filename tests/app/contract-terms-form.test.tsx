/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TermsForm } from "@/app/partners/[partner]/terms/terms-form";
import { emptyContractForm, type ContractFormState } from "@/terms/review-contract";

function readyForm(expectedVersion: number | null = null): ContractFormState {
  return {
    effectiveFrom: "2026-01-01",
    effectiveTo: "",
    contractAggregateCap: null,
    scopes: [
      {
        scopeId: "payments",
        kind: "service",
        services: ["payments"],
        includesScopedServices: "",
        target: "97.25",
        penaltyKind: "none",
        tiers: [{ atOrAbove: "0", credit: "", fixed: true }],
        perScopeCap: null,
        sourceClause: "FIXTURE clause alpha",
      },
    ],
    updatedBy: "ada",
    expectedVersion,
  };
}

describe("contract terms form", () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function mount(initial: ContractFormState, handlers: { onSaved?: () => void; onReload?: () => void } = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <TermsForm
          partner="roblox"
          partnerName="Roblox"
          initial={initial}
          onSaved={handlers.onSaved}
          onReload={handlers.onReload}
        />,
      );
    });
    return container;
  }

  it("shows the loader's target rule beside the field as the value is typed", async () => {
    const container = await mount(emptyContractForm());
    const input = container.querySelector("#target-scope-1");
    expect(input).toBeInstanceOf(HTMLInputElement);
    await typeInto(input as HTMLInputElement, "200");

    const field = container.querySelector('[data-field="scopes.scope-1.target"]');
    expect(field?.textContent).toMatch(/0 to 100/);
    expect(field?.querySelector("[role='alert']")).not.toBeNull();
  });

  it("warns on an empty source clause and still allows a draft save", async () => {
    const form = readyForm();
    const scope = form.scopes[0];
    if (scope === undefined) {
      throw new Error("expected a scope");
    }
    form.scopes = [{ ...scope, sourceClause: "" }];
    const fetchMock = mockFetch(() => jsonResponse({ kind: "saved", version: 1 }, 200));
    const container = await mount(form);

    const warning = container.querySelector('[data-field="scopes.payments.sourceClause"] p');
    expect(warning?.textContent).toMatch(/No source clause/);
    expect(warning?.getAttribute("role")).not.toBe("alert");

    await clickButton(container, "Save draft");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("names the partner before activation, and sends contract_bound only after confirmation", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ kind: "saved", version: 1 }, 200));
    const container = await mount(readyForm(null));

    await clickButton(container, "Activate");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Activate contract terms for Roblox? This starts scoring.");

    await clickButton(container, "Activate");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = sentBody(fetchMock) as { lifecycle: string; expectedVersion: number | null };
    expect(body.lifecycle).toBe("contract_bound");
    expect(body.expectedVersion).toBeNull();
  });

  it("shows a conflict when a save is refused, and offers to reload", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ kind: "conflict" }, 409));
    const onReload = vi.fn();
    const container = await mount(readyForm(4), { onReload });

    await clickButton(container, "Save draft");
    expect(container.textContent).toContain("Someone else changed these terms.");
    const body = sentBody(fetchMock) as { expectedVersion: number };
    expect(body.expectedVersion).toBe(4);

    await clickButton(container, "Reload");
    expect(onReload).toHaveBeenCalledOnce();
  });
});

function mockFetch(respond: (input: RequestInfo | URL, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(respond(input, init)),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof mockFetch>): unknown {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body));
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(container: ParentNode, text: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent === text);
  if (button === undefined) {
    throw new Error(`No button named ${text}`);
  }
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
