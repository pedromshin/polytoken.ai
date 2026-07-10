import type { Metadata } from "next";

import { ForwardingAddressCard } from "~/app/_components/forwarding-address-card";

export const metadata: Metadata = {
  title: "Forwarding address — Polytoken",
};

/**
 * apps/web/src/app/settings/forwarding/page.tsx — dedicated minimal surface
 * for the caller's forwarding address (THRD-04, web half, Plan 45-06). A
 * standalone settings route (not the inbox) so `inbox-three-pane.tsx` (Plan
 * 45-04) stays untouched — no file overlap between the two plans.
 */
export default function ForwardingSettingsPage(): React.ReactElement {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-6">
      <ForwardingAddressCard />
    </div>
  );
}
