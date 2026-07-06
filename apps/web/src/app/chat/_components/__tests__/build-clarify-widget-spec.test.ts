/**
 * build-clarify-widget-spec.test.ts — buildClarifyWidgetSpec / buildClarifySubmittedSpec unit
 * tests (Task 3, 24-04, D-09/D-16).
 */

import { describe, expect, it } from "vitest";

import { SpecRootSchema } from "@nauta/genui/schema";

import {
  buildClarifySubmittedSpec,
  buildClarifyWidgetSpec,
  CLARIFY_SUBMIT_ACTION_KEY,
  type ClarifyWidgetDeclaration,
} from "../build-clarify-widget-spec";

const DECLARATION: ClarifyWidgetDeclaration = {
  title: "Tell us more",
  submitLabel: "Send response",
  fields: [
    { name: "reason", label: "Reason", required: true },
    {
      name: "priority",
      label: "Priority",
      fieldType: "select",
      options: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ],
    },
    { name: "subscribe", label: "Subscribe?", fieldType: "checkbox" },
  ],
};

describe("buildClarifyWidgetSpec", () => {
  it("produces a SpecRootSchema-valid form spec", () => {
    const spec = buildClarifyWidgetSpec(DECLARATION);
    const result = SpecRootSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it("root is a form node with fields mapped 1:1 from the declaration", () => {
    const spec = buildClarifyWidgetSpec(DECLARATION) as unknown as {
      root: { type: string; fields: Array<Record<string, unknown>> };
    };
    expect(spec.root.type).toBe("form");
    expect(spec.root.fields).toHaveLength(3);
    expect(spec.root.fields[0]).toMatchObject({ name: "reason", label: "Reason", required: true });
    expect(spec.root.fields[1]).toMatchObject({
      name: "priority",
      fieldType: "select",
      options: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ],
    });
    expect(spec.root.fields[2]).toMatchObject({ name: "subscribe", fieldType: "checkbox" });
  });

  it("passes submitLabel through VERBATIM — never a 'Submit' fallback", () => {
    const spec = buildClarifyWidgetSpec(DECLARATION) as unknown as { root: { submitLabel: string } };
    expect(spec.root.submitLabel).toBe("Send response");
    expect(JSON.stringify(spec)).not.toContain('"Submit"');
  });

  it("onSubmit is a fixed setState action carrying CLARIFY_SUBMIT_ACTION_KEY", () => {
    const spec = buildClarifyWidgetSpec(DECLARATION) as unknown as {
      root: { onSubmit: { type: string; key: string; value: unknown } };
    };
    expect(spec.root.onSubmit).toEqual({ type: "setState", key: CLARIFY_SUBMIT_ACTION_KEY, value: null });
    expect(CLARIFY_SUBMIT_ACTION_KEY).toBe("clarify.submit");
  });

  it("omits title/description when the declaration has none", () => {
    const spec = buildClarifyWidgetSpec({
      submitLabel: "Confirm details",
      fields: [{ name: "a", label: "A" }],
    }) as unknown as { root: { title?: string; description?: string } };
    expect(spec.root.title).toBeUndefined();
    expect(spec.root.description).toBeUndefined();
  });
});

describe("buildClarifySubmittedSpec", () => {
  it("produces a SpecRootSchema-valid key-value-list spec", () => {
    const spec = buildClarifySubmittedSpec(DECLARATION, { reason: "Need more time", priority: "high", subscribe: true });
    const result = SpecRootSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it("emits one {key,value} item per submitted field, using the declaration's field labels", () => {
    const spec = buildClarifySubmittedSpec(DECLARATION, {
      reason: "Need more time",
      priority: "high",
      subscribe: true,
    }) as unknown as { root: { type: string; items: Array<{ key: string; value: string }> } };
    expect(spec.root.type).toBe("key-value-list");
    expect(spec.root.items).toEqual([
      { key: "Reason", value: "Need more time" },
      { key: "Priority", value: "high" },
      { key: "Subscribe?", value: "Yes" },
    ]);
  });

  it("renders a boolean false value as 'No'", () => {
    const spec = buildClarifySubmittedSpec(DECLARATION, {
      reason: "x",
      subscribe: false,
    }) as unknown as { root: { items: Array<{ key: string; value: string }> } };
    const subscribeItem = spec.root.items.find((item) => item.key === "Subscribe?");
    expect(subscribeItem?.value).toBe("No");
  });

  it("uses the declaration's title as the list's aria-label, falling back to 'Your response'", () => {
    const withTitle = buildClarifySubmittedSpec(DECLARATION, { reason: "x" }) as unknown as {
      root: { label: string };
    };
    expect(withTitle.root.label).toBe("Tell us more");

    const withoutTitle = buildClarifySubmittedSpec(
      { submitLabel: "Confirm details", fields: [{ name: "a", label: "A" }] },
      { a: "x" },
    ) as unknown as { root: { label: string } };
    expect(withoutTitle.root.label).toBe("Your response");
  });

  it("skips fields absent from the submitted values", () => {
    const spec = buildClarifySubmittedSpec(DECLARATION, { reason: "only this one" }) as unknown as {
      root: { items: Array<{ key: string }> };
    };
    expect(spec.root.items).toEqual([{ key: "Reason", value: "only this one" }]);
  });
});
