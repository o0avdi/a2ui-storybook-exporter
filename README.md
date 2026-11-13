# storybook-a2ui

Turn a Storybook build's own component manifest into a validated [A2UI](https://github.com/a2ui-project/a2ui) v1.0
`catalog.json`, with a plain-language compatibility report. No project source is parsed, no component-specific
schema is written by hand, and anything the exporter cannot represent is reported instead of dropped.

Status: **0.1 prototype, local only, not published.** Node >= 22. One dependency (`ajv`). License: Apache-2.0 (see
`THIRD_PARTY_NOTICES.md`).

## Quick start

### A. Try it in this repository (no Storybook project needed)

Run from the root of this repository. The committed fixture is a real `storybook build` of
[`trussworks/react-uswds`](https://github.com/trussworks/react-uswds) (see `test/fixtures/PROVENANCE.md`).

```bash
npm ci
node bin/storybook-a2ui.mjs inspect --storybook test/fixtures/react-uswds        # what can be exported, and why not

OUT=$(mktemp -d)
node bin/storybook-a2ui.mjs export --storybook test/fixtures/react-uswds --components GovBanner \
  --catalog-id https://example.org/catalogs/react-uswds/govbanner --out "$OUT"
diff "$OUT/catalog.json" test/golden/govbanner.catalog.json && echo "matches the golden catalog"
```

`export` validates the catalog against the pinned official A2UI v1.0 schemas before writing `catalog.json` and
`export-report.json` into `--out` (a new or empty directory). `--catalog-id` is required: use a stable `https` URI you own.

### B. Use it on your own Storybook project

**1. In your Storybook project** (Storybook >= 10.6): turn on the components manifest, then build.

```ts
// .storybook/main.ts
features: { componentsManifest: true },
typescript: { reactDocgen: 'react-docgen' },   // React projects
```

```bash
npx storybook build -o storybook-static        # writes storybook-static/manifests/components.json
```

Without the feature flag the exporter stops with an error that shows these two lines.

**2. Run the exporter** (not published to npm yet). Either call it by path:

```bash
node /path/to/a2ui-storybook-exporter/bin/storybook-a2ui.mjs inspect --storybook ./storybook-static
```

or install a local tarball: run `npm pack` in this repository, then in your project
`npm install --save-dev /path/to/storybook-a2ui-0.1.0.tgz` and use `npx storybook-a2ui ...`.

```bash
npx storybook-a2ui inspect --storybook ./storybook-static
npx storybook-a2ui export  --storybook ./storybook-static --catalog-id https://example.org/catalogs/my-lib/1 \
  --out ./a2ui-catalog [--components A,B]
```

Teammates installing from a ZIP and testing another library: see `docs/TEAM_TESTING.md`.

Repeat `--storybook` to combine React and Angular builds. `storybook-a2ui --help` lists every option.
Exit codes: `0` success, `1` nothing could be exported under the policy, `2` usage or input error.

## Architecture

```
index.json + manifests/components.json   (a `storybook build` directory)
        │
  storybook-build   read, check, resolve $refs inside the build dir
        │
  adapter           react-v0 | angular-vite-v1 -> one normalized contract (decides nothing)
        │
  policy            exportable, or blocked with a named reason; omissions recorded
        │
  a2ui/catalog      existing generator -> A2UI v1.0 catalog
        │
  a2ui/validate     pinned official schemas (spec/v1_0) via ajv
        │
  catalog.json + export-report.json
```

| Module | Role |
|---|---|
| `bin/storybook-a2ui.mjs` | `inspect` and `export` commands |
| `src/storybook-build.mjs` | reads `index.json` / `components.json`; resolves `$ref`s inside the build directory only |
| `src/adapters/react-v0.mjs`, `angular-vite-v1.mjs` | manifest entry -> normalized contract |
| `src/contract.mjs` | the normalized shape, the single export policy, hand-off to the generator |
| `src/export.mjs` | orchestration, report, validation, output |
| `src/a2ui/catalog.mjs` | A2UI v1.0 catalog generator (carried over from the capstone repository) |
| `src/a2ui/validate.mjs` | validation against the pinned official schemas in `spec/v1_0` |
| `src/a2ui/react-manifest.mjs` | React docgen type classification (carried over) |

### Interactive architecture map (Floorplan)

`docs/architecture/floorplan.html` is an interactive map of this codebase, made with the
[Floorplan](https://github.com/haydenschmitty/floorplan) tool so teammates can learn the architecture without reading every
file first. It shows the CLI, the Storybook build reader, the React and Angular adapters, the normalized contract and export
policy, catalog generation, validation and the tests. Every card has a plain description and the real file path. It also has
guided flows for `inspect`, for `export` (to `catalog.json` and `export-report.json`), for how unsupported metadata is blocked
or omitted, and for why Storybook metadata is not a complete source of truth. The map also marks which parts are implemented
and which are only planned.

**To open it:** download or clone the repository and open `docs/architecture/floorplan.html` in any browser (double-click it).
Do not open it from GitHub's file view, which only shows the source text. Press **Start here** for a short tour or **Flows**
for the guided walkthroughs.

- **Works offline:** pan and zoom, search, click cards for details, the tour, and the guided flows. It is one self-contained
  file; it needs no install, server or network.
- **Not included:** the **Ask** bar (AI questions about the code). That needs a separate local Floorplan setup with Claude Code
  and the map generated on your own machine; it is not part of the shared file.
- **Snapshot:** the map was generated from commit `142dd7b` and does not update itself. After code changes it can be
  out of date (the code and this README are the source of truth). Regenerate it with Floorplan and replace the file in a pull
  request. Its Recent Work and Health views are deliberately left out of the shared copy.

## Compatibility

| | React (manifest v0, `react-docgen`) | Angular (`@storybook/angular-vite` manifest v1) |
|---|---|---|
| Property types | `boolean`, `string`, `number`, string-literal unions, `number \| string` | `boolean`, `string`, `number`, string-literal unions |
| Requiredness, descriptions | from docgen | from `type.required`, `argTypes.description` |
| Defaults | from docgen | booleans, numbers, enum members; plain-string defaults refused (encoding unverified) |
| Events / callbacks | **block** the component | **block** the component (outputs) |
| `children` / `ReactNode` | **block**; with `--supported-subset --mappings`, exported as text where a reviewed mapping says so | n/a |
| Objects, arrays, functions, other types | **block**, with the type named; with `--supported-subset`, left out when `required: false` | **block** (the same option applies, but real output never says `required: false`) |

Not supported yet: `string[]` and nullable primitives (both representable in A2UI v1.0), Vue, Web Components,
other manifest versions, complete Windows verification (one tester has run the baseline there; see `docs/TEAM_TESTING.md`). Event mapping is strict by default; `--unmapped-events omit` exports
the properties and records each event as not exported in the report and the component description.

## Supported-subset mode (opt-in)

By default, one property the exporter cannot represent blocks its whole component. `--supported-subset` exports a
deliberately narrower interface instead. It has two rules, and both apply only when the Storybook metadata says
`required: false`:

- A property with an unsupported type is **left out**.
- A property named `id` or `component` is **left out**, whatever its type. A2UI v1.0 uses both names itself
  (`component` says which catalog component an instance is, `id` identifies the instance), so the source property
  cannot be exported and the exporter does not rename. A renderer must never pass the A2UI `component` or `id` of an
  instance to the React component as that property (`docs/MAPPINGS.md`).
- Either property **still blocks** when it is required, or when the metadata does not say whether it is
  (a missing or non-boolean `required` is never read as optional). `@storybook/angular-vite` writes no `required`
  key for an optional input, so the mode leaves nothing out of an Angular component today.
- On its own it never leaves out projected content (`children`, `ReactNode`), events (those follow
  `--unmapped-events`), an unsupported default or a metadata error. These block as before. Content can be exported
  as text, and an optional property left out for a stated reason, with a reviewed mappings file (next section); a
  metadata error blocks even then.

What the mode adds to the output:

- Each property left out is named in the component's description in `catalog.json`
  ("Narrower interface than the source component: ... are not exported: sx, classes."), and in `omittedKnown` with
  the reason and a `kind`: `property` for an unsupported type, `reserved-name` for `id` or `component`.
- `export-report.json` gets `policy.supportedSubset: true` and, per component, `sourceProperties`: every property the
  metadata lists, exactly once, with `sourceType` (the original type text), `requiredness` (`required`, `optional`
  or `unknown`), one `disposition` and the `reason`. The dispositions are `supported` (the property can be
  represented directly in A2UI), `mapped` (a mappings file represents it as another A2UI type; only with
  `--mappings`), `omitted` (it is deliberately left out) and `blocked` (it prevents export). A disposition describes
  the property. `status: "exported"` describes the
  component: a supported property of a component whose `status` is `blocked` is not in the catalog.

Without the option the output is unchanged, byte for byte. A property left out cannot be set through A2UI, so the
component always behaves as if it was not passed. Read the list before you rely on the export: on the Material UI
fixture the mode leaves out `sx` and `classes`, and also `value` of TextField and Switch (typed `unknown`).

```bash
node bin/storybook-a2ui.mjs inspect --storybook test/fixtures/react-uswds --supported-subset   # 4 of 75 instead of 2
```

## Mappings (opt-in, with supported-subset mode)

`--mappings <file>` names a small reviewed JSON file that makes two kinds of choice the exporter will not make alone:

```json
{ "version": 1, "components": {
  "Typography": { "children": { "map": "text" } },
  "Chip": { "label": { "map": "text" },
            "children": { "map": "omit", "reason": "The source types it as null; Chip takes its content through label." } } } }
```

- `"map": "text"` exports content as an A2UI text property (the official `DynamicString`) under its own name and with
  the source requiredness. It is accepted only where the metadata types the content as accepting a string
  (`ReactNode`).
- `"map": "omit"` leaves out a property the metadata marks `required: false`, with a mandatory reason. It never hides
  an error in the source metadata (an invalid or unverified default, for example), and it may name an event only
  together with `--unmapped-events omit`.

Every entry is checked against the metadata; an unknown component, property or verb, or an entry the metadata does
not back, stops the run with exit code 2. The report records the file's SHA-256 (`policy.mappings`) and what each
property became. The exporter contains no library-specific logic: the file is the only place a library is named.

```bash
node bin/storybook-a2ui.mjs export --storybook test/fixtures/mui-rdt-pass --supported-subset --unmapped-events omit \
  --mappings test/fixtures/mui.mappings.json --catalog-id https://example.org/catalogs/material-ui/1 --out out
# Material UI 9.5.0: Typography, Button and Chip export (3 of 6); without the mappings file, 0 of 6
```

**`docs/MAPPINGS.md`** has the full format, every check, and what a renderer must do to use the result (resolve
bindings, pass only declared properties, never pass A2UI's `component` or `id` to the React component, treat mapped
content as plain text). No component in the catalog has an A2UI action or callback, so pressing an exported Button
sends nothing to the agent. It can still navigate: `href` is exported, and Material UI renders a Button with an
`href` as a link. That URL comes from the agent, so a renderer must treat it as untrusted.

## What a successful export does and does not claim

It claims that every property Storybook's manifest exposes was converted, or the component was blocked.
It does **not** claim the source component contract is fully represented. Storybook metadata can hide properties:
`GovBannerProps = {tld?, language?} & JSX.IntrinsicElements['section']` is 282 properties in TypeScript and 2 in the
manifest.

- `export-report.json` has, per component, `contract: { basis: "storybook-manifest", sourceContractVerified: false, inheritedAttributes: "unknown" | "present", projectedContent: "unknown" | "present" }`,
  and a top-level `notice`. Both fields say `present` only when the metadata itself shows it (a listed DOM attribute,
  a listed `children` property); `unknown` never means "none". `omittedKnown` lists only omissions the exporter could see; **an empty list is not proof
  that nothing was left out.**
- Component descriptions in the catalog say the schema lists Storybook-exposed properties only.
- `additionalProperties: false` restricts the *A2UI* surface; it does not say the component accepts nothing else.
- Projected content (React `children`, slots) can be absent from Storybook metadata, so the catalog cannot say whether a
  component accepts it; every component description says so. Hidden `children` matter most: react-uswds `Collection` (`{condensed?} & JSX.IntrinsicElements['ul']`, renders
  `{children}`) converts with one property and cannot hold content. Review container-like components before use.
- `AMBIGUOUS_COMPONENT_ID` (warning) is reported when several story files share one Storybook id (same `title`);
  the manifest then describes only one of them.

## Tests

`npm test` (47 tests, no network). Includes a reproducible end-to-end test on a real `trussworks/react-uswds`
Storybook 10.6.3 build (golden catalog in `test/golden`) and the Angular-Vite adapter regression. See
`test/fixtures/PROVENANCE.md` for exactly where each fixture came from.
