"use client";

/**
 * body-view.tsx — the email BODY as a first-class document (moved from
 * apps/web/src/app/emails/[id]/_components/email-body-pane.tsx so the inbox
 * preview and the editor render the message through ONE component).
 *
 * The detail canvas was attachment-only: an email ingested with no attachment
 * bytes (e.g. Gmail-forwarded, body-only) auto-opened nothing, so the canvas
 * fell through to "No document open" and the message text — which IS the whole
 * email — was unreachable. This view renders that body, filling its container.
 *
 * Safety: HTML is DOMPurify-sanitized AFTER client hydration (mirrors the
 * original email-body-pane / T-05-10, CR-01) — the raw string is never written
 * to the DOM. Until the sanitized output is ready for an HTML-only email we
 * show a quiet loading state rather than flashing "no body".
 *
 * OPTIONAL region overlay: when a `components` prop is passed, the email_body-
 * sourced regions (attachmentId null) are painted DISPLAY-ONLY over the body —
 * NOT as polygon boxes. A body region's polygon lives in some upstream
 * PDF/normalized coordinate frame that has no honest mapping onto reflowed
 * HTML, so drawing boxes garbled the text (the mobile "PEDREDRO," bug). Instead
 * each region is anchored to its OWN `contentText`: `applyBodyRegionHighlights`
 * finds that text in the rendered body and tints the live range via the CSS
 * Custom Highlight API (`::highlight(email-body-region)` in globals.css). No
 * wrapper nodes, no selection, no edit affordances; a region whose text can't
 * be found is silently skipped. Omit the prop for the plain rendering.
 *
 * DESIGN LAW: the message is the user's own words → serif + data-evidence
 * (law 2, the pair). Chrome stays in the ink/faded washes; a machine-inferred
 * body region is an unconfirmed suggestion → the soft amber suggested wash
 * (law 1: colour is earned).
 */

import DOMPurify from "dompurify";
// Explicit React import — vitest's esbuild transform needs `React` in scope
// when a test mounts this component directly (see inbox-three-pane.tsx note).
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { applyBodyRegionHighlights } from "./body-region-highlights";

import type { ComponentRole } from "~/components/regions/region-overlay-box";

/** The subset of an emails.detail component row the highlighter needs. */
export interface BodyViewRegionComponent {
  readonly id: string;
  readonly attachmentId: string | null;
  readonly sourceType: string;
  readonly contentText: string | null;
  readonly extractionStatus: string;
  readonly location: unknown;
  readonly entityTypeLabel: string | null;
  readonly entityTypeSlug: string | null;
  readonly extractedFields: unknown;
  readonly confidenceScore: unknown;
  readonly role?: ComponentRole;
  readonly parentComponentId?: string | null;
}

interface EmailBodyViewProps {
  bodyText: string | null;
  bodyHtml: string | null;
  /**
   * OPTIONAL region highlight capability: region components for this email.
   * The view filters to email_body-sourced ones (attachmentId === null) and
   * paints them display-only, anchored to their own text. Omit the prop for
   * the plain (editor canvas fallback) rendering.
   */
  components?: ReadonlyArray<BodyViewRegionComponent>;
}

function hasText(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

export function EmailBodyView({
  bodyText,
  bodyHtml,
  components,
}: EmailBodyViewProps) {
  const [safeHtml, setSafeHtml] = useState<string | null>(null);

  useEffect(() => {
    if (hasText(bodyHtml)) {
      setSafeHtml(DOMPurify.sanitize(bodyHtml));
    } else {
      setSafeHtml(null);
    }
  }, [bodyHtml]);

  // ---- Display-only text-anchored region highlight (email_body regions) ----
  // One ref for whichever body element renders (prose div OR the <pre>); a
  // callback ref sidesteps the div/pre type mismatch a shared useRef would hit.
  const contentRef = useRef<HTMLElement | null>(null);
  const attachContent = useCallback((el: HTMLElement | null) => {
    contentRef.current = el;
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (el === null) return;
    const bodyRegions =
      components?.filter(
        (c) => c.attachmentId === null && hasText(c.contentText),
      ) ?? [];
    if (bodyRegions.length === 0) return;
    // Re-anchors after the sanitized HTML (or text) is in the DOM; returns a
    // cleanup that withdraws this body's ranges. No CSS Custom Highlight
    // support (jsdom, old browsers) → a clean no-op.
    return applyBodyRegionHighlights(el, bodyRegions);
    // Re-run whenever the rendered body or the region set changes.
  }, [safeHtml, bodyText, components]);

  const rawHtml = hasText(bodyHtml);
  const rawText = hasText(bodyText);

  // Nothing to show — neither a body nor (per the caller) an attachment.
  if (!rawHtml && !rawText) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-faded">
        This email has no readable body or attachments.
      </div>
    );
  }

  const showHtml = hasText(safeHtml);
  // HTML-only email whose sanitized output is still pending: hold the frame
  // rather than flashing the empty state on the first paint.
  const sanitizing = rawHtml && !rawText && !showHtml;

  return (
    <div className="h-full overflow-auto p-panel">
      <div className="relative mx-auto max-w-prose">
        {showHtml ? (
          <div
            ref={attachContent}
            role="region"
            aria-label="Message"
            data-field="body"
            data-evidence
            className="prose prose-sm max-w-none font-serif text-ink [&_a]:text-ink [&_a]:underline"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: safeHtml is DOMPurify-sanitized after client hydration (T-05-10, CR-01)
            dangerouslySetInnerHTML={{ __html: safeHtml as string }}
          />
        ) : sanitizing ? (
          <p className="text-sm text-faded" aria-busy="true">
            Loading message…
          </p>
        ) : (
          <pre
            ref={attachContent}
            role="region"
            aria-label="Message"
            data-field="body"
            data-evidence
            className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink"
          >
            {bodyText}
          </pre>
        )}
      </div>
    </div>
  );
}
