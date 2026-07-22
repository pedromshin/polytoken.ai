# 06 — Compliance & privacy

Researched 2026-07-22. Labels:
- **[FACT-repo]** — verified by reading this repository.
- **[SOURCED]** — backed by a cited external source (URL inline).
- **[ASSUMPTION]** — needs confirmation from Pedro or counsel.
- Not legal advice; a briefing to make counsel conversations cheap.

## TL;DR

polytoken's compliance exposure is dominated by one fact: it ingests **full email content
(including third parties' data) and user files** and runs them through LLMs. LGPD applies
from day one (Brazil-based operation); GDPR only if/when EU users are courted; CCPA is
years away on thresholds but a privacy policy is required immediately anyway (CalOPPA).
The current SES-forwarding architecture **avoids the entire Google restricted-scope/CASA
regime** — adopting the Gmail API later would add an annual third-party security assessment
and a hard ban on using Gmail data to train generalized AI models; this is a real
architectural moat worth preserving. SOC 2 is not needed until enterprise/prosumer-team
sales begin, but cheap posture work now (audit logs, access control, vendor DPAs) makes the
eventual 6–12-week sprint tractable. For the drive product, the industry-standard answer to
data-loss liability is aggressive ToS limitation + honest marketing (never say "guaranteed"),
backed later by tech E&O/cyber insurance.

## Repo facts this analysis rests on

- Inbound email: **AWS SES → raw MIME in S3** (`SES_S3_BUCKET: "nauta-services-ses-inbound-emails"`, env-split prefixes `inbound/local|staging|prod/` in `apps/email-listener/app/settings.py`). No Gmail API anywhere in the codebase. **[FACT-repo]**
- LLM processing: **AWS Bedrock (Claude)**, auth via ECS task IAM role; OCR via **AWS Textract**. **[FACT-repo]**
- Files/drive surface exists (`apps/web/src/app/files`, vault-listing components); README track 04 contemplates a "500GB-class drive" with backups/versioning promises. **[FACT-repo]**
- Web stack: Supabase (auth/Postgres), Next.js on Vercel-style hosting, per CLAUDE.md and README track 05. **[FACT-repo for Supabase; ASSUMPTION that production hosting is Vercel]**
- **No privacy policy or ToS pages exist in `apps/web`.** **[FACT-repo]**
- Data flows all appear to terminate in **US-region AWS** (bucket name and region defaults) — meaning Brazilian/EU users' data is transferred internationally by default. **[FACT-repo for the bucket; ASSUMPTION for the full picture]**

---

## 1. LGPD (Brazil) — applies first and unconditionally

Why it applies: processing is carried out by a Brazil-based operator and will offer services to people in Brazil; LGPD attaches on either basis. **[ASSUMPTION as to user base; the operator basis is enough]**

What it concretely requires for polytoken:

- **Legal basis per processing activity** (Art. 7). For the user's own mailbox/files: contract performance + consent. For **third-party correspondents' data inside ingested emails** (people who never signed up): *legitimate interest* is the workable basis — LGPD explicitly recognizes it, but requires a documented legitimate-interest assessment (balancing test). This is the single most product-specific LGPD artifact to produce. **[ASSUMPTION as to framing; standard practice per LGPD guides — [Secure Privacy LGPD guide](https://secureprivacy.ai/blog/lgpd-compliance-requirements)]**
- **Encarregado (DPO)**: Art. 41 makes a DPO the default for every controller, but ANPD's small-agents rule (CD/ANPD Res. 2/2022) **exempts startups/micro/small enterprises** — they must still publish a contact channel for data subjects. ANPD has actively enforced DPO-disclosure failures (proceedings against 20 companies, Nov 2024). Practical move: name Pedro as contact now, appoint a real DPO at scale. ([RC Advocacia LGPD compliance](https://www.ribeirocavalcante.com.br/lgpd-foreign-companies-compliance-2026), [Secure Privacy](https://secureprivacy.ai/blog/lgpd-compliance-requirements)) **[SOURCED]**
- **International transfers — active deadline already passed**: data leaves Brazil for US AWS. ANPD's transfer regulation requires an approved mechanism; the grace period for adopting ANPD's **Standard Contractual Clauses ended 2025-08-23** — transfers without a valid mechanism are unlawful since then ([Littler](https://www.littler.com/news-analysis/asap/brazil-standard-contractual-clauses-sccs-may-be-required-starting-august-23-2025), [Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/08/end-of-grace-period-implementation-of-brazils-standard-contractual-clauses-in-international-transfers-of-personal-data)). Unlike GDPR SCCs, Brazil's SCCs must be used **in the exact ANPD-approved form**. Action: incorporate ANPD SCCs into the ToS/DPA the day Brazilian users are onboarded. **[SOURCED]**
- **Fines**: up to 2% of Brazil revenue, capped at **R$50M per infraction**; ANPD is an increasingly active regulator ([DataGrail LGPD overview](https://www.datagrail.io/glossary/lgpd/), [ComplianceHub on LGPD fines](https://compliancehub.wiki/breaches-and-fines-under-brazils-lei-geral-de-protecao-de-dados-lgpd-2/)). **[SOURCED]**
- Data-subject rights (access, deletion, portability) — the product needs a real delete path that reaches the S3 raw-MIME store, Postgres, and any derived embeddings/indexes. Today deletion semantics across those stores are unverified. **[ASSUMPTION — worth an engineering audit; the S3 store is FACT-repo]**

## 2. GDPR — conditional, but design for it now

- Applies under **Art. 3(2)** only if polytoken *offers services to* or *monitors* people in the EU — mere accessibility of a website is not enough, but EU-targeted marketing, EUR pricing, or EU-language support is ([SISL: GDPR for non-EU SaaS](https://sisl.pl/en/blog/gdpr-non-eu-saas-compliance), [Timelex on extraterritorial scope](https://www.timelex.eu/en/blog/extraterritorial-scope-gdpr-are-you-or-out)). Decision for Pedro: **explicitly defer EU go-to-market** until compliance budget exists, and say so in the ToS. **[SOURCED + recommendation]**
- If/when it applies: (a) an **EU representative** must be appointed (Art. 27) since polytoken has no EU establishment ([EUVerify](https://euverify.com/resource/gdpr-representative-for-saas-companies/)); (b) **DPAs with every processor** — AWS (covers S3/SES/Bedrock/Textract under the AWS DPA), Supabase, Vercel — plus SCCs for the US transfers ([Bindbee GDPR-for-SaaS guide](https://bindbee.dev/feeds/blog/gdpr-compliance-saas-strategies)); (c) **72-hour breach notification** to the supervisory authority (Art. 33), with failure-to-notify itself finable up to €10M/2% ([Legiscope on Art. 33](https://www.legiscope.com/blog/gdpr-article-33-breach-notification-authority.html)). **[SOURCED]**
- Role analysis: for a consumer product, polytoken is **controller** of everything it ingests (it decides purposes/means — building the user's knowledge graph), not a mere processor. Third-party correspondent data again rides on legitimate interest (Art. 6(1)(f)) — same balancing-test document as LGPD, one artifact serves both. **[ASSUMPTION as to role classification — mainstream analysis for consumer SaaS, confirm with counsel]**
- Cheap-now moves that pay off later: data-minimizing defaults, retention limits on raw MIME, EU-readiness checklist in the DPA templates. **[ASSUMPTION/recommendation]**

## 3. CCPA/CPRA (California) — thresholds far away, policy needed anyway

- CCPA applies only above one of: **~$26.6M global revenue** (inflation-adjusted 2025 figure), **100k+ CA consumers/households** whose data is bought/sold/shared, or 50%+ revenue from selling data ([Clym applicability guide](https://www.clym.io/blog/ccpa-applicability-guide), [Secure Privacy CCPA 2026](https://secureprivacy.ai/blog/ccpa-requirements-2026-complete-compliance-guide)). polytoken will not hit these for years. **[SOURCED]**
- But **CalOPPA** (separate, older law) requires a conspicuous privacy policy from any service collecting Californians' personal info, with **no size threshold** — so the privacy policy is a day-one launch requirement regardless ([Clym](https://www.clym.io/blog/ccpa-applicability-guide)). **[SOURCED]**
- polytoken should never "sell or share" personal information in the CCPA sense; keeping that true (no ad-tech SDKs, no data brokering) keeps the future CCPA burden to notices + DSAR plumbing already built for LGPD/GDPR. **[ASSUMPTION/recommendation]**

## 4. Google API user-data policy — the "if we ever touch Gmail API" tax

Today polytoken **does not use the Gmail API** (SES-forwarding architecture, [FACT-repo]), so none of this applies. If it ever does:

- Gmail message content scopes are **restricted scopes** — the most heavily policed category in Google's OAuth ecosystem ([Google restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Restricted Scopes help](https://support.google.com/cloud/answer/13464325?hl=en)). **[SOURCED]**
- Requirements: app verification against **approved use cases** (email clients / email-productivity apps — "generative AI summaries" is now an explicitly approved productivity use case), a privacy policy containing the **Limited Use** disclosure, and an **annual third-party security assessment (CASA)** with a Letter of Assessment once past ~100 users ([Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), [Application Use Cases](https://support.google.com/cloud/answer/13805798?hl=en)). Historical assessment costs ran $15k–$75k/yr; the CASA framework has since introduced lower-cost, partly self-scan tiers for lower-risk apps, but budget real money and multi-week timelines for a restricted-scope launch. **[SOURCED for the requirement; ASSUMPTION on current exact cost — Google has changed the CASA tiering repeatedly]**
- **Hard AI constraint**: Google's Workspace API policy prohibits using Workspace/Gmail user data to **train or improve non-personalized (generalized) AI/ML models**; only the individual user's personalized experience may benefit, and the privacy policy must commit to this ([Google Workspace API user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), [Workspace blog announcement](https://workspace.google.com/blog/ai-and-machine-learning/api-policy-protections)). polytoken's per-user knowledge-graph design is compatible; any future "learn across users from email data" ambition is not. **[SOURCED]**
- **Strategic takeaway**: the SES architecture (user forwards/receives mail at a polytoken address) means Google's policies, verification queues, and annual assessments simply don't apply — the data arrives via SMTP, which no platform ToS governs. This is both a cost advantage and a pitch-able architectural moat, at the UX cost of asking users to set up forwarding. Preserve it as the default path; treat Gmail API as an optional premium integration with its own compliance budget line. **[FACT-repo + ASSUMPTION/recommendation]**

## 5. SOC 2 — when and how much

- **When it becomes necessary**: at the first enterprise (or security-conscious prosumer-team) sales conversations — it is a sales unlock, not a legal requirement. Companies with SOC 2 Type II reportedly close enterprise deals ~35% faster (Drata "State of Trust" 2025, via [Causo Hub](https://hub.causo.ai/guides/soc2-for-seed-startups-enterprise-deals-2026)). For a consumer-first product it can wait past pre-seed. **[SOURCED]**
- **Cost/timeline at seed stage (2025–2026 market)**: Type I ≈ **$10k–25k all-in** year one (automation platform $7–15k/yr: Vanta/Drata/Secureframe/Sprinto; auditor $8–15k; pen test $5–12k); **6–12 weeks** to Type I with standard cloud infra, then run the Type II observation window (3–12 months) in parallel ([Causo Hub](https://hub.causo.ai/guides/soc2-for-seed-startups-enterprise-deals-2026), [The Sector Post cost guide](https://www.thesectorpost.com/compliance/soc2/audit-costs), [startup guide](https://www.thesectorpost.com/compliance/soc2/startup-guide)). First audits at enterprise-deal quality can run $30k–50k. **[SOURCED]**
- **Do now (near-free, makes SOC 2 a sprint instead of a rewrite)**: single-sign-on + MFA on all infra consoles, IAM-role-only access (already the pattern for Bedrock/SES — [FACT-repo]), audit logging (CloudTrail), documented access reviews, vendor list with DPAs, incident-response one-pager, encrypted-at-rest defaults (S3/Supabase already do this). **[ASSUMPTION/recommendation]**
- Sequencing: LGPD/GDPR artifacts (policies, DPAs, deletion paths) come first; SOC 2 reuses most of that evidence. **[ASSUMPTION/recommendation]**

## 6. Data-loss liability for the drive product (backups/versioning promises)

The files/vault product plus any marketing language about "backups" or "versioning" creates the highest civil-liability surface in the company. How incumbents handle it, and what to copy:

- **Industry norm**: consumer cloud-storage/backup ToS (Dropbox, Backblaze, etc.) disclaim warranties, exclude consequential damages, and cap direct liability at fees paid (typically trailing 12 months). Backblaze's repeated silent ToS redefinitions of "unlimited"/scope in 2025–2026 show both how much latitude ToS give providers and how much reputational blowback silent changes cause ([Tom's Hardware](https://www.tomshardware.com/software/cloud-storage/backblaze-redefines-unlimited-while-users-discover-its-not-backing-up-dropbox-and-onedrive-service-changes-could-signal-shift-away-from-home-backups), [Forbes](https://www.forbes.com/sites/barrycollins/2026/04/17/backblaze-stops-backing-up-dropbox-and-others-calls-it-an-improvement/)). Lesson: cap liability contractually, and change scope loudly, never silently. **[SOURCED for the incidents; ASSUMPTION that the fee-cap norm applies across major providers — spot-check the current Dropbox/Google ToS text when drafting]**
- **Concrete ToS requirements for polytoken**: (a) "as-is" warranty disclaimer; (b) exclusion of indirect/consequential damages (lost profits, lost data value); (c) liability cap = fees paid in prior 12 months; (d) user responsibility to maintain independent copies of critical data ("polytoken is not your only copy"); (e) defined data-return/export window after termination; (f) conspicuous presentation (caps-formatted clauses) — US courts enforce these caps in consumer SaaS absent gross negligence. Brazilian consumer law (CDC) is *less* deferential to liability caps against consumers — the LGPD/CDC interaction for Brazilian users needs specific counsel review; do not assume the US-style cap fully holds in Brazil. **[ASSUMPTION — drafting-level items for counsel]**
- **Marketing discipline**: never use "guaranteed", "never lose", or specific durability numbers as polytoken promises. S3's 99.999999999% durability is **AWS's design target for AWS**, not a warranty polytoken can pass through — polytoken's own bugs (sync logic, deletion propagation, versioning pruning) are the realistic loss vector and are not covered by S3 durability at all. Versioning claims should state exact retention windows (e.g. "30-day version history") rather than open-ended promises. **[ASSUMPTION/analysis; the S3-backed architecture is FACT-repo]**
- **Engineering duty that follows from the promise**: if the product says "versioning", tested restore paths are a compliance artifact, not a feature — periodic restore drills, S3 object versioning + lifecycle rules, and deletion that honors both LGPD erasure rights *and* version history (these conflict; policy must define which wins and disclose it). **[ASSUMPTION/recommendation]**
- **Insurance**: technology E&O + cyber liability is the standard backstop for data-loss claims and breach costs; typical early-stage premiums are low single-digit $k/yr for $1M limits. Buy it when real users' irreplaceable data arrives, at latest alongside first paid storage tiers. **[ASSUMPTION on premium range — get quotes (Embroker/Vouch-type brokers); the need itself is standard practice]**

---

## Priority order (compliance roadmap)

1. **Now (pre-launch blockers)**: privacy policy + ToS (with liability caps and honest email/LLM disclosures); working end-to-end deletion (S3 raw MIME + Postgres + derived indexes); legitimate-interest assessment for third-party email correspondents (serves LGPD *and* future GDPR).
2. **At first Brazilian users**: ANPD SCCs for the Brazil→US transfer; public data-subject contact channel.
3. **At first paid storage tier**: tech E&O/cyber insurance; documented restore drills; explicit version-retention windows in the product and ToS.
4. **At EU go-to-market (deliberately deferred)**: EU representative, GDPR DPA/SCC pack, Art. 30 records.
5. **At first enterprise conversation**: SOC 2 Type I sprint (6–12 weeks, ~$10–25k), Type II window in parallel.
6. **Only if Gmail API is ever adopted**: Google restricted-scope verification + annual CASA + Limited Use policy language; budget as a distinct line item.

## Sources

- https://secureprivacy.ai/blog/lgpd-compliance-requirements
- https://www.ribeirocavalcante.com.br/lgpd-foreign-companies-compliance-2026
- https://www.datagrail.io/glossary/lgpd/
- https://compliancehub.wiki/breaches-and-fines-under-brazils-lei-geral-de-protecao-de-dados-lgpd-2/
- https://www.littler.com/news-analysis/asap/brazil-standard-contractual-clauses-sccs-may-be-required-starting-august-23-2025
- https://www.mayerbrown.com/en/insights/publications/2025/08/end-of-grace-period-implementation-of-brazils-standard-contractual-clauses-in-international-transfers-of-personal-data
- https://sisl.pl/en/blog/gdpr-non-eu-saas-compliance
- https://www.timelex.eu/en/blog/extraterritorial-scope-gdpr-are-you-or-out
- https://euverify.com/resource/gdpr-representative-for-saas-companies/
- https://bindbee.dev/feeds/blog/gdpr-compliance-saas-strategies
- https://www.legiscope.com/blog/gdpr-article-33-breach-notification-authority.html
- https://www.clym.io/blog/ccpa-applicability-guide
- https://secureprivacy.ai/blog/ccpa-requirements-2026-complete-compliance-guide
- https://developers.google.com/terms/api-services-user-data-policy
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://support.google.com/cloud/answer/13464325?hl=en
- https://support.google.com/cloud/answer/13805798?hl=en
- https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- https://workspace.google.com/blog/ai-and-machine-learning/api-policy-protections
- https://hub.causo.ai/guides/soc2-for-seed-startups-enterprise-deals-2026
- https://www.thesectorpost.com/compliance/soc2/audit-costs
- https://www.thesectorpost.com/compliance/soc2/startup-guide
- https://www.tomshardware.com/software/cloud-storage/backblaze-redefines-unlimited-while-users-discover-its-not-backing-up-dropbox-and-onedrive-service-changes-could-signal-shift-away-from-home-backups
- https://www.forbes.com/sites/barrycollins/2026/04/17/backblaze-stops-backing-up-dropbox-and-others-calls-it-an-improvement/
