# Friday demo: Storybook -> A2UI catalog

Run everything from the repository root after `npm ci`. The data is a committed, real `storybook build` of
[`trussworks/react-uswds`](https://github.com/trussworks/react-uswds) (75 components); no network or Storybook install is needed.
Run the steps in order in one shell session (`$F` and `$OUT` carry over). Every command below was run as written (see "Last verified").

## 1. Inspect: what can be exported, and why not (writes nothing)

```bash
F=test/fixtures/react-uswds
node bin/storybook-a2ui.mjs inspect --storybook $F | grep -E "^build|^OK"
node bin/storybook-a2ui.mjs inspect --storybook $F | grep -c "^BLOCKED"
node bin/storybook-a2ui.mjs inspect --storybook $F | grep -A2 "^BLOCKED Form "
```

Expect: 2 components `OK` (`GovBanner`, `Collection`), 73 `BLOCKED`. `Form` is blocked with a named reason
(`children` is projected content, `onSubmit` is an event) because there is no reviewed A2UI mapping for either.
Blocking is the point: the tool refuses to export something it would have to guess about.

## 2. Export GovBanner

```bash
OUT=$(mktemp -d)
node bin/storybook-a2ui.mjs export --storybook $F --components GovBanner \
  --catalog-id https://example.org/catalogs/react-uswds/govbanner --out "$OUT"
```

It validates the catalog against the pinned official A2UI v1.0 schemas *before* writing, and prints
`official A2UI v1.0 validation: PASS`. `--catalog-id` must be a stable `https` URI you own (`example.org` is a placeholder).

## 3. Show the generated catalog

```bash
cat "$OUT/catalog.json"
diff "$OUT/catalog.json" test/golden/govbanner.catalog.json && echo "identical to the golden file"
```

Point out: `language` (`english|spanish`, default `english`) and `tld` (`.gov|.mil`, default `.gov`) are the only
properties, taken from Storybook's metadata, with `additionalProperties: false`. Nothing was written by hand.

## 4. The restricted surface and the report's limits

```bash
node -e 'const r=require(process.argv[1]+"/export-report.json");
  console.log(JSON.stringify(r.components.find(c=>c.name==="GovBanner").contract,null,2)); console.log("\n"+r.notice)' "$OUT"
node -e 'console.log(require(process.argv[1]+"/catalog.json").components.GovBanner.description)' "$OUT"
```

Say it plainly:
- The schema lists **what Storybook's manifest exposes**, not the full source contract. `GovBannerProps` is 282 properties in
  TypeScript (it inherits every `<section>` attribute) and 2 in the manifest (measured earlier, recorded in `docs/HANDOFF.md`).
- `sourceContractVerified: false`. `inheritedAttributes` and `projectedContent` are `"unknown"`, and **unknown never means none**:
  React `children` can be invisible to Storybook metadata. `omittedKnown: []` is not a completeness claim.
- `additionalProperties: false` restricts the *A2UI* surface; it is not a statement that the component accepts nothing else.

Optional, at full scale (shows one bad component does not sink the run):

```bash
OUT2=$(mktemp -d)
node bin/storybook-a2ui.mjs export --storybook $F --unmapped-events omit \
  --catalog-id https://example.org/catalogs/react-uswds/all --out "$OUT2" > /dev/null
node -e 'const r=require(process.argv[1]+"/export-report.json"); const ok=r.components.filter(c=>c.status==="exported");
  console.log("exported:", ok.map(c=>c.name).join(", ")); console.log("blocked:", r.components.length-ok.length)' "$OUT2"
node bin/storybook-a2ui.mjs inspect --storybook $F --unmapped-events omit | grep -A3 "^BLOCKED TimePicker"
```

With `--unmapped-events omit` the properties of callback-bearing components export and each event is recorded as *not exported*:
4 components export, 71 stay blocked. `TimePicker` is blocked because it has a property named `id`, which A2UI v1.0 reserves for the
wire envelope; the exporter reports that instead of renaming it. Selecting it explicitly (`--components TimePicker`) fails with
exit code 1 and writes nothing.

## 5. What the standalone CLI does and does not provide

Does:
- Reads a Storybook build's own `index.json` and `manifests/components.json` (React `react-docgen`, or Angular-Vite). Needs Storybook >= 10.6 with `features.componentsManifest: true`.
- Produces a validated A2UI v1.0 `catalog.json` plus `export-report.json`; deterministic, no network, no model calls, one dependency (`ajv`).
- Blocks or reports whatever it cannot represent; never drops, renames or invents a property or event mapping.

Does not:
- Parse project source, verify the source contract, or see inherited props and `children` that Storybook metadata hides.
- Render components or provide an A2UI renderer/runtime; it produces catalog JSON only.
- Map events/callbacks to A2UI actions (blocked by default). AI-assisted, human-approved mapping is a planned enhancement, not built.
- Support Vue/Web Components, `string[]`/nullable props, or other manifest versions yet. Targets A2UI v1.0 only.
- Exist on npm: the package is private and local; the license (Apache-2.0) is prepared but the copyright holder is unconfirmed.

## What to say to Alan (30 seconds)

"Storybook already describes every component's props, types, defaults and stories. Since 10.6 it writes that as a machine-readable
manifest. This tool reads that manifest, not the source code, and turns each component into an A2UI v1.0 catalog entry,
then validates the result against the official schemas. The design rule is that it never guesses: if a prop type or an
event has no faithful A2UI representation, the component is blocked with a named reason, and everything it can't see
(inherited attributes, children) is labelled `unknown` in the report. On a real 75-component library it converts 2 under
the strict default and 4 with events set aside, and I can show exactly why each of the others is blocked. The next step is
letting a developer review and approve event mappings, so more components unblock without loosening that rule."

## Last verified

All commands above were run on the `release-readiness` branch with Node 24; `npm test` passes. See `docs/HANDOFF.md` for the
commit and test counts.
