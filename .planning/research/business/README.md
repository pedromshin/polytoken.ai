# Business formation research — polytoken as an organization

Created 2026-07-22 at Pedro's request. This folder holds everything needed to evaluate
turning polytoken from a solo project into a serious organization/business.

Context: Pedro is currently solo, evaluating whether to pursue this with more commitment.
He has experienced VC/PE contacts to talk to, and previously worked in VC as a firm's
sole engineer — so the material here should be rigorous enough for those conversations.

## START HERE — the synthesis

**[`2026-07-23-EXECUTION-ROADMAP.md`](2026-07-23-EXECUTION-ROADMAP.md) is the entry point.** It
compresses all eight tracks below into a go/no-go decision framework, a 0–3 / 3–6 / 6–12 month
sequenced plan (incorporation timing, fundability milestones mapped to what the product now does
post-orchestrator, and when to talk to the VC/PE network), the cost/runway + fund-vs-bootstrap
call, an explicit "what NOT to do yet" trap list, and the open questions only Pedro can answer.
The eight tracks are the evidence; the roadmap is the decision. Read the roadmap first, then dive
into any track it cites.

## Research tracks (the evidence base; each cited by the roadmap)

| File (planned) | Track |
|---|---|
| `01-market-and-positioning.md` | What polytoken is as a product; competitive landscape (personal AI OS, email intelligence, canvas/knowledge tools, distributed inference); differentiation; TAM framing |
| `02-incorporation-and-legal.md` | Entity type & jurisdiction (Delaware C-corp vs alternatives, Brazil considerations), IP assignment from solo work, trademark, terms of service / privacy policy obligations for an email-reading product |
| `03-fundraising.md` | Solo-founder fundraising realities, pre-seed/seed norms (SAFEs, valuation caps), what VCs need to see at each stage, how to leverage existing VC/PE network, angel vs institutional |
| `04-business-model.md` | Pricing/monetization options: subscription tiers, storage (500GB-class drive economics), compute-credit marketplace for distributed inference (two-sided market mechanics, unit economics), remote-desktop margin model |
| `05-cost-structure.md` | Current + projected infra costs (AWS SES/S3/Lambda, Supabase, Vercel, LLM inference spend), COGS per user, burn scenarios |
| `06-compliance-and-privacy.md` | Handling other people's email + files: LGPD (Brazil), GDPR, CCPA; SOC 2 path; data-loss liability for a drive product with backups/versioning promises |
| `07-solo-vs-team.md` | What can stay AI-driven-solo vs where hires are unavoidable; contractor vs employee; equity planning |
| `08-milestones-to-fundability.md` | Concrete traction milestones that would make this fundable; demo narrative; metrics to instrument now |

## Ground rules

- Every claim that will be said out loud to a VC/PE contact must be sourced or clearly
  labeled as an assumption.
- Keep numbers tied to real infra data (AWS/Supabase bills) once available — no invented
  unit economics.
- This folder is strategy, not code: no secrets, no credentials, no customer data.
