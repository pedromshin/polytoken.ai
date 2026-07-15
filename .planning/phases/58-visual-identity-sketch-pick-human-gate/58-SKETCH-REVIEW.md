# 58 — Visual Identity Sketch Review

Rendered with Playwright (chromium via `playwright-core`, already vendored in the repo) at
1440×2400 (full-page, `preview-{a,b,c}.png`) and re-checked at a 1024px-wide viewport
(`preview-{a,b,c}-1024.png`) to test breakage. All three renders succeeded — no fallback to
source-only review was needed. Judged from the rendered pixels, cross-checked against the raw
HTML/CSS for the bans (gradient-text, shadow/border combos, radius values, banned vocabulary in
rendered text) where pixel inspection alone couldn't settle it.

All three files render CONTENT-SPEC's fixture byte-for-byte identically (verified by string
count: `Rafael Lima` ×8, `Rodocargo` ×4, `Transportes Andrade` ×4, `Load more` ×1, etc. — same
counts across all three source files) — so nothing below is a content gap common to all three;
differences are visual-identity only, as the brief requires.

## Verdict table

| Criterion | A — Provenance | B — Threadwork | C — Quiet Precision |
|---|---|---|---|
| 1. Distinct | PASS | PASS | PASS |
| 2. Internally consistent | PASS | PASS | PASS |
| 3. Content fidelity | PASS | PASS | PASS |
| 4. Bans | PASS | PASS | PASS |
| 5. Production-grade | FAIL (1024px reading-pane heading wraps one-word-per-line, 7 lines tall — see below) | PASS | PASS |

## Direction A — Provenance

Cream/paper "ledger" palette (`#F1EFE7`–`#FAF9F4` grounds, `#24271F` ink) pairing a UI sans
(Archivo) with a serif (Iowan Old Style/Palatino) reserved for headings, body copy, and chip
values — flat throughout, zero `box-shadow` anywhere in the file, structure carried entirely by
1px hairline rules (`--rule:#C7C5B6`) and thin full-width dividers under every section label
("Inbox ————", "Chat & Canvas ————"). Confidence is a small filled square (■, solid = Confirmed)
vs. a dashed-border hollow circle (Suggested) — present on inbox chips, the entity-detail rows,
and knowledge-canvas node dots alike, so the signature mark does show up on all three screens.

**Distinctive:** the total absence of shadow/elevation — every surface is either a flat fill or a
ruled boundary, which is a real point of difference from B and C (both of which use at least one
soft shadow for toasts/rings). Entity-type hues (supplier/person/amount/document) are desaturated
slate/mauve/green/olive rather than saturated, reinforcing the "archival ledger" read.

**Cost:** cream ground + serif headings is explicitly the AI-default combo the brief warns about.
A avoids the *terracotta* half of that cliché (its action color is a blue-slate `#35516B`, not
rust — rust is reserved for the destructive-only `--bad`), but the base material is still
cream-and-serif, and a stranger's first read is more likely to land on "editorial/archive" gestalt
than register the flat-shadow discipline underneath it. Choosing A commits the product to serif
headings everywhere and to zero elevation as a hard rule (no shadow-based layering ever).

**Issue found:** at the 1024px check, the reading pane's subject heading
("Cotação frete SP → POA — Lote 88") wraps to one or two words per line across seven lines,
because the four-pane layout doesn't reduce pane count or reserve enough width for that column at
that breakpoint — the heading's serif weight/size was tuned for the wider column. Confirmed
against B and C at the same 1024px viewport, both of which wrap the identical string to a normal
2-line break. This is a concrete instance of ban #8 (awkward heading wrap) and is why criterion 5
fails for A; nothing else in A broke or overlapped.

## Direction B — Threadwork

Mint-and-white product palette (`#F4F7F6` ground, `#FFFFFF` surface, `#14655A` brand teal) with a
rounded humanist sans (Nunito) for UI text and a monospace (Cascadia Code/SF Mono) reserved for
numerals in tables and chip values. Radii run large and consistent — 999px pills for every chip,
button, and badge; 18–20px for cards/panels. The signature threadline (a 2px stroke with a small
circle "joint" at each connection point) is explicit and literal: it stitches together
multi-message threads in the inbox, chat-to-source-card edges on the canvas, and
confirmed/suggested relationship edges in the knowledge graph — present, working, and named in the
UI copy itself ("every relationship is a visible thread with a joint at each end").

