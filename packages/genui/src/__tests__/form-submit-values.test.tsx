/**
 * __tests__/form-submit-values.test.tsx — proves FormComponent's handleSubmit passes the
 * submitted FormValues snapshot through the ActionRegistry seam (24-04 Task 2, 23-06
 * ButtonComponent precedent).
 *
 * Exercises the REAL production path end-to-end: a SpecRootSchema-valid form node ->
 * SpecRenderer -> the catalog's FormComponent -> ActionRegistryContext lookup -> the
 * caller-supplied handler. No mocks of the renderer, schema, or catalog — mirrors
 * button-action.test.tsx's createRoot-in-jsdom + `act` convention.
 */

import * as React from "react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { SpecRenderer } from "../renderer/spec-renderer";
import type { ActionRegistry } from "../renderer/action-registry-context";
import type { SpecRoot } from "../schema/spec-schema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function buildFormSpec(formProps: Record<string, unknown>): SpecRoot {
  return {
    v: 1,
    root: { type: "form", ...formProps },
  } as unknown as SpecRoot;
}

async function mountSpec(
  spec: SpecRoot,
  actions?: ActionRegistry,
): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(SpecRenderer, { spec, actions }));
  });

  return {
    container,
    cleanup: () => {
      root.unmount();
      document.body.removeChild(container);
    },
  };
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const TWO_FIELD_FORM_PROPS = {
  fields: [
    { name: "fieldA", label: "Field A" },
    { name: "fieldB", label: "Field B" },
  ],
  onSubmit: { type: "setState", key: "clarify.submit", value: null },
};

describe("FormComponent submit values (24-04 Task 2)", () => {
  it("Test 1 — a VALID submit passes {...onSubmit, values} to the registry setState handler", async () => {
    const spy = vi.fn();
    const spec = buildFormSpec(TWO_FIELD_FORM_PROPS);

    const { container, cleanup } = await mountSpec(spec, { setState: spy });

    const fieldAInput = container.querySelector("#field-fieldA") as HTMLInputElement;
    const fieldBInput = container.querySelector("#field-fieldB") as HTMLInputElement;
    expect(fieldAInput).not.toBeNull();
    expect(fieldBInput).not.toBeNull();

    await act(async () => {
      setNativeInputValue(fieldAInput, "hello");
      setNativeInputValue(fieldBInput, "world");
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      type: "setState",
      key: "clarify.submit",
      value: null,
      values: { fieldA: "hello", fieldB: "world" },
    });
    cleanup();
  });

  it("Test 1b — a number field submits a REAL number, not the DOM's string (wire {\"type\":\"number\"} contract)", async () => {
    const spy = vi.fn();
    const spec = buildFormSpec({
      fields: [{ name: "amount", label: "Amount", fieldType: "number" }],
      onSubmit: { type: "setState", key: "clarify.submit", value: null },
    });

    const { container, cleanup } = await mountSpec(spec, { setState: spy });

    const amountInput = container.querySelector("#field-amount") as HTMLInputElement;
    expect(amountInput).not.toBeNull();
    await act(async () => {
      setNativeInputValue(amountInput, "42");
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      type: "setState",
      key: "clarify.submit",
      value: null,
      values: { amount: 42 },
    });
    cleanup();
  });

  it("Test 2 — an INVALID submit (missing required field) never invokes the registry handler", async () => {
    const spy = vi.fn();
    const spec = buildFormSpec({
      fields: [{ name: "fieldA", label: "Field A", required: true }],
      onSubmit: { type: "setState", key: "clarify.submit", value: null },
    });

    const { container, cleanup } = await mountSpec(spec, { setState: spy });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });

    expect(spy).not.toHaveBeenCalled();
    cleanup();
  });

  it("Test 3 — the built-in setState handler (buildActionRegistry) ignores the extra `values` key (regression)", async () => {
    const { buildActionRegistry } = await import("../renderer/action-handlers");
    const dispatch = vi.fn();
    const registry = buildActionRegistry({
      router: { push: vi.fn() },
      trpcUtils: { invalidate: vi.fn().mockResolvedValue(undefined) },
      declaredState: { state: {}, dispatch },
    });

    const spec = buildFormSpec(TWO_FIELD_FORM_PROPS);
    const { container, cleanup } = await mountSpec(spec, registry);

    const fieldAInput = container.querySelector("#field-fieldA") as HTMLInputElement;
    const fieldBInput = container.querySelector("#field-fieldB") as HTMLInputElement;
    await act(async () => {
      setNativeInputValue(fieldAInput, "hi");
      setNativeInputValue(fieldBInput, "there");
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });

    // The built-in handler destructures only {key, value} — an extra `values`
    // key on the payload must not throw or change its dispatch behavior.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("clarify.submit", null);
    cleanup();
  });
});
