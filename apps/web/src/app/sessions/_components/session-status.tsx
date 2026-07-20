"use client";

/**
 * Session state as glyph + ink weight — never hue (law 1, taste-terminal pattern 5).
 *
 * running   = open triangle, ink, pulsing OPACITY while streaming (opacity is not colour)
 * ended     = hollow ring, pencil weight
 * exit code = words inside a rule-bordered chip ("exit 1"), never a red fill
 */
import { cn } from "@polytoken/ui";

export function SessionGlyph({
  alive,
  streaming = false,
  className,
}: {
  readonly alive: boolean;
  readonly streaming?: boolean;
  readonly className?: string;
}): React.ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block w-4 text-center text-sm leading-none",
        alive ? "text-ink" : "text-pencil",
        alive && streaming && "animate-pulse",
        className,
      )}
    >
      {alive ? "▷" : "○"}
    </span>
  );
}

/** A quiet state chip: ink text inside a rule border. Used for "live", "exit 0", etc. */
export function StateChip({
  children,
  muted = false,
}: {
  readonly children: React.ReactNode;
  readonly muted?: boolean;
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-rule px-chip-x py-chip-y text-2xs leading-none",
        muted ? "text-pencil" : "text-ink",
      )}
    >
      {children}
    </span>
  );
}
