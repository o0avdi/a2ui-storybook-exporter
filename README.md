# storybook-a2ui

Turn a Storybook build's own component manifest into a validated [A2UI](https://github.com/a2ui-project/a2ui) v1.0
`catalog.json`, with a plain-language compatibility report. No project source is parsed, no component-specific
schema is written by hand, and anything the exporter cannot represent is reported instead of dropped.

Status: **0.1 prototype, local only, not published.** Node >= 22. One dependency (`ajv`).

## Quick start

```bash
npm ci

# 1. Build your Storybook with the components manifest on (Storybook >= 10.6):
#    .storybook/main.ts  ->  features: { componentsManifest: true }, typescript: { reactDocgen: 'react-docgen' }
npx storybook build -o storybook-static

# 2. What can be exported, and why not (writes nothing)
npx storybook-a2ui inspect --storybook ./storybook-static

# 3. Export (the catalog is validated against the pinned official A2UI v1.0 schemas before it is written)
npx storybook-a2ui export --storybook ./storybook-static \
  --catalog-id https://example.org/catalogs/my-lib/1 --out ./a2ui-catalog [--components A,B]
```

Output: `catalog.json` and `export-report.json`. Repeat `--storybook` to combine React and Angular builds.
Try it without a Storybook of your own: `npx storybook-a2ui inspect --storybook test/fixtures/react-uswds`.

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
other manifest versions, Windows verification. Event mapping is strict by default; `--unmapped-events omit` exports
the properties and records each event as not exported in the report and the component description.

## What a successful export does and does not claim

It claims that every property Storybook's manifest exposes was converted, or the component was blocked.
It does **not** claim the source component contract is fully represented. Storybook metadata can hide properties:
`GovBannerProps = {tld?, language?} & JSX.IntrinsicElements['section']` is 282 properties in TypeScript and 2 in the
manifest.

- `export-report.json` has, per component, `contract: { basis: "storybook-manifest", sourceContractVerified: false, inheritedAttributes: "unknown" | "present" }`,
  and a top-level `notice`. `omittedKnown` lists only omissions the exporter could see; **an empty list is not proof
  that nothing was left out.**
- Component descriptions in the catalog say the schema lists Storybook-exposed properties only.
- `additionalProperties: false` restricts the *A2UI* surface; it does not say the component accepts nothing else.
- Hidden `children` matter most: react-uswds `Collection` (`{condensed?} & JSX.IntrinsicElements['ul']`, renders
  `{children}`) converts with one property and cannot hold content. Review container-like components before use.
- `AMBIGUOUS_COMPONENT_ID` (warning) is reported when several story files share one Storybook id (same `title`);
  the manifest then describes only one of them.

## Tests

`npm test` (26 tests, no network). Includes a reproducible end-to-end test on a real `trussworks/react-uswds`
Storybook 10.6.3 build (golden catalog in `test/golden`) and the Angular-Vite adapter regression. See
`test/fixtures/PROVENANCE.md` for exactly where each fixture came from.
