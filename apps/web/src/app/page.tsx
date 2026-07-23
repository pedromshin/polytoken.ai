"use client";

import { useEffect, useState } from "react";
import { LayoutList, CircleDashed } from "lucide-react";

import { api } from "~/trpc/react";

import { EmailCirclePackView } from "./_components/email-circle-pack-view";
import { InboxThreePane } from "./_components/inbox-three-pane";

/** The inbox's view modes: the Gmail-style three-pane, or the TM-02 circle-pack
 * "landscape". A fourth inbox view, switched by the bar below. */
type InboxView = "list" | "landscape";

const VIEW_OPTIONS: ReadonlyArray<{
  value: InboxView;
  label: string;
  Icon: typeof LayoutList;
}> = [
  { value: "list", label: "List", Icon: LayoutList },
  { value: "landscape", label: "Landscape", Icon: CircleDashed },
];

function InboxViewSwitcher({
  view,
  onChange,
}: {
  readonly view: InboxView;
  readonly onChange: (next: InboxView) => void;
}): React.ReactElement {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-hair bg-leaf px-panel">
      <nav className="flex items-center gap-0.5" aria-label="Inbox view">
        {VIEW_OPTIONS.map(({ value, label, Icon }) => {
          const active = view === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(value)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                active
                  ? "bg-shade font-semibold text-ink"
                  : "text-faded hover:bg-shade hover:text-ink"
              }`}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default function EmailsPage() {
  const [view, setView] = useState<InboxView>("list");

  const { data, isLoading, isError, error } = api.emails.listThreads.useQuery(
    { limit: 50, offset: 0 },
    { enabled: view === "list" },
  );

  // Log technical error detail to browser devtools; show only a friendly
  // message to the user (WR-02).
  useEffect(() => {
    if (isError && error) {
      console.error("[EmailsPage] tRPC error:", error);
    }
  }, [isError, error]);

  // The app shell (SidebarInset) + the three-pane / landscape own the layout —
  // a slim view switcher sits above whichever view is active.
  return (
    <div className="flex h-[calc(100svh-var(--app-tabbar-h))] flex-col">
      <InboxViewSwitcher view={view} onChange={setView} />
      <div className="min-h-0 flex-1">
        {view === "list" ? (
          <InboxThreePane data={data} isLoading={isLoading} isError={isError} />
        ) : (
          <EmailCirclePackView />
        )}
      </div>
    </div>
  );
}
