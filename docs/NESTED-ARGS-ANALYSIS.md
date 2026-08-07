# Nested-arg capabilities through the confirm card — seam analysis

**Lane:** W8-2 (relaunch), PEDRO-CHECKLIST §6 seam
**Verdict:** `NOT-CONTAINED-ANALYSIS-ONLY`
**Date:** 2026-08-07

---

## ⛔ CORRECTION — read this before anything below (driver, 2026-08-07)

**§1.6's decisive claim was WRONG, and the error mattered.** The document argues the
REG-04 binding path is *"inert by construction"* because `SpecRootSchema` is `.strict()`
and the model *"cannot emit a `capability` field"*. A hostile review refuted it and the
driver verified the refutation against the code:

1. `turn_state.py` persists the `emit_ui_spec` tool JSON **verbatim** — its own docstring
   says *"no validation/fallback — that gate is the web boundary"*. `validate_spec` is
   never called on the chat path.
2. `extractCapabilityBinding` runs **before** `SpecRootSchema.safeParse` and *strips*
   `capability`, so the strict parse never sees the key it would have rejected. A Bedrock
   `input_schema` constrains **generation**, it does not validate (the repo knows this —
   `PARSE_FAILURE_TEXT` exists because models emit non-conforming JSON).
3. `ChatCapabilityInvokerProvider` is mounted unconditionally with five real **write-tier**
   tRPC mutations, and the confirm card displayed **no arguments at all**.

Net: an instruction injected through content the agent reads by design (mail bodies,
web-search, deep-research) could mount a live confirm card whose single blind *Approve*
fired a real mutation. **Fixed in `26da8ea4`**: a default-OFF kill switch
(`NEXT_PUBLIC_CAPABILITY_BINDING_ENABLED`) now makes the path inert *by construction*; the
card **requires** and renders its arguments; and the boundary `parseArgs`-validates before
offering approve.

**Consequences for the plan below.** §4 risk 1 has the wrong polarity — widening
`CapabilityArgsSchema` is not "a wider hole in a pipe with no inlet"; the transport is
reachable, so **Stage 2 (arg disclosure) shipped first, ahead of any widening**, which is
the correct order. Two further review corrections: `emit_confirm_action` already exists as
model-callable prior art (the model supplies only a `{kind, id}` ref and the server re-reads
the live suggestion — a strictly safer answer to model-authored args than widening the
transport, and Stage 0 must consider it); and the "a new emitter requires a settings.py
flag" containment fact is an engineering judgment, not a fact — three interactive-widget
emit tools ship unflagged. Everything else in this document was spot-checked and found
accurate.

---

## TL;DR

The brief's premise needs one correction before any plan built on it is safe.

> *"Today the capability confirm card drives FLAT-input capabilities only
> (canvas.connect / canvas.removeNode, title-only table.update); nested-arg ones
> (canvas.addNode, table.create) never light up because the binding descriptor
> produced by the emit path carries primitives only."*

The **flat/nested split is exactly right** — `CapabilityArgsSchema` is
primitives-only, and that genuinely makes `canvas.addNode` / `table.create`
inexpressible. But **"the emit path" does not exist.** No code anywhere in this
repo emits a capability binding descriptor. The confirm card drives *zero*
capabilities today, not "flat ones only". The primitives-only record is the
**second** blocker, sitting behind a missing emitter.

Widening the descriptor alone would therefore ship a wider hole in a pipe that
has no inlet — the precise "half-built seam" this lane was told to avoid.

The decisive containment fact: **building the emit site requires a new settings
flag, and `apps/email-listener/app/settings.py` is on this lane's forbidden
list.** The only alternative inlet requires regenerating a 73 KB committed
Bedrock artifact that every genui turn's structured output depends on.

---

## 1. End-to-end map

### 1.1 Substrate — how a capability declares its input

`packages/capabilities/src/capability.ts:76-106` — `Capability<TInput, …>` carries
`input: ZodType<TInput>`. That Zod schema is the *only* arg contract; it is
arbitrarily deep by construction and imposes no flatness. `CapabilityManifestEntry`
(`:122-131`) is the outward projection the card reads — `id`, `describe`, `risk`,
`reversibility`, `cost`, `source`, `trust`. **Note it carries no `input`.** The
card cannot describe arguments even in principle today.

The five client-invocable capabilities and their arg shapes:

