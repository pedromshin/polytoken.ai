import type { Metadata } from "next";
import Link from "next/link";

import { createClient as createSupabaseServerClient } from "~/lib/supabase/server";

import { DesktopsPane } from "./_components/desktops-pane";

export const metadata: Metadata = {
  title: "Cloud desktops — Polytoken",
};

/**
 * /settings/desktops — the ST-03 desktop-management pane (E5 / RFC §5 / §6),
 * slotted into the same settings frame as /settings/forwarding (a quiet ink
 * section rail on the left, the section content on the right). Server component:
 * it resolves the signed-in user server-side (getUser(), never getSession())
 * and hands the id to the client pane as the tenancy floor the owner-scoped
 * `desktop.list` is filtered to.
 */

const SECTIONS = [
  { href: "/settings/forwarding", label: "Forwarding", active: false },
  { href: "/settings/desktops", label: "Cloud desktops", active: true },
] as const;

export default async function DesktopsSettingsPage(): Promise<React.ReactElement> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-[calc(100vh-3.5rem)] w-full">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:flex-row md:gap-10 md:py-12">
        {/* Section rail — quiet, ink, no icons-without-words */}
        <nav aria-label="Settings sections" className="shrink-0 md:w-44">
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
          <h1 className="text-xl font-semibold text-ink">Cloud desktops</h1>
          <p className="mt-1 max-w-prose text-sm text-faded">
            Whole remote machines polytoken runs for you and streams into the
            canvas. Each desktop bills by the hour while it runs — the live cost
            is shown here, alongside the controls to hibernate (close the lid,
            billing drops to storage) or destroy (delete the machine and its
            disk permanently).
          </p>

          <div className="mt-6 border-t border-hair pt-6">
            <DesktopsPane currentUserId={user?.id} />
          </div>
        </section>
      </div>
    </main>
  );
}
