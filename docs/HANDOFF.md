# Handoff for a fresh Claude Code session

Goal: a simple, professional, manifest-first Storybook -> A2UI v1.0 exporter that needs minimal developer input
and never misrepresents component behavior. Sponsor meeting: Friday 2026-10-30. Owner: Omar Avdic (teammates Audrey, Matangi).

## Where things are (all local; nothing pushed, no remote exists)

| | Location | Commit |
|---|---|---|
| Standalone project (this repo) | `/Users/oavdi/repos/bacs496/a2ui-storybook-exporter`, branch `main` | `git log -1` (first commit `1c40a3f`, this file added after it) |
| Prototype checkpoint | `/Users/oavdi/repos/bacs496/capstone-catalogs-manifest-proto`, branch `agent/manifest-first-prototype`, `catalogs/material/experimental/manifest-export/` | `5680f3f` (parent `6ea2362` = `agent/friday-integration`) |
| Legacy capstone exporter | `/Users/oavdi/repos/bacs496/capstone-catalogs` (+ sibling worktrees) | do not modify; 210 tests pass at `6ea2362` and `5680f3f` |
| Real react-uswds build and clone | `~/a2ui-pilots/react-uswds/{src,sb-out}` (pinned `trussworks/react-uswds` @ `0c6fab64c104dd04b0edcacb9d3c949c27abe013`) | |

Rules inherited from the capstone `AGENTS.md`: do not push, merge, publish or create a remote/public repository without
Omar's explicit approval; no component-specific schemas; never silently drop unsupported fields; do not change or weaken
the pinned A2UI validation; record real test results. If a third-party install is blocked by the environment, do not bypass
it: give Omar the exact pinned commands.

## Install and run (Node 24; on this Mac `eval "$(fnm env)"; fnm exec --using=24 -- <cmd>`)

```bash
cd /Users/oavdi/repos/bacs496/a2ui-storybook-exporter
npm ci --ignore-scripts --no-audit --no-fund      # installs ajv 8.20.0 only
npm test                                          # 29 tests, no network
node bin/storybook-a2ui.mjs inspect --storybook test/fixtures/react-uswds
node bin/storybook-a2ui.mjs export --storybook test/fixtures/react-uswds --components GovBanner \
  --catalog-id https://example.org/catalogs/react-uswds/govbanner --out /tmp/govbanner   # must match test/golden
```

Verified from a fresh `git clone` outside the capstone tree: `npm ci`, 26/26 tests, no symlinks, every import is inside
the repo except `ajv`, CLI output byte-identical to the golden file.

## Module inventory

| File | Origin | Lines |
|---|---|---|
| `bin/storybook-a2ui.mjs`, `src/export.mjs`, `src/contract.mjs`, `src/storybook-build.mjs`, `src/adapters/*` | new prototype code | ~480 |
| `src/a2ui/catalog.mjs` | `scripts/a2ui/catalog-v1.mjs` minus `generateCatalogV1` and the `metadata.mjs` import | 717 |
| `src/a2ui/validate.mjs` | `scripts/a2ui/validate-catalog-v1.mjs` lines up to the runtime-mapping checks, plus `validateV1Export` (from `integration-v1.mjs`) | ~430 |
| `src/a2ui/react-manifest.mjs` | `scripts/a2ui/react-manifest.mjs` minus the demo helpers | 670 |
| `spec/v1_0/` | pinned official A2UI v1.0 schemas (commit `059b8d34874f96c0395dbfe23e6cc8b41cdb0f87`), unchanged | 96 KB |

## Successful external export

react-uswds `GovBanner`, from a real Storybook 10.6.3 (react-vite, react-docgen) build, exported in the default policy with
no omission flag and no handwritten schema: `language` enum english|spanish default english, `tld` enum .gov|.mil default
.gov; `catalogId` = `$id` = `https://example.org/catalogs/react-uswds/govbanner`; official A2UI v1.0 validation passes;
properties match `GovBanner.tsx` (checked with the TypeScript parser, independent of the manifest).
Also exported by the same run: `Collection` (see limitations). 73 of 75 components are blocked (children, callbacks, object props).
Earlier: Chromatic `Button` exports as properties-only with `--unmapped-events omit` (`onClick` recorded as not exported).

## Known limitations (read before claiming anything)

1. **Source contract is not verified.** Storybook's manifest hides inherited props: `GovBannerProps` is 282 properties in
   TypeScript, 2 in the manifest. Reports say `sourceContractVerified: false`, `inheritedAttributes: "unknown"`, and
   `omittedKnown: []` is not a completeness claim. Do not describe exports as "strict" or "complete".
2. **Hidden `children`.** react-uswds `Collection` exports with only `condensed` yet renders `{children}`; the catalog
   cannot place content in it. A manifest cannot reveal this; consider an explicit container warning heuristic or an
   audited-sidecar mechanism, not a source parser.
3. ~~Legacy component-name branches in `src/a2ui/catalog.mjs`~~ Removed on branch `release-readiness` (no component is
   treated specially by name; all fixture exports are byte-identical to before). The generator still accepts
   caller-supplied `reviewedPolicies` / `componentInstructions`, which the CLI never passes.
4. Component id ambiguity (same story `title` in two files) is reported as a warning, not blocked.
5. Angular adapter is verified on real `@storybook/angular-vite` 10.6.5 output, but both components were self-authored; no
   external Angular library has been tested. Plain-string defaults are refused (encoding unverified).
6. Not implemented: `string[]`, nullable primitives (both representable in A2UI v1.0, see capstone branch
   `agent/external-pilot-plan`), Vue/Web Components, other manifest versions, Windows verification.
7. The React manifest fixtures have `definedInFile` paths normalized (documented in `test/fixtures/PROVENANCE.md`).
8. Catalog IDs in examples use `example.org`; real use needs a stable URI from the user.

## First standalone tasks (in order)

1. ~~Remove the legacy component-name branches~~ and 2. ~~error clearly when `manifests/components.json` is missing~~: done on `release-readiness`.
3. Add `string[]` and nullable primitives using the capstone assessment, only if an external run shows they block real components.
4. Run one more external library (candidate: `gravity-ui/uikit`, or an Angular library) and record the result like react-uswds.
5. License: `LICENSE` (Apache-2.0) and `THIRD_PARTY_NOTICES.md` are prepared, but the copyright holder and any
   university/sponsor/teammate permission are unconfirmed. Package name `storybook-a2ui` returned 404 on the npm
   registry on 2026-10-28 (not a reservation). Verify on Windows; only then discuss a remote repository with Omar.
6. Known issue: `--unmapped-events omit` on the full react-uswds build aborts (exit 2) because `TimePicker` has a property
   named `id`, which A2UI reserves for envelopes. It should block that one component instead of failing the whole run.

## Future enhancement, NOT implemented: AI-assisted event mapping

For unresolved events/callbacks (the main reason components are blocked), an LLM could read source and docs evidence and
*propose* an A2UI action mapping. A developer approves it explicitly; the accepted mapping is saved as a reviewed sidecar
file that the exporter reads, so exports stay deterministic and never call a model. It must never add or alter property
schemas. Strict behavior (events block) stays the default; the acceptance path needs no LLM or API key.
