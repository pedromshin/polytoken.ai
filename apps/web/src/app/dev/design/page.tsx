/**
 * /dev/design — programmatically generated design-system consultation page.
 * All data comes from design-data.json, extracted from source by
 * .claude/skills/polytoken-design-system/scripts/build-design-data.mjs — never
 * hand-edit; rerun the script after token/component changes.
 */

import data from "./design-data.json";
import { LivePreview } from "./live-preview";

interface Prop {
  name: string;
  optional: boolean;
  type: string;
  default?: string;
}
interface Iface {
  name: string;
  extends: string | null;
  props: Prop[];
}
interface ComponentEntry {
  slug: string;
  importPath: string;
  origin: "shadcn-core" | "magicui" | "kibo";
  exports: string[];
  interfaces: Iface[];
  variants: { group: string; options: string[] }[];
  tokenRefs: string[];
}

const TOKEN_GROUPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "surface", label: "Surface" },
  { key: "semantic", label: "Semantic" },
  { key: "chart", label: "Chart" },
  { key: "sidebar", label: "Sidebar" },
  { key: "radius", label: "Radius" },
  { key: "other", label: "Other" },
];

const ORIGINS: ReadonlyArray<{ key: ComponentEntry["origin"]; label: string }> =
  [
    { key: "shadcn-core", label: "Core (shadcn)" },
    { key: "magicui", label: "Effects (Magic UI)" },
    { key: "kibo", label: "Utilities (Kibo UI)" },
  ];

const components = data.components as ComponentEntry[];

const Swatch = ({ value }: { value: string }) => {
  // Format-agnostic: design-data.json is regenerated (never hand-edited) from
  // globals.css's :root/.dark blocks by build-design-data.mjs, so the raw
  // token value is whatever CSS color function is currently in source —
  // oklch(...) post-Phase-55, previously a bare "H S% L%" HSL triplet. Accept
  // any non-empty string as a literal CSS color value rather than assuming
  // one format; reject only genuinely non-color placeholders (e.g. "—" for a
  // dark-mode token with no override).
  if (!value || value === "—") return null;
  const isBareHslTriplet = /^[\d.]+ [\d.%]+ [\d.%]+$/.test(value);
  const cssColor = isBareHslTriplet ? `hsl(${value})` : value;
  return (
    <span
      aria-hidden
      className="inline-block size-4 shrink-0 rounded-sm border border-border align-text-bottom"
      style={{ backgroundColor: cssColor }}
    />
  );
};

const SectionHeading = ({ id, title }: { id: string; title: string }) => (
  <h2 id={id} className="scroll-mt-6 border-b border-border pb-2 text-base font-semibold">
    {title}
  </h2>
);

