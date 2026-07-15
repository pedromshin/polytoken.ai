# CONTENT-SPEC — shared fixture content for the three visual-identity sketches

All three direction builders render THIS content byte-for-byte. The only variable between
sketches is visual identity (color, type, spacing, texture, chrome). Copy, numbers, names,
timestamps, and region structure below are LOCKED. Derived from the real shipped surfaces
(`inbox-three-pane.tsx`, `chat/_components`, `chat/_canvas`, `knowledge/_components`) and the
voice rules in `docs/design/brand-guide.md`.

## Global fixture facts

- Persona: **Pedro** — forwards his real mail to **`pedro@in.polytoken.ai`**.
- UI language: **English**. Business content (subjects, bodies, names) is Brazilian-flavored
  and may be Portuguese. Currency: Brazilian format (`R$ 4.820,00`). Timestamps: Portuguese
  weekday abbreviation + 24h — `Ter 14:32`, `Seg 18:47`, `Sex 16:20`, `Qui 07:58`.
- Voice (brand-guide §2): warm, first-person companion. Say "source", "connection",
  "your inbox", "your knowledge". NEVER render in UI copy: "node", "pipeline", "daemon",
  "graph", "compute", "extraction", raw tier enums (EXTRACTED/INFERRED/AMBIGUOUS).
- Confidence vocabulary (user-facing, from graph-legend.tsx): **Confirmed** (solid),
  **Suggested** (dashed/muted), **Uncertain** (faint). Confirmed and Suggested must be
  visually distinguishable at a glance on chips, badges, entities, and connections.
- Product name: **polytoken** (lowercase in wordmark contexts is the builder's call).
- Global nav (all three screens, left edge or top — builder's layout call, same items):
  brand mark, then **Inbox · Chat · Knowledge**, user avatar "P" at the end.

---

## Screen 1 — Inbox (three-pane)

Regions: filters rail (left) · thread list (middle) · reading pane + extracted-entities
detail (right). Middle-pane header: **"Inbox"** + count badge **"7"**.

### Filters rail
Header **"Filters"**. Items (top-to-bottom): **All** (active) · **Unread** · **With entities**.
Below the items, the empty-rail hint (microcopy, muted):
> "Forward anything to pedro@in.polytoken.ai — I'll read it and pull out what matters."

### Thread list — exactly 7 rows, this order (newest first)

Row anatomy: sender (semibold) + time (right-aligned) / subject (truncated) / entity chips
(pill, max 4, "+N" overflow). Multi-message threads show a chevron + count badge and the
latest snippet. Row 1 is SELECTED (and expanded). Row 2 is UNREAD (unread marker, builder's
treatment).

1. **Thread (3 messages, selected, expanded)** — badge **3** · `Ter 14:32`
   Subject: **Cotação frete SP → POA — Lote 88**
   Snippet: "Consigo fechar em R$ 4.820,00 com coleta na sexta (18/07)…"
   Expanded members (newest first): 1) **Rafael Lima** `Ter 14:32` (selected) ·
   2) **Rafael Lima** `Seg 10:12` "Segue proposta inicial: R$ 5.150,00, coleta em 5 dias úteis." ·
   3) **Pedro Shin** `Sex 17:03` "Rafael, preciso de cotação para o Lote 88 até quarta."
   Chips on member 1: `Acme Freight · supplier` (Confirmed) · `R$ 4.820,00 · amount`
   (Confirmed) · `18 Jul · date` (Suggested)
2. **Marina Costa** · `Ter 11:05` · **UNREAD**
   Subject: **Proposta comercial — Embalagens Rio Claro**
   Snippet: "Conforme conversamos, segue nossa proposta para o contrato anual…"
   Chips: `Embalagens Rio Claro · supplier` (Suggested) · `Marina Costa · person` (Suggested)
3. **Papelaria Vitória** · `Ter 09:14`
   Subject: **NF-e 3412 — Papelaria Vitória Ltda**
   Snippet: "Segue em anexo a Nota Fiscal Eletrônica referente ao pedido #2210."
   Chips: `Papelaria Vitória · supplier` (Confirmed) · `NF-e 3412 · document` (Confirmed) ·
   `R$ 1.284,50 · amount` (Confirmed)
4. **LATAM Airlines** · `Seg 18:47`
   Subject: **Booking confirmed — GRU → REC, 22 Jul**
   Snippet: "Your booking XKJ9PW is confirmed. Check-in opens 48h before departure."
   Chips: `LATAM Airlines · supplier` (Confirmed) · `XKJ9PW · document` (Confirmed) ·
   `22 Jul · date` (Confirmed)
