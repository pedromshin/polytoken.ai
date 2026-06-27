# Golden Set — Curation Rules and Quota Tallies

`golden-set.json` is a curated **subset** of `page-ideas.json` (the 76-entry superset).
Every entry in this file is a byte-identical copy of the corresponding entry in `page-ideas.json`.
No prompts were invented or paraphrased. Provenance is preserved verbatim (D-19).

## Selection Rule

Entries were chosen **mechanically** to satisfy the D-03 coverage quotas:

1. **All 8 curveball ids are mandatory:** 22, 28, 30, 54, 57, 61, 66, 69
2. **Tier-A quota:** >= 10 entries with `tier: "A"`
3. **Tier-B quota:** >= 20 entries with `tier: "B"`
4. **Category coverage:** >= 1 entry per distinct category in the corpus
5. **Complexity spread:** representative entries across simple / medium / complex

No subjective editorial choices were made beyond satisfying these mechanical criteria.

## Quota Tallies (as of last update)

| Metric              | Value | Threshold | Status |
|---------------------|-------|-----------|--------|
| Total entries       | 34    | ~36       | OK     |
| Tier-A entries      | 13    | >= 10     | PASS   |
| Tier-B entries      | 21    | >= 20     | PASS   |
| Curveball ids       | 8/8   | all 8     | PASS   |
| Categories covered  | 11/11 | >= 1 each | PASS   |

### Curveball Entries (mandatory inclusion)

| ID | Prompt (truncated)                                        | Category          | Tier |
|----|-----------------------------------------------------------|-------------------|------|
| 22 | Build a blog brief generator...                           | SaaS App Shell    | B    |
| 28 | Build a mobile bill-splitting app called 'Billy'...       | SaaS App Shell    | B    |
| 30 | https://notion.com clone this website with out...         | Clone             | A    |
| 54 | Design and build the browser UI for a real-time...        | Weird / Curveball | B    |
| 57 | Build a web soundscape mixer that feels like...           | Weird / Curveball | B    |
| 61 | Our furniture product pages feel flat... 3D configurator  | E-commerce        | B    |
| 66 | Create a fully functional Bloomberg Terminal-style...     | Weird / Curveball | B    |
| 69 | Create a multiplayer vocabulary-drawing game...           | Weird / Curveball | B    |

### Category Coverage

| Category            | Count in Golden Set |
|---------------------|---------------------|
| Clone               | 1                   |
| Dashboard / Admin   | 4                   |
| Data Tables / Grids | 2                   |
| E-commerce          | 1                   |
| Form / Multi-step   | 1                   |
| Internal Tool       | 4                   |
| Landing / Marketing | 7                   |
| Portfolio           | 2                   |
| SaaS App Shell      | 6                   |
| UI Component        | 2                   |
| Weird / Curveball   | 4                   |

### Complexity Spread

| Complexity | Count |
|------------|-------|
| simple     | 7     |
| medium     | 11    |
| complex    | 16    |

## Schema

Both `page-ideas.json` and `golden-set.json` share the `PageIdeaSchema` defined in
`page-ideas-schema.ts`. The CI gate in `eval-assets.test.ts` enforces:

- Every golden entry is byte-identical to its page-ideas counterpart
- All quota thresholds above remain green
- `page-ideas.json` has exactly 76 entries
- Every entry's `source` field is non-empty (provenance preserved)
