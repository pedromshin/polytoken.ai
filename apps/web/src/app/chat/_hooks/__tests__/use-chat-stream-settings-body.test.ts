/**
 * use-chat-stream-settings-body.test.ts — the seam where the reasoning dials
 * enter the model-call request (task #4, write-through). modelSettingsBody is
 * folded into the SAME POST body that carries model_id to /api/chat/stream
 * (and /regenerate, /widget/submit), so proving it here proves the dials
 * genuinely travel with the model call rather than being a UI-only knob.
 */

import { describe, expect, it } from "vitest";

import { modelSettingsBody } from "../use-chat-stream";

describe("modelSettingsBody", () => {
  it("emits nothing when no settings are supplied — byte-for-byte the pre-dial body", () => {
    expect(modelSettingsBody(undefined)).toEqual({});
  });

  it("maps mode + effort to the snake_case fields FastAPI reads alongside model_id", () => {
    expect(modelSettingsBody({ mode: "thinking", effort: "high" })).toEqual({
      model_mode: "thinking",
      reasoning_effort: "high",
    });
    expect(modelSettingsBody({ mode: "standard", effort: "low" })).toEqual({
      model_mode: "standard",
      reasoning_effort: "low",
    });
  });

  it("spreads cleanly next to the base body (the exact shape send() posts)", () => {
    const body = {
      conversation_id: "c1",
      user_text: "hi",
      model_id: "m1",
      ...modelSettingsBody({ mode: "thinking", effort: "medium" }),
    };
    expect(body).toEqual({
      conversation_id: "c1",
      user_text: "hi",
      model_id: "m1",
      model_mode: "thinking",
      reasoning_effort: "medium",
    });
  });
});