5. **Conta Azul** · `Seg 08:30` · attachment indicator (paperclip) + `recibo-8817.pdf`
   Subject: **Recibo #8817 — Plano anual**
   Snippet: "Obrigado! Seu pagamento foi confirmado. Recibo em anexo."
   Chips: `Conta Azul · supplier` (Confirmed) · `R$ 948,00 · amount` (Confirmed) ·
   `Recibo #8817 · document` (Suggested)
6. **Banco Itaú** · `Sex 16:20`
   Subject: **Extrato mensal — Junho 2026**
   Snippet: "Seu extrato consolidado de junho já está disponível."
   Chips: `Banco Itaú · supplier` (Confirmed) · `Extrato Jun/2026 · document` (Confirmed)
7. **Filipe Deschamps** · `Qui 07:58`
   Subject: **☕ Edição #1.204 — IA, chips e Selic**
   Snippet: "Bom dia! Hoje: data centers no Nordeste, Selic parada e um bug de 30 anos."
   Chips: none (no chip row rendered — anti-bloat, matches shipped behavior)

Below the list: outline button, full width: **"Load more"**.

### Reading pane (selected message = thread 1, member 1)
Header: subject **"Cotação frete SP → POA — Lote 88"** + button **"Open email →"**.
From: **Rafael Lima \<rafael@acmefreight.com.br\>** · To: **pedro@in.polytoken.ai**
Body (verbatim, plain text):
> Oi Pedro, tudo bem?
>
> Consigo fechar em R$ 4.820,00 com coleta na sexta (18/07) e entrega em Porto Alegre na
> quarta seguinte (23/07). Inclui seguro e rastreio. Se confirmar até amanhã, seguro esse
> valor.
>
> Abraço,
> Rafael Lima — Acme Freight

### Extracted-entities detail (right pane)
Heading: **"What I found in this email"**. Four entity rows (label · type · confidence badge):
1. **Rafael Lima** · person · `Confirmed`
2. **Acme Freight** · supplier · `Confirmed`
3. **R$ 4.820,00** · amount · `Confirmed`
4. **18 Jul 2026** · date · `Suggested` — with inline actions **"Confirm"** · **"Dismiss"**
Footer link: **"See it all in your knowledge →"**

---

## Screen 2 — Chat + Canvas

Regions: conversation rail (far left, slim) · docked chat column · canvas (right, dominant).
Canvas top-right shows save status: **"Saved just now"**.

### Conversation rail
Header action: **"New chat"** (+ icon). Items: **Freight quote — Lote 88** (active) ·
**June spending recap** · **Flight to Recife**.

### Chat column — exactly 2 exchanges
Turn anatomy: user turns are right-aligned bubbles; assistant turns are plain, full-width.

1. **User:** "What did Acme Freight quote for Lote 88, and how does it compare to the other
   quotes I got?"
2. **Assistant:**
   - Tool-activity row (settled, quiet single line): **"Searched your mail — 3 results"**
     followed by one citation chip: **`Cotação frete SP → POA — Lote 88`** (email-source chip)
   - Answer text: "Acme Freight came back at **R$ 4.820,00** — pickup Friday 18 Jul, delivery
     in Porto Alegre on Wednesday 23 Jul, insurance and tracking included. You also have
     Transportes Andrade at R$ 5.310,00 and Rodocargo at R$ 4.590,00, but Rodocargo doesn't
     include insurance. Acme is the only one holding its price — until tomorrow."
3. **User:** "Put them side by side for me."
4. **Assistant:** "Here you go — I've laid the three quotes out on your canvas." (the table
   panel below appears on the canvas, connected to this chat)

Composer (bottom of chat column): textarea placeholder **"Ask me anything — I'll check your
mail first."** + send button (icon-only, aria-label "Send message").

### Canvas — 4 cards + 2 connections
Card anatomy: compact header row (type icon + truncating title + remove "×"), body, footer
actions where listed.

1. **Email-thread card** — title **"Cotação frete SP → POA — Lote 88"**
   Body: participants line **"Rafael Lima, you · 3 messages"** + snippet "Consigo fechar em
   R$ 4.820,00 com coleta na sexta (18/07) e entrega em Porto Alegre na quarta seguinte…"
   Footer: **"Open thread →"** · **"Attach chat"**
2. **Generated table panel** — header caption **"From turn 2"**, title **"Freight quotes —
   Lote 88"**. Table (4 cols × 5 data rows, exact):

   |                  | Acme Freight | Transportes Andrade | Rodocargo    |
   |------------------|--------------|---------------------|--------------|
   | Price            | R$ 4.820,00  | R$ 5.310,00         | R$ 4.590,00  |
   | Pickup           | Sex 18 Jul   | Ter 22 Jul          | Sex 18 Jul   |
   | Delivery         | Qua 23 Jul   | Sex 25 Jul          | Seg 28 Jul   |
   | Insurance        | Included     | Included            | Not included |
   | Price held until | Qua 15 Jul   | —                   | Sáb 19 Jul   |

