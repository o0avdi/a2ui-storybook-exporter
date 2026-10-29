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

## Compatibility

| | React (manifest v0, `react-docgen`) | Angular (`@storybook/angular-vite` manifest v1) |
|---|---|---|
| Property types | `boolean`, `string`, `number`, string-literal unions, `number \| string` | `boolean`, `string`, `number`, string-literal unions |
| Requiredness, descriptions | from docgen | from `type.required`, `argTypes.description` |
| Defaults | from docgen | booleans, numbers, enum members; plain-string defaults refused (encoding unverified) |
| Events / callbacks | **block** the component | **block** the component (outputs) |
| `children` / `ReactNode` | **block** | n/a |
| Objects, arrays, functions, other types | **block**, with the type named | **block** |

Not supported yet: `string[]` and nullable primitives (both representable in A2UI v1.0), Vue, Web Components,
other manifest versions, complete Windows verification (one tester has run the baseline there; see `docs/TEAM_TESTING.md`). Event mapping is strict by default; `--unmapped-events omit` exports
the properties and records each event as not exported in the report and the component description.

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
