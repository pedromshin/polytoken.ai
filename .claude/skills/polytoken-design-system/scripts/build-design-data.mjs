// Extracts the design system's full controllable surface from source into
// apps/web/src/app/dev/design/design-data.json — consumed by the /dev/design
// consultation page. Rerun after adding components or changing tokens:
//   node .claude/skills/polytoken-design-system/scripts/build-design-data.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const uiSrc = join(repoRoot, "packages", "ui", "src");
const globalsCss = join(repoRoot, "apps", "web", "src", "app", "globals.css");
const outDir = join(repoRoot, "apps", "web", "src", "app", "dev", "design");

// ---------- tokens from globals.css ----------
const parseCssVars = (block) => {
  const vars = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
};
const css = readFileSync(globalsCss, "utf8");
// Strip comments before selector-matching: globals.css has prose comments
// that mention ":root"/".dark" in running text well before the real rule
// (e.g. "...in :root, D-48-01..." at line 68, real ":root {" at line 316) —
// a naive css.indexOf(selector) grabs the comment's position and then the
// NEXT "{" in the file, silently returning the WRONG block's contents
// (found live: pre-fix, this returned the `@theme { ... }` radius/shadow
// block instead of `:root`'s color tokens, and design-data.json shipped
// zero oklch values despite the source file being fully migrated).
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const grabBlock = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ruleStart = new RegExp(`(^|[}\\s;])${escaped}\\s*\\{`, "m");
  const m = cssNoComments.match(ruleStart);
  if (!m) return "";
  const open = m.index + m[0].length - 1;
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < cssNoComments.length) {
    if (cssNoComments[i] === "{") depth++;
    if (cssNoComments[i] === "}") depth--;
    i++;
  }
  return cssNoComments.slice(open + 1, i - 1);
};
const lightVars = parseCssVars(grabBlock(":root"));
const darkVars = parseCssVars(grabBlock(".dark"));
const tokenGroup = (name) => {
  if (name.startsWith("sidebar")) return "sidebar";
  if (name.startsWith("chart")) return "chart";
  if (name.startsWith("radius")) return "radius";
  if (/^(background|foreground|card|popover|border|input|ring)/.test(name)) return "surface";
  if (/^(primary|secondary|accent|muted|destructive)/.test(name)) return "semantic";
  return "other";
};
const tokens = Object.keys(lightVars).map((name) => ({
  name,
  light: lightVars[name],
  dark: darkVars[name] ?? null,
  group: tokenGroup(name),
}));

// ---------- animations ----------
// Prior to Phase 55 these lived in packages/tailwind-config/web.ts's JS
// `animation: {}` object; the Tailwind v4 migration (55-02/55-03) ported them
// natively into globals.css's `@theme { --animate-*: ...; }` declarations
// (packages/tailwind-config/web.ts no longer has an `animation` key at all —
// reading it here would silently yield zero motion utilities). Extract
// `--animate-<name>: <value>;` custom properties directly from globals.css,
// which is the current single source of truth for animation utilities.
const animations = [...cssNoComments.matchAll(/--animate-([\w-]+):\s*([^;]+);/g)].map((m) => ({
  utility: `animate-${m[1]}`,
  value: m[2].trim(),
}));

// ---------- component extraction ----------
const braceSlice = (src, from) => {
  const open = src.indexOf("{", from);
  if (open === -1) return "";
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === "{") depth++;
    if (src[i] === "}") depth--;
    i++;
  }
  return src.slice(open + 1, i - 1);
};

const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const parseProps = (body) => {
  // top-level "name?: type" lines of an interface/type body
  const props = [];
  let depth = 0;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (depth === 0) {
      const m = line.match(/^(?:readonly )?([\w$]+)(\?)?:\s*(.+?);?$/);
      if (m && !line.startsWith("//")) {
        props.push({ name: m[1], optional: !!m[2], type: m[3].replace(/;$/, "") });
      }
    }
    depth += (rawLine.match(/{/g) ?? []).length - (rawLine.match(/}/g) ?? []).length;
    if (depth < 0) depth = 0;
  }
  return props;
};

