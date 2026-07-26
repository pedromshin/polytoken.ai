import type { Metadata } from "next";
import * as React from "react";

import { LegalDoc, LegalList, type LegalSection } from "../_components/legal-doc";
import {
  COMPANY_CNPJ,
  COMPANY_LEGAL_NAME,
  COMPANY_TRADE_NAME,
  CONTACT_EMAIL,
  PRODUCT_NAME,
} from "../_components/legal-entity";

export const metadata: Metadata = {
  title: "Privacy Policy — Polytoken",
  description: "How polytoken collects, processes, and protects your data.",
};

const LAST_UPDATED = "26 July 2026";

const SECTIONS: readonly LegalSection[] = [
  {
    heading: "Who we are",
    body: (
      <p>
        {PRODUCT_NAME} is operated by {COMPANY_LEGAL_NAME} (trading as {COMPANY_TRADE_NAME}, CNPJ{" "}
        {COMPANY_CNPJ}), a company established in Brazil (the &ldquo;controller&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;). We decide how and why your data is processed. For any
        privacy question or to exercise your rights, contact us at{" "}
        <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ),
  },
  {
    heading: "What data we process",
    body: (
      <>
        <LegalList
          items={[
            <>
              <strong>Account data</strong> — your email address and authentication identity
              (via Google sign-in / Supabase Auth).
            </>,
            <>
              <strong>Email you forward to polytoken</strong> — the full message, its attachments,
              and everything inside them. This is the core of the service.
            </>,
            <>
              <strong>Files and content you create or upload</strong> inside polytoken.
            </>,
            <>
              <strong>Data about third parties inside your email</strong> — messages you forward
              routinely contain personal data of people who never signed up (senders, recipients,
              people named in the text). We process this only to build your knowledge graph.
            </>,
            <>
              <strong>Usage and billing data</strong> — basic product usage, and, if you subscribe,
              subscription status (payment card details are handled by Stripe, never stored by us).
            </>,
          ]}
        />
      </>
    ),
  },
  {
    heading: "How and why we use it (legal bases)",
    body: (
      <>
        <p>
          We use your data to run the service: receiving forwarded mail, parsing and performing
          OCR on attachments, extracting entities and relationships, and building a searchable,
          AI-assisted knowledge graph you can chat with and build tools over.
        </p>
        <LegalList
          items={[
            <>
              <strong>Your own data</strong> is processed to perform our contract with you and, where
              required, with your consent.
            </>,
            <>
              <strong>Third-party correspondents&rsquo; data</strong> inside your email is processed
              under our legitimate interest (and yours) in organizing your own correspondence,
              balanced against those individuals&rsquo; rights.
            </>,
            <>
              We use large-language-model processing to extract and organize information.{" "}
              <strong>polytoken&rsquo;s output is suggestive, not authoritative</strong> — it can be
              wrong, and nothing is treated as confirmed without your action.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    heading: "Who processes data on our behalf (subprocessors)",
    body: (
      <>
        <p>We rely on these providers to run polytoken; each processes data under our instructions:</p>
        <LegalList
          items={[
            <>
              <strong>Amazon Web Services (AWS)</strong> — inbound email (SES), raw-message and file
              storage (S3), OCR (Textract), and AI processing (Bedrock).
            </>,
            <>
              <strong>Supabase</strong> — authentication and database.
            </>,
            <>
              <strong>Vercel</strong> — application hosting.
            </>,
            <>
              <strong>Stripe</strong> — subscription payments (if you subscribe).
            </>,
          ]}
        />
        <p>
          These services process data in the United States, so using polytoken involves an
          international transfer of your data out of Brazil. We rely on the appropriate legal
          transfer mechanisms for this.
        </p>
      </>
    ),
  },
  {
    heading: "How we do NOT use your data",
    body: (
      <p>
        We do <strong>not</strong> sell or share your personal information, and we do not use ad-tech
        trackers or data brokers. We do not use the Gmail API; your mail reaches us because you
        forward it over standard email.
      </p>
    ),
  },
  {
    heading: "Retention",
    body: (
      <p>
        We keep your data for as long as your account is active and as needed to provide the
        service. When you delete content or close your account, we delete the associated data across
        our stores (raw messages, database records, and derived AI indexes) within a reasonable
        period, except where we must retain limited records to meet a legal obligation.
      </p>
    ),
  },
  {
    heading: "Your rights",
    body: (
      <>
        <p>
          Under Brazil&rsquo;s LGPD (and comparable laws such as California&rsquo;s CCPA), you can
          request to access, correct, delete, or export your personal data, and to withdraw consent.
        </p>
        <LegalList
          items={[
            <>
              You can delete your data yourself from within polytoken (account settings), or
            </>,
            <>
              email{" "}
              <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>{" "}
              and we will action your request.
            </>,
          ]}
        />
        <p>
          If someone whose data appears inside a polytoken user&rsquo;s email wishes to exercise
          their rights, they can also contact us at the address above.
        </p>
      </>
    ),
  },
  {
    heading: "Security",
    body: (
      <p>
        Data is encrypted at rest and in transit by our infrastructure providers, and access to
        production systems is restricted. No system is perfectly secure, but we take reasonable
        measures to protect your data and will notify you and any required authority of a breach
        that legally requires it.
      </p>
    ),
  },
  {
    heading: "Region",
    body: (
      <p>
        polytoken is not currently directed at or marketed to individuals in the European Union.
        If that changes, this policy will be updated with the additional protections the GDPR
        requires.
      </p>
    ),
  },
  {
    heading: "Changes to this policy",
    body: (
      <p>
        If we make a material change to how we handle your data, we will tell you clearly (for
        example, by email or an in-app notice) — never by a silent edit.
      </p>
    ),
  },
  {
    heading: "Contact",
    body: (
      <p>
        Questions or requests:{" "}
        <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ),
  },
];

export default function PrivacyPolicyPage(): React.ReactElement {
  return (
    <LegalDoc
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      intro={
        <p>
          This policy explains what data {PRODUCT_NAME} collects, why, who helps us process it, and
          the choices you have. polytoken reads email you choose to forward to it, so we take that
          responsibility seriously.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
