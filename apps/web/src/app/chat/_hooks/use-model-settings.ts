"use client";

/**
 * use-model-settings.ts — the ONE source of truth for a conversation's
 * per-turn model *settings* (reasoning mode + effort), alongside the model id
 * itself (which is persisted server-side on the chat_conversations row, D-10).
 *
 * WHY A SEPARATE STORE, NOT A SECOND SOURCE OF TRUTH: model *selection* already
 * has a durable home — chat_conversations.model_id, written by chat.setModel
 * (ModelPickerPanel) and read back into ConversationView's `modelId` prop. Mode
 * and effort are new dials with NO server column yet, so persisting them would
 * require a migration this slice deliberately does not run. They live here,
 * keyed per conversation in localStorage, and — critically — they are read at
 * exactly ONE place: the send path (useConversationController ->
 * useChatStream.send/regenerate), which folds them into the SAME POST body that
 * carries model_id to /api/chat/stream. So the FAB's dials and the model call
 * read/write the SAME store; there is no knob that the request ignores.
 *
 * The value travels with the model call as `model_mode` / `reasoning_effort`
 * (see use-chat-stream.ts + the /api/chat/stream route). The FastAPI
 * ChatStreamRequest currently ignores unknown fields (Pydantic default
 * extra="ignore"), so this wiring is additive and cannot break an existing
 * turn; backend consumption of the two dials is a follow-up, but the plumbing
 * is real end-to-end from the FAB to the request body.
 */

import { useCallback, useEffect, useState } from "react";

export type ModelMode = "standard" | "thinking";
export type ReasoningEffort = "low" | "medium" | "high";

export interface ModelSettings {
  readonly mode: ModelMode;
  readonly effort: ReasoningEffort;
}

/** Standard/medium — a safe, cheap default that matches the pre-dial behavior
 * (no extended thinking, balanced effort) so a conversation the user never
 * touches the dials on behaves exactly as it did before this slice. */
export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  mode: "standard",
  effort: "medium",
};

export const MODEL_MODE_OPTIONS: ReadonlyArray<{
  readonly value: ModelMode;
  readonly label: string;
}> = [
  { value: "standard", label: "Standard" },
  { value: "thinking", label: "Extended thinking" },
];

export const REASONING_EFFORT_OPTIONS: ReadonlyArray<{
  readonly value: ReasoningEffort;
  readonly label: string;
}> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const MODE_VALUES: ReadonlySet<string> = new Set<ModelMode>([
  "standard",
  "thinking",
]);
const EFFORT_VALUES: ReadonlySet<string> = new Set<ReasoningEffort>([
  "low",
  "medium",
  "high",
]);

/** localStorage key for a conversation's dials. Per-conversation so switching
 * conversations swaps the remembered dials, exactly as switching swaps the
 * model id. */
export function modelSettingsStorageKey(conversationId: string): string {
  return `polytoken.chat.model-settings.${conversationId}`;
}

/**
 * parseStoredModelSettings — tolerant reader. Any malformed / partial / absent
 * value degrades field-by-field to the default rather than throwing (untrusted
 * localStorage the user or another tab could have written). Never returns an
 * out-of-domain mode/effort.
 */
export function parseStoredModelSettings(raw: string | null): ModelSettings {
  if (raw === null) return DEFAULT_MODEL_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_MODEL_SETTINGS;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return DEFAULT_MODEL_SETTINGS;
  }
  const record = parsed as Record<string, unknown>;
  const mode =
    typeof record.mode === "string" && MODE_VALUES.has(record.mode)
      ? (record.mode as ModelMode)
      : DEFAULT_MODEL_SETTINGS.mode;
  const effort =
    typeof record.effort === "string" && EFFORT_VALUES.has(record.effort)
      ? (record.effort as ReasoningEffort)
      : DEFAULT_MODEL_SETTINGS.effort;
  return { mode, effort };
}

export function serializeModelSettings(settings: ModelSettings): string {
  return JSON.stringify({ mode: settings.mode, effort: settings.effort });
}

/** SSR-safe localStorage read (returns default on the server / no-DOM). */
function readSettings(conversationId: string | null): ModelSettings {
  if (conversationId === null || typeof window === "undefined") {
    return DEFAULT_MODEL_SETTINGS;
  }
  try {
    return parseStoredModelSettings(
      window.localStorage.getItem(modelSettingsStorageKey(conversationId)),
    );
  } catch {
    // localStorage can throw (private mode, quota) — never let it crash chat.
    return DEFAULT_MODEL_SETTINGS;
  }
}

function writeSettings(conversationId: string, settings: ModelSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      modelSettingsStorageKey(conversationId),
      serializeModelSettings(settings),
    );
  } catch {
    // best-effort persistence — an in-memory value still drives the turn.
  }
}

export interface UseModelSettingsResult {
  readonly settings: ModelSettings;
  readonly setMode: (mode: ModelMode) => void;
  readonly setEffort: (effort: ReasoningEffort) => void;
}

/**
 * useModelSettings — reactive per-conversation dials. A null conversationId
 * (the /chat empty state, no conversation open) yields the defaults and no-op
 * setters, so the FAB can render its dials disabled without a second code path.
 * Re-reads storage whenever the conversation id changes (switching
 * conversations swaps the remembered dials).
 */
export function useModelSettings(
  conversationId: string | null,
): UseModelSettingsResult {
  const [settings, setSettings] = useState<ModelSettings>(() =>
    readSettings(conversationId),
  );

  useEffect(() => {
    setSettings(readSettings(conversationId));
  }, [conversationId]);

  const setMode = useCallback(
    (mode: ModelMode) => {
      if (conversationId === null) return;
      setSettings((prev) => {
        const next = { ...prev, mode };
        writeSettings(conversationId, next);
        return next;
      });
    },
    [conversationId],
  );

  const setEffort = useCallback(
    (effort: ReasoningEffort) => {
      if (conversationId === null) return;
      setSettings((prev) => {
        const next = { ...prev, effort };
        writeSettings(conversationId, next);
        return next;
      });
    },
    [conversationId],
  );

  return { settings, setMode, setEffort };
}