const DesignConsultationPage = () => (
  <div className="flex gap-8 p-6">
    {/* sidebar */}
    <aside className="sticky top-6 hidden h-[calc(100vh-3rem)] w-56 shrink-0 overflow-y-auto text-sm lg:block">
      <p className="mb-2 font-semibold">Design system</p>
      <nav className="space-y-4">
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Foundations
          </p>
          <ul className="space-y-0.5">
            <li><a className="text-muted-foreground hover:text-foreground" href="#tokens">Color & radius tokens</a></li>
            <li><a className="text-muted-foreground hover:text-foreground" href="#motion">Motion utilities</a></li>
          </ul>
        </div>
        {ORIGINS.map((o) => (
          <div key={o.key}>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {o.label}
            </p>
            <ul className="space-y-0.5">
              {components
                .filter((c) => c.origin === o.key)
                .map((c) => (
                  <li key={c.slug}>
                    <a
                      className="text-muted-foreground hover:text-foreground"
                      href={`#c-${c.slug}`}
                    >
                      {c.slug}
                    </a>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>

    {/* content */}
    <main className="min-w-0 max-w-3xl flex-1 space-y-10">
      <header>
        <h1 className="text-lg font-semibold">Design-system reference</h1>
        <p className="text-sm text-muted-foreground">
          Generated {data.generated} from source ({data.tokens.length} tokens,{" "}
          {data.animations.length} motion utilities, {components.length}{" "}
          components). Regenerate:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            node .claude/skills/polytoken-design-system/scripts/build-design-data.mjs
          </code>
        </p>
      </header>

      <section className="space-y-4">
        <SectionHeading id="tokens" title="Color & radius tokens" />
        <p className="text-sm text-muted-foreground">
          Defined in <code className="text-xs">apps/web/src/app/globals.css</code>;
          consumed as <code className="text-xs">var(--token)</code> via
          Tailwind v4&apos;s <code className="text-xs">@theme inline</code> mapping. Change a
          token, every component follows.
        </p>
        {TOKEN_GROUPS.map((g) => {
          const rows = data.tokens.filter((t) => t.group === g.key);
          if (rows.length === 0) return null;
          return (
            <div key={g.key}>
              <h3 className="mb-1 text-sm font-medium">{g.label}</h3>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-left text-xs [font-variant-numeric:tabular-nums]">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">token</th>
                      <th className="px-3 py-1.5 font-medium">light</th>
                      <th className="px-3 py-1.5 font-medium">dark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.name} className="border-t border-border">
                        <td className="px-3 py-1.5 font-mono">--{t.name}</td>
                        <td className="px-3 py-1.5 font-mono">
                          <span className="inline-flex items-center gap-2">
                            <Swatch value={t.light} />
                            {t.light}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">
                          {t.dark ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <SectionHeading id="motion" title="Motion utilities" />
        <p className="text-sm text-muted-foreground">
          Defined in <code className="text-xs">packages/tailwind-config/web.ts</code>.
          Durations parameterized via <code className="text-xs">--duration</code> /{" "}
          <code className="text-xs">--speed</code> CSS vars set inline by components.
        </p>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <tbody>
              {data.animations.map((a) => (
                <tr key={a.utility} className="border-t border-border first:border-t-0">
                  <td className="px-3 py-1.5 font-mono">{a.utility}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{a.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {ORIGINS.map((o) => (
        <section key={o.key} className="space-y-6">
          <SectionHeading id={`origin-${o.key}`} title={o.label} />
          {components
            .filter((c) => c.origin === o.key)
            .map((c) => (
              <article
                key={c.slug}
                id={`c-${c.slug}`}
                className="scroll-mt-6 space-y-2 rounded-lg border border-border p-4"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-mono text-sm font-semibold">{c.slug}</h3>
                  <code className="text-xs text-muted-foreground">
                    import {"{"} {c.exports.slice(0, 4).join(", ")}
                    {c.exports.length > 4 ? ", …" : ""} {"}"} from &quot;{c.importPath}&quot;
                  </code>
                </div>

                <LivePreview slug={c.slug} variants={c.variants} />

                {c.variants.length > 0 && (
                  <div className="space-y-1">
                    {c.variants.map((v) => (
                      <p key={v.group} className="text-xs">
                        <span className="font-medium">{v.group}:</span>{" "}
                        {v.options.map((opt) => (
                          <code
                            key={opt}
                            className="mr-1 rounded bg-muted px-1 py-0.5"
                          >
                            {opt}
                          </code>
                        ))}
                      </p>
                    ))}
                  </div>
                )}

                {c.interfaces.map((iface) => (
                  <div key={iface.name} className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 font-medium" colSpan={2}>
                            {iface.name}
                            {iface.extends ? (
                              <span className="ml-1 font-normal">
                                extends {iface.extends}
                              </span>
                            ) : null}
                          </th>
                          <th className="px-3 py-1.5 text-right font-medium">default</th>
                        </tr>
                      </thead>
                      <tbody>
                        {iface.props.map((p) => (
                          <tr key={p.name} className="border-t border-border">
                            <td className="whitespace-nowrap px-3 py-1 font-mono">
                              {p.name}
                              {p.optional ? "?" : ""}
                            </td>
                            <td className="px-3 py-1 font-mono text-muted-foreground">
                              {p.type}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1 text-right font-mono">
                              {p.default ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

                {c.tokenRefs.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    consumes tokens:{" "}
                    {c.tokenRefs.map((t) => (
                      <code key={t} className="mr-1 rounded bg-muted px-1 py-0.5">
                        {t}
                      </code>
                    ))}
                  </p>
                )}
              </article>
            ))}
        </section>
      ))}

      {data.suites.length > 0 && (
        <section className="space-y-3">
          <SectionHeading id="suites" title="Compound suites" />
          {data.suites.map((s) => (
            <p key={s.slug} className="text-sm">
              <code className="text-xs">{s.importPath}</code> —{" "}
              <span className="text-muted-foreground">
                {s.exports.length} exports
              </span>
            </p>
          ))}
        </section>
      )}

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        Live rendering of these components:{" "}
        <a className="underline" href="/dev/components">
          /dev/components
        </a>
        . Registry catalog (963 installable items):{" "}
        <code>.claude/skills/polytoken-design-system/references/component-catalog.md</code>
      </footer>
    </main>
  </div>
);

export default DesignConsultationPage;