| id | input schema | flat? |
|---|---|---|
| `canvas.connect` | `conversationId`, `sourceNodeId`, `targetNodeId`, `sourcePath?`, `targetKey?` — all strings | ✅ |
| `canvas.removeNode` | `conversationId`, `nodeId` — strings | ✅ |
| `table.update` | `spreadsheetId` + at least one of `title`/`columns`/`rows` | ✅ *title-only path only* |
| `canvas.addNode` | requires `data: z.record(z.string(), z.unknown())` (`canvas.ts:286-328`) | ❌ |
| `table.create` | requires `columns: z.array(tableColumnSchema).min(1)` (`table.ts:132-139`) | ❌ |

`canvas.addNode` additionally takes an optional `position: {x, y}` object; a
primitive cannot satisfy `z.record`, and no primitive is an array, so the two
nested capabilities fail `capability.input.safeParse` before `execute` is
reached. `table.update`'s `.refine` (`table.ts:159-163`) accepts
`spreadsheetId + title`, which is why the brief calls it "title-only". **The
brief's characterization of the flat subset is accurate.**

### 1.2 The Python mirror is NOT a mirror of these capabilities

`apps/email-listener/app/application/capabilities/registry.py` mirrors the shared
package's *metadata vocabulary* (`id`/`describe`/`risk`/`cost`/`source`/`trust`)
and its fail-closed resolution — not its capability set. What it actually
registers (`app/composition/chat_turn_providers.py:235-272`) is the chat tool
loop: `lookup_entity`, `search_emails`, `search_knowledge` (flag-gated),
`web_search` (flag-gated), `deep_research` (flag-gated). Its own module header
states it: *"All four chat tools declared today are `read`."*

There is **no** `canvas.*` or `table.*` capability on the Python side, no binding
descriptor, and no confirm concept. The brief's instruction to update "BOTH
registry mirrors together" has no Python counterpart to update — the Python
registry is a sibling abstraction, not a copy of the canvas/table declarations.
Adding one would be a new scope item, not a mirror edit.

### 1.3 The binding descriptor — the named blocker

`packages/genui/src/binding/descriptor.ts:24-28`:

```ts
export const CapabilityArgsSchema = z
  .record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  );
```

Primitives only, by explicit design ("*a spec is DATA, never executable code*").
`CapabilityBindingSchema` (`:43-50`) is `{ capabilityId, args? }`, `.strict()`.

### 1.4 The resolver — already nested-clean

`packages/genui/src/binding/bind-capability.ts`:
- `mergeArgs` (`:88-91`) — shallow spread of static args under runtime args.
- `parseArgs` (`:103-118`) — `capability.input.safeParse(merged)`. Arbitrary depth
  already works here; nothing to change.
- `invoke` (`:120-156`) — parse → `execute` → parse output.

**The resolver needs no change for nested args.** Only the transport schema
narrows it.

### 1.5 The web render path — fully built and wired

- `message-turn.tsx:408-440` — on a `genui_spec` part, calls
  `extractCapabilityBinding(part.spec)`; a null binding returns the panel
  byte-identically, a non-null one wraps it with `CapabilityBindingBoundary`.
- `capability-binding-boundary.tsx:143-159` — `extractCapabilityBinding` splits a
  top-level `capability` key off the spec and parses it with
  `CapabilityBindingSchema`.
- `capability-binding-boundary.tsx:190-240` — resolves via `tryBindCapability`
  (fail-closed), projects the manifest entry, mounts the card, and on approve
  calls `bound.invoke(ctx, binding.args)`.
- `chat-capability-invoker-provider.tsx:43-52` — wires the real tRPC mutations.
- `client-capability-registry.ts:150-153` — registers all five capabilities,
  including the two nested ones.

**The web tier is complete.** `canvas.addNode` and `table.create` are registered
and executable right now; they are unreachable only because nothing binds them.

### 1.6 The emit path — the hole

`extractCapabilityBinding` reads a top-level `capability` key on a finalized
genui spec. That spec comes from the `emit_ui_spec` tool, whose `input_schema` is
the committed Bedrock artifact:

- `chat_tools.py:100-111` — `build_emit_ui_spec_tool()` returns
  `"input_schema": load_spec_schema()`.
- `genui_artifacts.py:57-74` — loads `packages/genui/artifacts/spec.schema.json`,
  asserting a Bedrock-valid object root.
