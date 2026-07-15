import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SpecRenderer } from "../renderer/spec-renderer";
import { SpecRootSchema } from "../schema/spec-schema";
import { POLYTOKEN_CATALOG } from "./manifest";
import type { SpecRoot } from "../schema/spec-schema";

/** A representative form spec (lead-capture with a conditional phone field). */
const FORM_SPEC: SpecRoot = {
  v: 1,
  root: {
    type: "form",
    title: "Lead capture",
    fields: [
      { name: "name", label: "Full name", fieldType: "text", required: true },
      { name: "email", label: "Work email", fieldType: "email", required: true },
      { name: "role", label: "Role", fieldType: "select", options: [{ label: "Eng", value: "eng" }] },
      { name: "agree", label: "I agree", fieldType: "checkbox", required: true },
      { name: "notes", label: "Notes", fieldType: "textarea", helpText: "Optional context" },
      {
        name: "phone",
        label: "Phone",
        fieldType: "tel",
        visibleWhen: { field: "contactMe", equals: true },
      },
    ],
    submitLabel: "Request a demo",
  },
} as SpecRoot;

function render(spec: SpecRoot): string {
  return renderToStaticMarkup(React.createElement(SpecRenderer, { spec }));
}

describe("form node — spec → SpecRenderer → FormComponent", () => {
  const html = render(FORM_SPEC);

  it("renders a real <form> (not the error fallback)", () => {
    expect(html).toContain("<form");
    expect(html).not.toContain("prop validation failed");
    expect(html).toContain('aria-label="Lead capture"');
  });

  it("renders every field with its label + control", () => {
    expect(html).toContain("Full name");
    expect(html).toContain("Work email");
    expect(html).toContain('type="email"');
    expect(html).toContain("<select");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<textarea");
    expect(html).toContain("Optional context"); // helpText
  });

  it("marks required fields with an asterisk", () => {
    expect(html).toContain("Full name *");
    expect(html).toContain("Work email *");
  });

  it("hides a field whose visibleWhen condition is unmet at initial render", () => {
    // contactMe defaults to false → phone is hidden
    expect(html).not.toContain(">Phone<");
  });

  it("renders the submit button with the given label and no errors initially", () => {
    expect(html).toContain("Request a demo");
    expect(html).not.toContain('role="alert"');
  });
});

describe("form node — wire ↔ render parity", () => {
  it("the manifest `form` example passes the wire SpecRootSchema", () => {
    const spec = { v: 1, root: { type: "form", ...POLYTOKEN_CATALOG.form.example } };
    expect(SpecRootSchema.safeParse(spec).success).toBe(true);
  });

  it("rejects a form field missing the a11y-required label", () => {
    const spec = {
      v: 1,
      root: { type: "form", fields: [{ name: "x", fieldType: "text" }] },
    };
    expect(SpecRootSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects a form with an empty fields array", () => {
    const spec = { v: 1, root: { type: "form", fields: [] } };
    expect(SpecRootSchema.safeParse(spec).success).toBe(false);
  });
});
