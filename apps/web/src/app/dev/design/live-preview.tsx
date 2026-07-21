/**
 * live-preview.tsx — the design-consultation page's per-component preview slot.
 *
 * HONEST SCOPE: this dev page is generated from `design-data.json` (static metadata extracted by
 * the polytoken-design-system skill). A TRUE "live preview" would dynamically import and mount each
 * shadcn/magicui/kibo component by slug — fragile (arbitrary client components, each with their own
 * required props/providers) and out of scope for a static consultation reference. So this renders an
 * honest preview HEADER: the component's identity and its declared variant axes at a glance. The
 * exhaustive variant listing lives directly below this in the page. The `"use client"` boundary and
 * the props shape are kept so a real interactive preview can drop in here later without touching the
 * page.
 */
"use client";

interface LivePreviewProps {
  readonly slug: string;
  readonly variants: readonly { readonly group: string; readonly options: readonly string[] }[];
}

export function LivePreview({ slug, variants }: LivePreviewProps): React.JSX.Element {
  const axisCount = variants.length;
  const optionCount = variants.reduce((sum, v) => sum + v.options.length, 0);

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2"
      aria-label={`Preview reference for ${slug}`}
    >
      <span className="font-mono text-xs font-semibold text-foreground">{slug}</span>
      {axisCount > 0 ? (
        <span className="text-xs text-muted-foreground">
          {axisCount} variant {axisCount === 1 ? "axis" : "axes"} · {optionCount} option
          {optionCount === 1 ? "" : "s"}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">no declared variants</span>
      )}
    </div>
  );
}
