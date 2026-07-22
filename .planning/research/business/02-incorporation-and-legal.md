# 02 — Incorporation & legal

Researched 2026-07-22. Labels used throughout:
- **[FACT-repo]** — verified by reading this repository.
- **[SOURCED]** — backed by a cited external source (URL inline).
- **[ASSUMPTION]** — stated belief that needs confirmation from Pedro or a lawyer/accountant.
- Nothing here is legal or tax advice; it is a briefing to make the lawyer/accountant conversations cheap and fast.

## TL;DR

Delaware C-corp is the correct default if the goal is US venture money; every alternative
is worse on at least one axis that matters to VCs. The two genuinely Brazil-specific issues
are (1) Brazil's 2024 CFC regime (Lei 14.754/2023), which for an **active** software company
should NOT trigger automatic annual taxation — but the "active income ≥ 60%" test must be
watched, and (2) mandatory Brazilian filings (IRPF asset declaration; CBE only above US$1M).
Pre-incorporation IP must be assigned into the corp at formation via a technology assignment
agreement in exchange for founder stock — this is standard, cheap, and diligence-critical.
The repo currently ships **no ToS or privacy policy pages at all** — that is a launch blocker
for a product that reads other people's email, independent of incorporation.

## Repo facts this analysis rests on

- Email ingestion is **AWS SES inbound → S3** (`SES_S3_BUCKET: "nauta-services-ses-inbound-emails"` in `apps/email-listener/app/settings.py`), i.e. users receive/forward mail at a polytoken-controlled address. The Gmail API is **not** used today. **[FACT-repo]**
- LLM processing runs on **AWS Bedrock (Claude)**; document OCR via **AWS Textract** (same settings file). **[FACT-repo]**
- There is a files/"vault" surface (`apps/web/src/app/files`, vault-listing components) — the drive product exists in code. **[FACT-repo]**
- A repo-wide search for privacy/ToS pages in `apps/web` finds none (only an incidental test-file match). **No published privacy policy or terms of service exist.** **[FACT-repo]**
- Pedro is Brazil-based and operates magnitudetech.com.br. **[ASSUMPTION: that magnitudetech is an existing Brazilian legal entity (e.g. an LTDA or MEI/PJ) — needs confirmation; it changes the IP-assignment chain, see §3.]**

---

## 1. Entity type & jurisdiction

### Delaware C-corp — the default, and why