**Distinctive:** the joint-dot line is a genuinely novel connective visual, not a generic
node-link edge — it reads as hand-stitched rather than diagrammatic, and it's the only direction
where the connective tissue between entities/messages/sources is itself the branded element rather
than the entities.

**Cost:** rounded-pill-everywhere plus mint/white is close to a friendly modern-SaaS default;
without the threadline doing real work on every screen, B would read as a generic "approachable
fintech" template. It's the threadline earning its keep that makes B distinct rather than generic.
Choosing B commits the product to a warm rounded-corner ceiling (pills for every interactive
element) and to color-by-entity-family as the primary confidence/type encoding (a genuinely
multi-hue system, more colors in simultaneous use than A or C).

**No breakage found** at either viewport. At 1024px the canvas content (chat screen, knowledge
screen) runs past the right edge of the frame rather than reflowing — expected and acceptable
since canvas surfaces are meant to pan/scroll, not reflow like a document.

## Direction C — Quiet Precision

Near-black dark theme (`#14110e`-family grounds, warm off-white `#ece5d8` text) with IBM Plex Sans
/ Plex Sans Condensed, tracked small-caps section labels used as the actual heading treatment
("INBOX — THREE-PANE", "CHAT & CANVAS"), and a compact two-tick "meter" glyph (▬▬, filled vs.
hollow-outlined tick) as the confidence indicator — used on inbox row markers, entity chips,
citation chips, knowledge-node badges, and the components-strip badges alike, so the signature
element is present and consistent across all three screens (plus the row-level micro-meter is an
extra, unrequested reinforcement of it).

**Distinctive:** the accent palette (`amber #d9a13f`, `green #79b784`, `blue #7ba3d6`,
`violet #a891d8`, `red #c9705c`) is dark-theme but deliberately desaturated/dusty rather than
neon — it avoids the "near-black + acid-accent" AI-default the brief calls out by name. The
two-tick meter is a distinctly technical/instrumentation-flavored confidence signal, different in
kind from A's stamp-square and B's colored dot.

**Cost:** dark-first is a real commitment (no light-mode variant sketched or implied), and the
tracked small-caps-as-heading device, applied uniformly to all four section titles, is a
consistent typographic voice but sits close to ban #6's "eyebrow label" pattern — here it *is* the
heading rather than a label sitting above a separate heading, so it doesn't technically trip the
ban, but it's a small stylistic gamble that reads as more "engineering console" than "warm
companion," which is a tension worth naming given brand-guide's warm-first-person voice mandate
applies to copy, not chrome. The two-tick meter's individual ticks are small (~4×7px) — legible at
1440px but worth a second look at accessibility/zoom before committing to it as the sole
confidence-tier signal (color remains the primary carrier, so it isn't a hard failure).

**No breakage found** at either viewport; the 1024px reading-pane heading wraps normally (2–3
lines, multiple words per line), unlike A.

## Comparison — what each choice commits the product to

- **A (Provenance)** commits to serif-for-evidence typography, zero shadow/elevation as a
  standing rule, and a light, paper/archive material system. It reads as the most "considered
  document" of the three, and is the one most exposed to the cream+serif AI-default risk on first
  glance, even though its accent choices (blue-slate action color, muted type hues) pull it away
  from that on closer inspection.
- **B (Threadwork)** commits to dark-signature connective lines as the primary branded element, a
  fully rounded/pill-shaped control vocabulary, and a wider simultaneous color palette
  (color-by-entity-family) than the other two. It's the warmest and softest of the three at a
  glance.
- **C (Quiet Precision)** commits to dark-first as the only mode sketched, a compact
  instrumentation-style confidence glyph, and a condensed/tracked typographic voice for section
  identity. It's the coolest and most technical-reading of the three, closest to a "control panel"
  feel, balanced by a genuinely non-neon accent palette.

No recommendation is made here — this is the user's call. A's 1024px heading-wrap defect is a
concrete, fixable production bug (not a taste judgment) and is reported as such under criterion 5;
it does not reflect on the Provenance direction's visual identity itself, which is otherwise
internally consistent and clean at the primary 1440px viewport.