- `spec-schema.ts:657-669` — `SpecRootSchema` is `.strict()` with keys
  `_plan`, `v`, `style_pack_id`, `data`, `bindings`, `state`, `root`. **No
  `capability` key.** The string `capability` appears **0 times** in
  `spec-schema.ts` and **0 times** in the 73,832-byte generated
  `spec.schema.json`.

Because the artifact is the structured-output schema with
`additionalProperties: false`, **the model cannot emit a `capability` field even
if prompted to.** The REG-04 path is inert by construction, exactly as
`capability-binding-boundary.tsx:52-58` documents.

### 1.7 The flag named in the brief gates a different mechanism

`CANVAS_EMIT_TOOL_ENABLED` (`apps/email-listener/app/settings.py:202`, default
`False`) gates `emit_canvas_node` / `emit_canvas_connect`. Those are a **separate
pipeline**. `chat_tools.py:332-343` is explicit:

> *"they are NOT registry/executor tools, run NO server executor… Their only
> effect: a completed call appends a `canvas_add_node` / `canvas_connect` message
> PART (persisted verbatim as JSONB) that the web client materializes onto the
> canvas on the post-turn history refetch."*

Two consequences:

1. **There is no existing flag posture for the confirm-card path to hide behind.**
   The brief's "flag-dark behind the existing `CANVAS_EMIT_TOOL_ENABLED` posture"
   is not available — that flag does not reach Path A.
2. **Path B already does nested args.** `_CANVAS_NODE_INPUT_SCHEMA`
   (`chat_tools.py:368-386`) declares `"data": {"type": "object"}` and a nested
   `position: {x, y}`. Nested payloads already flow agent→canvas today — with no
   confirm gate, no registry, and no Zod validation. That is worth knowing before
   anyone builds a second nested-arg road.

### 1.8 The card shows no arguments at all

`capability-confirm-card.tsx:97-149` renders the risk swatch, `entry.id`,
`entry.describe`, and the tier meaning. It renders **nothing about the payload**.
For the flat capabilities that is tolerable ("remove a node"). For
`table.create` with 14 rows, or `canvas.addNode` with a `data` blob, "Approve
table.create" would ask a human to authorize an invisible write.

`BoundCapability.parseArgs` exists precisely for pre-confirm validation
(`bind-capability.ts:63-65`) and the boundary **never calls it**. Widening args
without widening disclosure converts the confirm card from a safety affordance
into a rubber stamp.

---

## 2. Exact blocking ripples

| # | Change needed | Contained? | Why |
|---|---|---|---|
| 1 | Widen `CapabilityArgsSchema` to a recursive JSON value | ✅ yes | ~10 lines + tests in `packages/genui`. Self-contained. |
| 2 | Resolver / invoke plumbing | ✅ no change | `capability.input.safeParse` is already depth-agnostic. |
| 3 | **Emit site** | ❌ **NO** | See below — this is the blocker. |
| 4 | Card arg disclosure + pre-confirm validation | ⚠️ borderline | One component + tests, but it is a design-law surface (58-IDENTITY / taste-references) and needs a real review, not a bolt-on. |
| 5 | Python registry mirror | ❌ out of scope | No canvas/table capabilities exist there; adding them is new scope, not a mirror edit. |

### Why the emit site is not containable

Two possible inlets, both blocked or oversized:

**Option A — add `capability` to `SpecRootSchema`.**
Requires editing `packages/genui/src/schema/spec-schema.ts`, then running
`npm run gen:artifacts -w @polytoken/genui` to regenerate the committed
73,832-byte `packages/genui/artifacts/spec.schema.json`. That artifact is the
Bedrock `input_schema` for **every genui turn**. Blast radius: the studio's
forced-tool path, `artifact-builder.ts`, prompt-cache keys, and the D-11
validated-spec cache-persist path in `generate_ui_spec.py:230-244`. A
regenerated structured-output schema is not a flag-dark change — it alters the
tool contract for all traffic the moment it ships, with no per-feature kill
switch.

**Option B — a dedicated emit tool + new message part.**
`emit_capability_binding` in `chat_tools.py`, finalization in `turn_state.py`, a
new part type persisted as JSONB, plus web render. This is the cleaner design
and mirrors the existing Path B machinery. **But it needs an exposure flag, and
every such flag lives in `apps/email-listener/app/settings.py` — forbidden to
this lane.** Shipping a model-callable mutation tool with no kill switch is not
an option; `risk: "write"` capabilities reaching a real tRPC mutation is exactly
what flag-gating exists for.

