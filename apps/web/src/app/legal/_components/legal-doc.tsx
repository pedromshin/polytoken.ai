import * as React from "react";

/**
 * LegalDoc — shared shell for the /legal/* documents (privacy, terms).
 *
 * Chrome, monochrome, SANS throughout (laws 1 + 2 — serif is reserved for the
 * user's own material, and a policy is our chrome). A readable single-column
 * prose measure; no hero, no decorative colour. Server-rendered static content.
 */

export interface LegalSection {
  readonly heading: string;
  readonly body: React.ReactNode;
}

export function LegalDoc(props: {
  title: string;
  lastUpdated: string;
  intro: React.ReactNode;
  sections: readonly LegalSection[];
}): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">{props.title}</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <article className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-16">
          <header className="flex flex-col gap-2">
            <span className="text-2xs uppercase tracking-wide text-muted-foreground tabular">
              Last updated {props.lastUpdated}
            </span>
            <div className="rounded-md border border-rule bg-bright p-panel text-xs text-muted-foreground">
              This is a plain-language draft prepared to describe how polytoken actually works. It
              is not legal advice and has not yet been reviewed by a lawyer; the final wording may
              change.
            </div>
            <div className="text-sm text-ink">{props.intro}</div>
          </header>

          {props.sections.map((section, i) => (
            <section key={section.heading} className="flex flex-col gap-2">
              <h2 className="text-base font-semibold text-ink">
                <span className="text-muted-foreground tabular">{i + 1}. </span>
                {section.heading}
              </h2>
              <div className="flex flex-col gap-2 text-sm text-ink">{section.body}</div>
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}

/** A compact bulleted list in the legal prose voice. */
export function LegalList(props: { items: readonly React.ReactNode[] }): React.ReactElement {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink marker:text-muted-foreground">
      {props.items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