3. **Source card (web)** — title **"Tabela Nacional de Fretes — atualização julho 2026"**
   URL line: `gov.br/antt/tabela-de-fretes` · caption **"Saved from the web"**
4. **Source card (web)** — title **"Como negociar frete com seguro incluído"**
   URL line: `blog.contaazul.com/negociar-frete` · caption **"Saved from the web"**

Connections (visible edges): source card 3 → chat column/chat card, labeled
**"in this chat"**; table panel 2 → email-thread card 1, unlabeled.

---

## Screen 3 — Knowledge

Regions: filter rail (left, ~240px) · exploration canvas (center) · detail pane (right,
~320px) · legend chip-row pinned bottom-left of the canvas: **Confirmed** (solid swatch) ·
**Suggested** (dashed swatch) · **Uncertain** (faint swatch).

Canvas toolbar (top): segmented control, 3 segments: **"Confirmed only"** ·
**"+ Suggested"** (active) · **"Everything"**.

### Filter rail
Header (small caps): **"Show"**. Checkbox rows (color dot + label): **Suppliers** (checked) ·
**People** (checked) · **Amounts** (checked) · **Documents** (checked) · **Emails**
(unchecked). Separator. Switch row: **"Show suggested connections"** (ON) with sub-label
**"I'll mark anything I'm not sure about."** Footer count line: **"9 entities · 6
connections · from 14 emails"**.

### Canvas — exactly 9 labeled entities
(type drives dot/shape color; confidence drives solid-vs-dashed/muted treatment)

| # | Label                 | Type     | Confidence |
|---|-----------------------|----------|------------|
| 1 | Acme Freight          | supplier | Confirmed — SELECTED |
| 2 | Transportes Andrade   | supplier | Confirmed  |
| 3 | Rodocargo             | supplier | Suggested  |
| 4 | Embalagens Rio Claro  | supplier | Suggested  |
| 5 | Papelaria Vitória     | supplier | Confirmed  |
| 6 | Rafael Lima           | person   | Confirmed  |
| 7 | Marina Costa          | person   | Suggested  |
| 8 | R$ 4.820,00           | amount   | Confirmed  |
| 9 | NF-e 3412             | document | Confirmed  |

Connections (6): Rafael Lima —works at→ Acme Freight (Confirmed) · Acme Freight —quoted→
R$ 4.820,00 (Confirmed) · Papelaria Vitória —issued→ NF-e 3412 (Confirmed) · Marina Costa
—works at→ Embalagens Rio Claro (Suggested, dashed) · Rodocargo —similar to→ Transportes
Andrade (Suggested, dashed) · Transportes Andrade —quoted→ R$ 4.820,00 (Suggested, dashed).

### Detail pane (Acme Freight selected)
Header: **"Acme Freight"** + close "×". Badge row: `Supplier` · `Confirmed`.
Provenance line: **"from 3 emails"** — followed by the 3 email rows (subject + time):
"Cotação frete SP → POA — Lote 88" `Ter 14:32` · "Re: Lote 88" `Seg 10:12` ·
"Tabela de preços 2026" `12 Jun`.
Detail rows: **Contact** — rafael@acmefreight.com.br · **First seen** — 12 Jun 2026 ·
**Last seen** — Ter 14:32.
Suggested-connection block (the promote affordance): caption **"I think this connects to:"**
· row **"Transportes Andrade — quoted the same shipment"** with buttons
**"Promote to confirmed"** (primary) · **"Dismiss"** (quiet).
Footer link: **"Open entity →"**.

### Empty-pane default (shown only if builders render the unselected variant)
Icon + **"Click anything to explore it"**.

---

## Screen 4 — Components strip

One row/grid, labeled, exactly these specimens with exactly these strings:

1. **Buttons:** primary **"Promote to confirmed"** · secondary **"Open thread"** ·
   destructive **"Delete conversation"**
2. **Input:** label **"Chat name"**, value **"Freight quote — Lote 88"**
3. **Entity chips (both confidence states):** `Acme Freight · supplier` (Confirmed) ·
   `Marina Costa · person` (Suggested)
4. **Badge pair:** `Confirmed` · `Suggested`
5. **Toast (success, with brand-guide verbatim copy):** **"On it — reprocessing this
   email"**; include a second error toast: **"Couldn't attach a chat to this thread — try
   again."** with action **"Retry"**
6. **Empty state:** icon + heading **"Ask me anything"** + body **"I'll stream the answer
   back — sometimes with interactive panels built right in."** + button **"New chat"**
7. **Loading state:** a 3-bar skeleton block AND a spinner row with label
   **"Searching your mail…"**

---

*Any string not specified here (e.g. tooltip text) must simply be omitted — do not invent
copy. If a direction needs a divider label or section heading not listed, leave it unlabeled.*
