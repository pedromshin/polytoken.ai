"use client";

import { toast } from "sonner";

interface ConfirmDenyControlsProps {
  /** The candidate FIELD component id. */
  readonly componentId: string;
  /**
   * Origin (D-18): auto-detected boxes get a soft-reject + Undo toast (the box
   * leaves view); user-drawn boxes keep their geometry, only the value clears.
   * Drives ONLY the client-side undo-toast affordance — the server is the
   * authority for the actual soft-reject vs clear-value outcome.
   */
  readonly isAutoDetected: boolean;
  /** Confirm the candidate (promote → confirmed, D-17 flywheel). */
  readonly onConfirm: (componentId: string) => void;
  /** Deny the candidate (origin-aware on the server, D-18). */
  readonly onDeny: (componentId: string) => void;
  /** Undo an auto-detected deny (restores the rejected candidate). */
  readonly onRestore?: (componentId: string) => void;
}

/**
 * ConfirmDenyControls — the inline floating ✓/✗ for candidate FIELD boxes
 * (D-16/D-17/D-18, 09-UI-SPEC §Inline ✓/✗ Controls).
 *
 * Positioned `absolute -top-3 right-0 z-30`. ✓ confirms (flywheel). ✗ denies:
 * auto-detected → deny + `toast.info("Field value cleared.", { Undo, 3000ms })`
 * (box leaves view); user-drawn → deny (keeps box, clears value). The exact undo
 * toast copy + 3000ms duration come from the Copywriting Contract.
 */
export function ConfirmDenyControls({
  componentId,
  isAutoDetected,
  onConfirm,
  onDeny,
  onRestore,
}: ConfirmDenyControlsProps) {
  function handleDeny(): void {
    onDeny(componentId);
    if (isAutoDetected) {
      toast.info("Field value cleared.", {
        action: {
          label: "Undo",
          onClick: () => onRestore?.(componentId),
        },
        duration: 3000,
      });
    }
  }

  return (
    <div
      className="absolute -top-3 right-0 flex gap-1 z-30 pointer-events-auto"
      role="group"
      aria-label="Confirm or deny field value"
    >
      <button
        type="button"
        aria-label="Confirm field value"
        className="h-5 w-5 rounded-full bg-success hover:bg-success/90 active:bg-success/80 text-success-foreground flex items-center justify-center text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        onClick={(e) => {
          e.stopPropagation();
          onConfirm(componentId);
        }}
      >
        ✓
      </button>
      <button
        type="button"
        aria-label="Deny field value"
        className="h-5 w-5 rounded-full bg-destructive hover:bg-destructive/90 active:bg-destructive/80 text-destructive-foreground flex items-center justify-center text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        onClick={(e) => {
          e.stopPropagation();
          handleDeny();
        }}
      >
        ✗
      </button>
    </div>
  );
}
