"use client";

import { useEffect } from "react";

import { api } from "~/trpc/react";

import { InboxThreePane } from "./_components/inbox-three-pane";

export default function EmailsPage() {
  const { data, isLoading, isError, error } = api.emails.listThreads.useQuery({
    limit: 50,
    offset: 0,
  });

  // Log technical error detail to browser devtools; show only a friendly
  // message to the user (WR-02).
  useEffect(() => {
    if (isError && error) {
      console.error("[EmailsPage] tRPC error:", error);
    }
  }, [isError, error]);

  // The app shell (SidebarInset) + the three-pane own the layout — the old
  // centered main wrapper is gone. The page slot just fills the content height.
  return (
    <div className="h-[calc(100svh-var(--app-tabbar-h))]">
      <InboxThreePane data={data} isLoading={isLoading} isError={isError} />
    </div>
  );
}