Either inlet also means the listener changes, triggering the full Python gate
set (`uv run pytest` + `mypy` + `ruff` + `lint-imports`) — appropriate for a
funded phase, oversized for a lane whose grant excludes the file that holds
the switch.

---

## 3. Staged plan

### Stage 0 — decide the inlet (design, no code)
Pick Option A or Option B. Recommendation: **Option B**. It keeps the genui
structured-output contract frozen, mirrors machinery that already works
(Path B), and gets a real kill switch. Also decide whether Path B's existing
`emit_canvas_node` should be *migrated onto* the registry rather than a second
nested-arg road being built beside it — today the repo would have two ways for
an agent to add a canvas node, one gated by a confirm card and one not.

### Stage 1 — widen the transport descriptor *(contained; do not ship alone)*
`packages/genui/src/binding/descriptor.ts` — replace the primitive union with a
recursive JSON value (`z.lazy`), keeping a depth/size cap so an agent cannot
smuggle an unbounded blob through a transport schema.

Carry over the prototype-pollution posture the capability schemas already
enforce (`canvas.ts:55-66`, `table.ts:37-48`) — `__proto__` / `constructor` /
`prototype` rejected at any depth, at the transport boundary too.

Update the module header: the "primitives only" rationale is load-bearing
documentation and must not silently become false.

**Gate:** `npm test -w @polytoken/genui` (targeted: `binding/__tests__/`) +
`npm run typecheck -w @polytoken/genui`. New RED test first: a nested
`{ data: { threadId } }` binding parses and `parseArgs` accepts it against
`canvasAddNodeInputSchema`.

### Stage 2 — card arg disclosure *(do BEFORE any emitter goes live)*
Extend `CapabilityManifestEntry` consumption so the card can state what will be
written: a bounded, human-readable summary of `binding.args`, plus a
`parseArgs()` call so an invalid payload is shown as a field error *instead of*
an Approve button. Design-law review required (58-IDENTITY, taste-references
§2.2) — the card is a confirm affordance and its register is already argued
line-by-line in its header.

**Gate:** `npm test -w apps/web` targeted at
`capability-confirm-card.test.tsx` + `capability-binding-boundary.test.tsx`;
`npm run typecheck -w apps/web`.

### Stage 3 — the emitter, flag-dark *(needs the settings.py grant)*
Per Stage 0's choice. New setting (default `False`), structural omission when
off — matching the `SEARCH_KNOWLEDGE_TOOL_ENABLED` / `WEB_SEARCH_TOOL_ENABLED` /
`CANVAS_EMIT_TOOL_ENABLED` idiom already in `chat_turn_providers.py`.

**Gate:** `cd apps/email-listener && uv run pytest` (FULL) + `uv run mypy app` +
`uv run ruff check` + `uv run lint-imports`.

### Stage 4 — end-to-end proof
One capability (`canvas.addNode`) from tool call → part → binding → card →
`invoke` → tRPC → persisted layout row. Because this is a rendered-geometry
surface, jsdom is not proof: `npm run screenshot:review` against an
already-running server, and read the PNGs.

---

## 4. Risks

1. **Widening args in isolation is a net negative.** It enlarges the payload a
   confirm card cannot display, on a path with no emitter. Stage 1 must not ship
   without Stage 2.
2. **Two roads to the same effect.** `emit_canvas_node` (Path B, unvalidated, no
   confirm) and a registry-bound `canvas.addNode` (Path A, Zod-fenced,
   confirmed) would coexist. Decide the migration in Stage 0 or the divergence
   becomes permanent.
3. **Regenerating `spec.schema.json` is not reversible-by-flag.** If Option A is
   chosen, the tool contract changes for all genui traffic on deploy.
4. **`risk: "write"` reaching a real mutation.** All five wired capabilities hit
   `protectedProcedure` tRPC mutations that write user data. The confirm card is
   the only gate between an agent-chosen payload and that write. Its
   trustworthiness is a product requirement, not polish.
5. **Unbounded nested args.** A recursive transport schema without a depth/size
   cap lets an agent push an arbitrarily large blob into a JSONB part.
6. **The Python "mirror" framing invites scope error.** A future brief repeating
   "update both mirrors" will send someone hunting for canvas/table capabilities
   in Python that do not exist. Recorded here to prevent that.

---

## 5. What this lane changed

Only this file. No production code touched — the honest outcome per the lane's
own instruction: *"an analysis that saves a future wave from a half-built seam is
the better outcome."*