- Virtually all US VCs and institutional investors expect a Delaware C-corp; it is the structure that supports preferred stock, option pools, SAFEs, and standard financing documents ([Kruze Consulting](https://kruzeconsulting.com/blog/why-do-vcs-like-to-invest-in-delaware-c-corps/), [Inkle](https://www.inkle.ai/blog/why-startups-prefer-delaware-c-corps-benefits-explained)). **[SOURCED]**
- For non-US founders specifically, the C-corp (not LLC) is what enables stock-based compensation and standard investor onboarding ([Terms.Law on Delaware C-corps for non-US residents](https://terms.law/2025/10/26/delaware-c-corporations-for-non-u-s-residents/), [OptimizeTax](https://optimizetax.io/blog/delaware-c-corp-vs-llc-for-foreign-founders/)). **[SOURCED]**
- Rule of thumb from the ecosystem: if there is a >50% chance of raising VC within ~3 years, form the C-corp now; it costs roughly $1.5–3.5k/yr more in compliance than an LLC ([OptimizeTax](https://optimizetax.io/blog/delaware-c-corp-vs-lcc-for-foreign-founders/)). **[SOURCED]** Given the README's framing (VC/PE conversations planned), that condition is plausibly met. **[ASSUMPTION]**

### Alternatives, briefly

| Option | Verdict for polytoken |
|---|---|
| **Delaware LLC** | Bad twice over: pass-through taxation is hostile to VC funds, and a Delaware LLC owned by a non-resident sits on Brazil's *privileged tax regime* list, which **triggers Lei 14.754 automatic annual taxation regardless of the active-income test** (see §2). **[ASSUMPTION as to the privileged-regime listing applying to Pedro's exact structure — confirm with a Brazilian tax lawyer; the LLC-with-nonresident-members listing itself is long-standing Receita Federal position.]** |
| **Brazilian LTDA only** | Fine for consulting revenue; effectively unfundable by US VCs directly. Brazilian startups that raise US money almost always "flip" to a Delaware (or Cayman) topco anyway — doing the flip later is more expensive than incorporating right the first time ([Latitud on offshore structures for LatAm founders](https://www.latitud.com/blog/offshore-company-formation-cayman-sandwich-delaware-tostada)). **[SOURCED]** |
| **Cayman "sandwich" (Cayman topco → Delaware → Brazil opco)** | The classic later-stage LatAm structure; overkill and over-cost at pre-seed. Relevant only if a large Brazilian operating footprint or Brazilian investors' preferences demand it later ([Latitud](https://www.latitud.com/blog/offshore-company-formation-cayman-sandwich-delaware-tostada)). **[SOURCED]** |

### Formation mechanics & cost

- **Stripe Atlas**: $500 one-time — Delaware filing, EIN, standard docs, founder share issuance, first year of registered agent; ~$100/yr agent thereafter ([Stripe Atlas](https://stripe.com/atlas), [guide](https://guptadeepak.com/startup-offers/guides/stripe-atlas)). Works from 140+ countries; well-trodden path for foreign founders. **[SOURCED]**
- **Clerky**: $425 formation + $99/yr; documents drafted by Orrick and covers post-formation events (option grants, SAFEs, advisor agreements) better than Atlas ([comparison](https://traztech.ca/blog/stripe-atlas-vs-clerky-vs-capbase)). **[SOURCED]**
- Ongoing: Delaware franchise tax (~$300–450/yr minimum at typical startup share structures using assumed-par-value method; due March 1) + registered agent ~$100/yr ([Stripe Atlas docs](https://docs.stripe.com/atlas/signup), [OptimizeTax compliance guide](https://optimizetax.io/blog/stripe-atlas-delaware-compliance-for-foreign-founders/)). **[SOURCED]**
- A US corp that is ≥25% foreign-owned must file **IRS Form 5472** with a pro-forma 1120 annually; penalties for missing it start at $25,000. **[ASSUMPTION as to exact current penalty amount — verify with CPA; the filing obligation itself is standard IRS requirement for foreign-owned US corps.]**
- Recommendation: Atlas or Clerky, not a generic "we-form-anything" mill; the standard documents are the point (VC diligence expects them).

---

## 2. Brazil-founder specifics

Pedro remains a Brazilian tax resident (no indication of exit). **[ASSUMPTION]** Consequences:

### Lei 14.754/2023 (offshore/CFC regime, effective 2024-01-01)

- Brazilian tax residents pay a flat **15% annual tax on profits of *controlled* foreign entities** — *but only when the automatic regime is triggered*: the entity is in a tax haven / privileged regime, **or** its own **active income is below 60%** of total income ([Trench Rossi Watanabe](https://www.trenchrossi.com/en/legal-alerts/law-14754-2023-was-published-which-changes-the-taxation-of-investments-controlled-entities-and-trusts-abroad-held-by-individuals-who-are-tax-residents-in-brazil-and-investment-funds-in-brazil/), [Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2024/05/tax-law-highlights-taxation-of-offshore-assets-law-no-1475423), [KPMG](https://kpmg.com/xx/en/our-insights/gms-flash-alert/flash-alert-2023-246.html)). **[SOURCED]**
- "Control" = >50% of voting capital or power to elect majority of management ([RC Advocacia](https://www.ribeirocavalcante.com.br/brazil-cfc-rules-offshore-companies-2026)) — as a solo founder Pedro will control the Delaware corp. **[SOURCED]**
- Delaware **C-corp** is not a tax-haven/privileged-regime entity on Receita Federal's lists (unlike a non-resident-owned Delaware **LLC**), so a SaaS company earning subscription revenue (active income) should sit **outside** the automatic regime: tax due in Brazil only when profits are actually distributed. **[ASSUMPTION — this is the widely-advised reading; must be confirmed in writing by a Brazilian tax advisor before formation, because getting it wrong means 15%/yr on paper profits.]**
- Watch-item: if the company later earns significant **royalty/interest-like income** (e.g. the compute-credit marketplace take, interest on idle cash), the 60% active-income test can flip; royalties count against active income ([Souto Correa memo, PDF](https://www.soutocorrea.com.br/wp-content/uploads/2023/12/Souto-Correa_Law-No.-14.7542023.pdf)). **[SOURCED]** A pre-revenue startup with a money-market-parked SAFE round could ironically be "mostly passive income" in a given year. Flag this exact scenario to the tax advisor. **[ASSUMPTION as to how advisors treat pre-revenue years]**

### Brazilian filings

- **IRPF**: the Delaware shares are declared annually as foreign assets on Pedro's income tax return (acquisition cost basis). Routine. **[ASSUMPTION — standard practice, confirm mechanics]**
- **CBE (Banco Central "Capitais Brasileiros no Exterior")**: only required once total foreign assets reach **US$1,000,000** on Dec 31 (annual filing, Feb–Apr window); quarterly above US$100M. Fines up to R$250k for false info ([CEPEDA](https://cepeda.law/declaracao-de-capitais-brasileiros-no-exterior-2026-2025-obrigacao-e-prazo/?lang=en), [Banco Central manual](https://www.bcb.gov.br/content/estabilidadefinanceira/cambiocapitais/Manuais_CBE/Manual_CBE_a_partir_de_2017.pdf)). Irrelevant at formation; becomes relevant the moment the company has a real valuation post-fundraise. **[SOURCED]**

### US-side tax for a non-resident founder

- A non-resident, non-citizen founder performing services **from Brazil** for the US corp is generally not subject to US income tax on that compensation (not US-source, not effectively connected) ([Baker Tax Law](https://mbakertaxlaw.com/section-83b-elections-and-non-us-persons/), [Withum FAQ](https://www.withum.com/resources/essential-faqs-on-83b-election-for-non-u-s-taxpayers/)). **[SOURCED]**
- **83(b) election**: not strictly required for a pure non-resident, but the standard defensive advice is to file anyway within 30 days of a restricted-stock grant (protects against later US move / status change); filing requires an SSN or ITIN ([Stripe Atlas docs](https://docs.stripe.com/atlas/83b-elections-non-us-founders), [Cytowski & Partners](https://cytlaw.medium.com/83-b-election-for-non-us-founders-7dae9e493926)). **[SOURCED]**
- No visa is needed to own or be a director/officer of a US corp while working remotely from Brazil; a visa question only arises when physically working in the US. **[ASSUMPTION — settled practice, but confirm before any US trips involving "work"]**

### Getting paid

Two standard patterns, not mutually exclusive: (a) the Delaware corp pays Pedro as a foreign contractor (W-8BEN on file; taxed in Brazil via carnê-leão or via his PJ), or (b) the Delaware corp contracts **magnitudetech (the Brazilian PJ)** for engineering services — usually more tax-efficient in Brazil, but creates a related-party contract that must be arm's-length and disclosed on Form 5472. **[ASSUMPTION — both the magnitudetech-is-a-PJ premise and the tax-efficiency claim; this is the single highest-value question for the Brazilian accountant.]**

---

## 3. IP assignment of pre-incorporation solo work

This is the item VCs' lawyers actually check. The polytoken codebase predates any corporation, so at formation:

- Pedro signs a **Technology (IP) Assignment Agreement** assigning the entire pre-existing codebase, designs, domain (polytoken.ai), and related IP to the corp **as consideration for founder shares** (this is why founder stock is issued for "IP + nominal cash" rather than cash alone). Atlas/Clerky formation packets include this document ([Promise Legal startup docs overview](https://blog.promise.legal/startup-central/section-83b-elections-startup-founders-vesting-compliance-guide/), [Clerky comparison](https://traztech.ca/blog/stripe-atlas-vs-clerky-vs-capbase)). **[SOURCED]**
- Pedro also signs the standard **CIIAA** (Confidential Information and Invention Assignment Agreement) as a service provider going forward — assignment of pre-existing IP and future IP are two different documents. **[SOURCED — same formation-packet references]**
- **Chain-of-title risks to clear before signing anything** (each is cheap now, expensive in diligence):
  1. If any polytoken code was written "through" magnitudetech (invoiced time, company equipment/accounts, or magnitudetech contracts touching it), the **Brazilian entity must also assign** — an individual assignment won't cure company-owned IP. **[ASSUMPTION — depends on facts only Pedro knows]**
  2. Any prior employer's invention-assignment clauses that could reach side projects (check old contracts, especially the VC firm engineering role mentioned in the README). **[ASSUMPTION]**
  3. Brazilian software law (Lei 9.609/98) governs authorship of code written in Brazil; it is assignment-friendly for software (moral rights are sharply limited for software vs. other works), but the assignment should explicitly reference Brazilian-law rights and be signed in a form valid in Brazil too. **[ASSUMPTION — standard practice per Brazilian IP practitioners; have the startup lawyer coordinate with a Brazilian counterpart on the one document]**
  4. Substantial parts of the codebase are AI-generated (this repo is heavily agent-built). Current US Copyright Office position gives no copyright in purely AI-generated material, but that does not impair *trade-secret* and contractual protection, and assignment language should cover "all rights, if any." Worth one sentence in the assignment, not a restructuring. **[ASSUMPTION — evolving area; flag to counsel]**
- Third-party components: the repo depends on OSS (Next.js, xyflow, etc.); diligence will want a dependency/license inventory eventually. Nothing suggests copyleft contamination, but no audit has been run. **[FACT-repo as to dependencies existing; ASSUMPTION as to license cleanliness]**

---

## 4. Trademark

- **Clearance first**: search "polytoken" in USPTO TESS, INPI, and EUIPO before spending anything — "token" is a crowded crypto-adjacent space and there may be conflicting marks. Cost: a few hours, or ~$500–1,500 via counsel. **[ASSUMPTION on cost range]**
- **USPTO**: base filing $350/class after the 2025 fee restructuring ([Signa Global Trademark Cost Index](https://signa.so/reports/global-trademark-cost-index-2026)). Relevant classes: 9 (software), 42 (SaaS). ~$700 in fees for both, more with counsel. **[SOURCED for the $350 base; ASSUMPTION that 9+42 is the right class pair — standard for SaaS]**
- **Brazil (INPI)**: slow (24–36 months to registration) but cheap; 2025 fee/procedure updates apply, and Madrid-designated applications no longer pay a separate granting fee ([HYA IP on INPI changes](https://hyaip.com/en/brazil-updates-trademark-fees-and-procedures-new-inpi-rules-effective-from-august-2025/), [FAS Advogados](https://fasadv.com.br/en/bra/publication/new-brpto-fees-comes-into-force-in-august)). **[SOURCED]**
- **Madrid Protocol** becomes cost-effective at 3+ countries (from ~953 CHF for 3 countries / 2 classes) ([MarqVision](https://www.marqvision.com/blog/international-trademark-registration-fees)); premature now. **[SOURCED]**
- Sequencing recommendation: clearance now (before public launch locks in the name), USPTO filing at/near incorporation, INPI shortly after, Madrid only with international traction. The trademark should be filed by/assigned to the corp, not Pedro personally. **[ASSUMPTION — standard practice]**

---

## 5. ToS / privacy-policy obligations for an email-reading product

Current state: **the web app has no terms of service and no privacy policy** — no such routes/pages exist in `apps/web/src/app`. **[FACT-repo]** For a product whose core loop is ingesting users' email and files, this must be fixed before any non-friend user touches it:

1. **A privacy policy is legally required, not optional**, once there are real users: CalOPPA requires one for any site/service collecting personal info from Californians (no revenue threshold, unlike CCPA), and GDPR/LGPD transparency duties (Arts. 13/14 GDPR; Art. 9 LGPD) require disclosure of what is collected, why, legal basis, retention, and processors. ([Clym CCPA/CalOPPA applicability](https://www.clym.io/blog/ccpa-applicability-guide), [SISL on GDPR for non-EU SaaS](https://sisl.pl/en/blog/gdpr-non-eu-saas-compliance)) **[SOURCED; see 06-compliance-and-privacy.md for the full regime-by-regime analysis]**
2. **Email-specific disclosures** the policy must make: (a) the service reads and stores full email content including attachments (raw MIME lands in S3 — [FACT-repo]); (b) content is processed by LLMs (AWS Bedrock/Claude — [FACT-repo]) and by OCR (Textract — [FACT-repo]); (c) emails inherently contain **third parties' personal data** (senders/correspondents who never agreed to anything) — the policy must address this honestly (legitimate-interest framing; see 06); (d) retention and deletion behavior. **[ASSUMPTION as to exact drafting; the underlying facts are repo-verified]**
3. **ToS must-haves for this product**: limitation of liability + disclaimer of warranties (critical for the drive/backup surface — see 06 §6), acceptable-use, account-termination data-export terms, arbitration/venue choice (Delaware or California venue typical), and an explicit "we are not an email provider of record / not an archival compliance service" positioning clause. **[ASSUMPTION — standard SaaS practice]**
4. **If the Gmail API is ever adopted**, Google's verification process *requires* a published privacy policy that matches the OAuth scopes requested and contains the Limited Use disclosure verbatim ([Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)). The SES-forwarding architecture avoids this entirely today. **[SOURCED + FACT-repo]**
5. Because the founder is in Brazil and early users may be too, the privacy policy should be LGPD-conformant from day one (named legal bases per processing activity; contact channel for data-subject requests). **[ASSUMPTION as to user geography]**

---

## Open questions for counsel/accountant (the actual to-do list)

1. Confirm Delaware C-corp (not LLC) keeps Pedro outside Lei 14.754 automatic taxation given projected income mix; get it in writing.
2. Is magnitudetech a PJ, and did any polytoken work flow through it? → determines whether a second IP assignment is needed and whether PJ-invoicing is the pay path.
3. Any prior-employment invention-assignment exposure (VC firm engineering role)?
4. File 83(b) defensively? (ITIN acquisition lead time is weeks — start early if yes.)
5. Trademark clearance result for "polytoken" in US/BR/EU.
6. Draft privacy policy + ToS before first external user (blocker; see track 06 for content requirements).

## Sources

- https://kruzeconsulting.com/blog/why-do-vcs-like-to-invest-in-delaware-c-corps/
- https://terms.law/2025/10/26/delaware-c-corporations-for-non-u-s-residents/
- https://optimizetax.io/blog/delaware-c-corp-vs-llc-for-foreign-founders/
- https://www.inkle.ai/blog/why-startups-prefer-delaware-c-corps-benefits-explained
- https://www.latitud.com/blog/offshore-company-formation-cayman-sandwich-delaware-tostada
- https://www.trenchrossi.com/en/legal-alerts/law-14754-2023-was-published-which-changes-the-taxation-of-investments-controlled-entities-and-trusts-abroad-held-by-individuals-who-are-tax-residents-in-brazil-and-investment-funds-in-brazil/
- https://www.mayerbrown.com/en/insights/publications/2024/05/tax-law-highlights-taxation-of-offshore-assets-law-no-1475423
- https://kpmg.com/xx/en/our-insights/gms-flash-alert/flash-alert-2023-246.html
- https://www.soutocorrea.com.br/wp-content/uploads/2023/12/Souto-Correa_Law-No.-14.7542023.pdf
- https://www.ribeirocavalcante.com.br/brazil-cfc-rules-offshore-companies-2026
- https://cepeda.law/declaracao-de-capitais-brasileiros-no-exterior-2026-2025-obrigacao-e-prazo/?lang=en
- https://www.bcb.gov.br/content/estabilidadefinanceira/cambiocapitais/Manuais_CBE/Manual_CBE_a_partir_de_2017.pdf
- https://docs.stripe.com/atlas/83b-elections-non-us-founders
- https://mbakertaxlaw.com/section-83b-elections-and-non-us-persons/
- https://www.withum.com/resources/essential-faqs-on-83b-election-for-non-u-s-taxpayers/
- https://cytlaw.medium.com/83-b-election-for-non-us-founders-7dae9e493926
- https://stripe.com/atlas and https://docs.stripe.com/atlas/signup
- https://guptadeepak.com/startup-offers/guides/stripe-atlas
- https://traztech.ca/blog/stripe-atlas-vs-clerky-vs-capbase
- https://optimizetax.io/blog/stripe-atlas-delaware-compliance-for-foreign-founders/
- https://blog.promise.legal/startup-central/section-83b-elections-startup-founders-vesting-compliance-guide/
- https://signa.so/reports/global-trademark-cost-index-2026
- https://hyaip.com/en/brazil-updates-trademark-fees-and-procedures-new-inpi-rules-effective-from-august-2025/
- https://fasadv.com.br/en/bra/publication/new-brpto-fees-comes-into-force-in-august
- https://www.marqvision.com/blog/international-trademark-registration-fees
- https://developers.google.com/terms/api-services-user-data-policy
- https://www.clym.io/blog/ccpa-applicability-guide
- https://sisl.pl/en/blog/gdpr-non-eu-saas-compliance
