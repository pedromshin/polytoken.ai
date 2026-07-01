/**
 * safe-placeholder.ts — the accessible fallback shown when island code is rejected by the
 * allowlist or cannot be repaired within the attempt budget (circuit breaker).
 *
 * Rendered as the frame's srcdoc so the fallback itself stays inside the same jail
 * (still `sandbox="allow-scripts"`, no host access).
 */

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/** Build a minimal, accessible fallback document for the frame. */
export function buildSafePlaceholderSrcdoc(reason?: string): string {
  const detail = reason
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280">${escapeHtml(reason)}</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
</head><body style="margin:0;font-family:system-ui,sans-serif">
<div role="alert" style="padding:16px;border:1px solid #fca5a5;border-radius:8px;background:#fef2f2;color:#991b1b">
<strong style="font-size:14px">Unable to render this widget safely.</strong>
${detail}
</div>
</body></html>`;
}

/** The zero-argument default fallback document. */
export const SAFE_PLACEHOLDER_SRCDOC: string = buildSafePlaceholderSrcdoc();