const parseDefaults = (src) => {
  // first destructuring pattern with defaults in an exported component fn
  const defaults = {};
  const m = src.match(/(?:export (?:const|function) \w+[\s\S]{0,200}?)\(\s*\{([\s\S]*?)\}\s*(?::|,\s*ref\)?|\))/);
  if (!m) return defaults;
  for (const d of m[1].matchAll(/([\w$]+)\s*=\s*("[^"]*"|'[^']*'|[\w.[\]-]+)/g)) {
    defaults[d[1]] = d[2].replace(/^['"]|['"]$/g, "");
  }
  return defaults;
};

const parseCva = (src) => {
  const out = [];
  let idx = src.indexOf("cva(");
  while (idx !== -1) {
    const variantsIdx = src.indexOf("variants:", idx);
    if (variantsIdx !== -1 && variantsIdx < idx + 6000) {
      const body = braceSlice(src, variantsIdx);
      const groups = [];
      let depth = 0;
      let current = null;
      for (const rawLine of body.split("\n")) {
        const line = rawLine.trim();
        if (depth === 0) {
          const g = line.match(/^([\w$]+):\s*\{/);
          if (g) {
            current = { group: g[1], options: [] };
            groups.push(current);
          }
        } else if (depth === 1 && current) {
          const o = line.match(/^"?([\w-]+)"?:/);
          if (o) current.options.push(o[1]);
        }
        depth += (rawLine.match(/{/g) ?? []).length - (rawLine.match(/}/g) ?? []).length;
      }
      if (groups.length > 0) out.push(groups);
    }
    idx = src.indexOf("cva(", idx + 4);
  }
  return out.flat();
};

const VENDORED_EFFECTS = new Set([
  "animated-beam", "animated-list", "blur-fade", "border-beam", "confetti",
  "dot-pattern", "magic-card", "marquee", "number-ticker", "shimmer-button",
  "shine-border", "typing-animation",
]);
const VENDORED_KIBO = new Set([
  "avatar-stack", "code-block", "code-block-server", "dialog-stack",
  "dropzone", "relative-time", "spinner", "tags",
]);

const files = readdirSync(uiSrc, { withFileTypes: true });
const components = [];
for (const f of files) {
  if (!f.isFile() || !f.name.endsWith(".tsx")) continue;
  const slug = f.name.replace(/\.tsx$/, "");
  const raw = readFileSync(join(uiSrc, f.name), "utf8");
  const src = stripComments(raw);

  const exports = [...src.matchAll(/^export (?:const|function) ([A-Z][\w$]*)/gm)].map((m) => m[1]);
  const interfaces = [];
  for (const m of src.matchAll(/(?:export )?(?:interface|type) ([\w$]*Props[\w$]*)(?:<[^>]*>)?(?:\s+extends\s+([^{=]+))?\s*(=\s*[^{]*)?\{/g)) {
    const body = braceSlice(src, m.index + m[0].length - 1);
    const props = parseProps(body);
    if (props.length > 0) {
      interfaces.push({
        name: m[1],
        extends: m[2]?.trim() ?? null,
        props,
      });
    }
  }
  const defaults = parseDefaults(src);
  for (const iface of interfaces) {
    for (const p of iface.props) {
      if (defaults[p.name] !== undefined) p.default = defaults[p.name];
    }
  }
  const variants = parseCva(src);
  const tokenRefs = [...new Set([...src.matchAll(/\b(?:bg|text|border|ring|fill|stroke|from|via|to)-(primary|secondary|accent|muted|destructive|card|popover|background|foreground|border|input|ring|sidebar|chart-\d)\b/g)].map((m) => m[1]))];

  components.push({
    slug,
    importPath: `@polytoken/ui/${slug}`,
    origin: VENDORED_EFFECTS.has(slug)
      ? "magicui"
      : VENDORED_KIBO.has(slug)
        ? "kibo"
        : "shadcn-core",
    exports,
    interfaces,
    variants,
    tokenRefs,
  });
}

// compound suites (directories)
const suites = files
  .filter((f) => f.isDirectory() && !f.name.startsWith("__"))
  .map((d) => {
    const idx = join(uiSrc, d.name, "index.ts");
    let exports = [];
    try {
      exports = [...readFileSync(idx, "utf8").matchAll(/^export \{?\s*([A-Za-z][\w$]*)/gm)].map((m) => m[1]);
    } catch {
      /* no index */
    }
    return { slug: d.name, importPath: `@polytoken/ui/${d.name}`, exports };
  });

const data = {
  generated: new Date().toISOString().slice(0, 10),
  tokens,
  animations,
  components: components.sort((a, b) => a.slug.localeCompare(b.slug)),
  suites,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "design-data.json"), JSON.stringify(data, null, 2));
console.log(
  `tokens=${tokens.length} animations=${animations.length} components=${components.length} suites=${suites.length} -> ${join(outDir, "design-data.json")}`
);
