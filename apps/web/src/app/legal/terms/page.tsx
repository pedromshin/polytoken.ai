import type { Metadata } from "next";
import * as React from "react";

import { LegalDoc, LegalList, type LegalSection } from "../_components/legal-doc";
import {
  COMPANY_CNPJ,
  COMPANY_LEGAL_NAME,
  COMPANY_TRADE_NAME,
  CONTACT_EMAIL,
  GOVERNING_JURISDICTION,
  PRODUCT_NAME,
} from "../_components/legal-entity";

export const metadata: Metadata = {
  title: "Terms of Service — Polytoken",
  description: "The terms that govern your use of polytoken.",
};

const LAST_UPDATED = "26 July 2026";

const SECTIONS: readonly LegalSection[] = [
  {
    heading: "Acceptance",
    body: (
      <p>
        By creating an account or using {PRODUCT_NAME}, you agree to these Terms. If you do not
        agree, do not use the service. {PRODUCT_NAME} is operated by {COMPANY_LEGAL_NAME} (trading
        as {COMPANY_TRADE_NAME}, CNPJ {COMPANY_CNPJ}) (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
      </p>
    ),
  },
  {
    heading: "What polytoken does",
    body: (
      <p>
        polytoken receives email you forward to it, parses and organizes it into a searchable,
        AI-assisted knowledge graph, and lets you chat with and build tools over your own data.{" "}
        <strong>
          polytoken&rsquo;s AI output is assistive and can be wrong; it is never a substitute for
          your own judgment
        </strong>{" "}
        and should not be relied on for legal, financial, medical, or other consequential decisions
        without independent verification.
      </p>
    ),
  },
  {
    heading: "Your account and acceptable use",
    body: (
      <>
        <p>You are responsible for your account and for the content you send to polytoken. You agree not to:</p>
        <LegalList
          items={[
            "use polytoken for anything unlawful, or to forward content you have no right to process;",
            "attempt to breach, overload, or reverse-engineer the service or its security;",
            "resell or provide the service to third parties except as we permit.",
          ]}
        />
      </>
    ),
  },
  {
    heading: "Your content",
    body: (
      <p>
        You own your content. You grant us a limited license to store and process it solely to
        provide the service to you (including AI processing as described in our Privacy Policy). We
        do not claim ownership of your content and do not sell it.
      </p>
    ),
  },
  {
    heading: "Subscriptions and billing",
    body: (
      <LegalList
        items={[
          "Paid plans are billed monthly in advance through Stripe. Prices are shown at checkout.",
          "You can cancel anytime from the billing portal; cancellation takes effect at the end of the current paid period, and you keep access until then.",
          "Except where required by law, fees already paid are non-refundable, including for partial periods.",
          "We may change prices with reasonable advance notice; changes apply to your next renewal.",
        ]}
      />
    ),
  },
  {
    heading: "Availability and your data",
    body: (
      <p>
        We work to keep polytoken available and your data safe, but the service is provided on an{" "}
        <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong> basis. polytoken is{" "}
        <strong>not a backup service</strong> and we do not guarantee that data will never be lost
        or unavailable. Keep your own copies of anything important. Your original email remains in
        your own mail provider regardless of polytoken.
      </p>
    ),
  },
  {
    heading: "Disclaimers",
    body: (
      <p>
        To the maximum extent permitted by law, we disclaim all warranties, express or implied,
        including merchantability, fitness for a particular purpose, and non-infringement. We do not
        warrant that the service will be uninterrupted, error-free, or that AI output will be
        accurate or complete.
      </p>
    ),
  },
  {
    heading: "Limitation of liability",
    body: (
      <p>
        To the maximum extent permitted by law, we are not liable for any indirect, incidental,
        special, consequential, or punitive damages, or for lost data, profits, or goodwill. Our
        total liability for any claim relating to the service is limited to the amount you paid us
        for the service in the twelve (12) months before the event giving rise to the claim.
      </p>
    ),
  },
  {
    heading: "Changes to the service and these terms",
    body: (
      <p>
        We may update the service and these Terms. If a change is material, we will tell you clearly
        (for example, by email or an in-app notice) before it takes effect — never by a silent edit.
        Continuing to use polytoken after a change means you accept the updated Terms.
      </p>
    ),
  },
  {
    heading: "Termination",
    body: (
      <p>
        You may stop using polytoken and delete your account at any time. We may suspend or
        terminate access if you materially breach these Terms or where required to protect the
        service or comply with the law.
      </p>
    ),
  },
  {
    heading: "Governing law",
    body: (
      <p>
        These Terms are governed by the laws of {GOVERNING_JURISDICTION}, without regard to
        conflict-of-laws rules.
      </p>
    ),
  },
  {
    heading: "Contact",
    body: (
      <p>
        Questions about these Terms:{" "}
        <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ),
  },
];

export default function TermsPage(): React.ReactElement {
  return (
    <LegalDoc
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      intro={<p>These terms govern your use of {PRODUCT_NAME}. Please read them.</p>}
      sections={SECTIONS}
    />
  );
}
