import type { Metadata } from "next";
import Link from "next/link";

import { ForwardingAddressCard } from "~/app/_components/forwarding-address-card";

export const metadata: Metadata = {
  title: "Your forwarding address — Polytoken",
};

/**
 * /settings/forwarding — the settings surface, on the LOCKED identity
 * (Phase 62 / SURF-05).
 *
 * The first draft floated a lone card in dead space — the exact
 * centered-card silhouette the anti-generic checklist names (tell #1). This
 * is now a real settings frame: a quiet ink section rail on the left
 * (taste §3: "section nav as a quiet left rail in ink" — one section today,
 * built so the next one is a one-line append), the section's content on the
 * right with its own heading and explanation. Below `md` the rail collapses
 * to a strip above the content.
 *
 * `ForwardingAddressCard` (swept in Phase 60, owned by the inbox vertical)
 * already carries its own loading/error/copy states — this page frames it,
 * never duplicates it.
 */

/** The settings sections — one today; append here as sections land. */
const SECTIONS = [
  { href: "/settings/forwarding", label: "Forwarding", active: true },
] as const;

export default function ForwardingSettingsPage(): React.ReactElement {
  return (
    <main className="min-h-[calc(100vh-3.5rem)] w-full">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:flex-row md:gap-10 md:py-12">
        {/* Section rail — quiet, ink, no icons-without-words */}
        <nav
          aria-label="Settings sections"
          className="shrink-0 md:w-44"
        >
          <p className="mb-2 px-2.5 text-2xs font-semibold tracking-[0.07em] text-pencil uppercase">
            Settings
          </p>
          <ul className="flex flex-row gap-0.5 md:flex-col">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <Link
                  href={section.href}
                  aria-current={section.active ? "page" : undefined}
                  className={`block rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    section.active
                      ? "bg-shade font-semibold text-ink"
                      : "text-faded hover:bg-shade hover:text-ink"
                  }`}
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Section content */}
        <section className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-ink">Email forwarding</h1>
          <p className="mt-1 max-w-prose text-sm text-faded">
            Mail forwarded to your personal polytoken address is read,
            extracted, and filed in your inbox — every fact it pulls out stays
            tied to the message it came from.
          </p>

          <div className="mt-6 border-t border-hair pt-6">
            <ForwardingAddressCard />
          </div>
        </section>
      </div>
    </main>
  );
}
