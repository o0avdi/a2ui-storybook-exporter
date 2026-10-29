# Handoff for a fresh Claude Code session

Goal: a simple, professional, manifest-first Storybook -> A2UI v1.0 exporter that needs minimal developer input
and never misrepresents component behavior. Sponsor meeting: Friday 2026-10-30. Owner: Omar Avdic (teammates Audrey, Matangi).

## Where things are (all local; nothing pushed, no remote exists)

| | Location | Commit |
|---|---|---|
| Standalone project (this repo) | `/Users/oavdi/repos/bacs496/a2ui-storybook-exporter`, branch **`release-readiness`** (`main` is still `dc040ee`; not merged) | `git log main..release-readiness` (below) |
| Prototype checkpoint | `/Users/oavdi/repos/bacs496/capstone-catalogs-manifest-proto`, branch `agent/manifest-first-prototype`, `catalogs/material/experimental/manifest-export/` | `5680f3f` (parent `6ea2362` = `agent/friday-integration`) |
| Legacy capstone exporter | `/Users/oavdi/repos/bacs496/capstone-catalogs` (+ sibling worktrees) | do not modify; 210 tests pass at `6ea2362` and `5680f3f` |
| Real react-uswds build and clone | `~/a2ui-pilots/react-uswds/{src,sb-out}` (pinned `trussworks/react-uswds` @ `0c6fab64c104dd04b0edcacb9d3c949c27abe013`) | |

Rules inherited from the capstone `AGENTS.md`: do not push, merge, publish or create a remote/public repository without
Omar's explicit approval; no component-specific schemas; never silently drop unsupported fields; do not change or weaken
the pinned A2UI validation; record real test results. If a third-party install is blocked by the environment, do not bypass
it: give Omar the exact pinned commands.

## State of branch `release-readiness` (2026-10-28, local only; nothing pushed, merged or published)

| Commit | What |
|---|---|
| `ab8588f` | Checkpoint: legacy component logic removed, CLI help/errors, missing-manifest error, README quick start, Apache-2.0 LICENSE + notices, `files` allowlist (still `private: true`) |
| `2af0df1` | Components using A2UI-reserved names (property `id`/`component`, component `Surface`, invalid identifiers) are blocked with `A2UI_RESERVED_NAME` instead of aborting the export |
| `f3963ea` | Scope note and report say projected content (React children) may be invisible; `contract.projectedContent` is `present` only on evidence, else `unknown`; golden catalog updated (one description sentence) |
| `2bd33ea` | `resolveRef` rejects references that reach outside the build through a symlink (reproduced first) |
| `c119b4d` | CLI no longer truncates piped output (`process.exit()` cut `inspect | head` at 64 KB) |
| (docs commit) | `docs/DEMO_FRIDAY.md`, this file, README test count |
| `bff068e` (team-testing docs, 2026-10-29) | `docs/TEAM_TESTING.md`, `docs/TEAM_TEST_RESULTS_TEMPLATE.md`, design notes below, README pointer. Docs only; no code change |
| `083b4f7` (names fix, 2026-10-29) | Names that exist on `Object.prototype` can no longer vanish or be misread: `__proto__` as a property and any `Object.prototype` member as a component name are blocked per component with `UNSAFE_NAME` instead of being dropped or aborting the export; `constructor`, `toString` etc. as property names export as real properties. 10 regression tests; GovBanner golden unchanged |
| (Windows test fix, 2026-10-29) | Test-only: the symlink-containment test creates directory junctions (`'junction'`; ignored on POSIX) so it runs without the Windows symlink privilege. Exporter, golden catalog and demo output unchanged; mutation check: with the real-path check disabled the test fails |

Verified on this branch with real commands: `npm test` 47/47 (after the names fix below; 37/37 before it); GovBanner default export byte-identical to the golden file;
full react-uswds export with `--unmapped-events omit` exits 0 with 4 exported (`GovBanner`, `Collection`, `NavDropDownButton`,
`Pagination`) and 71 blocked, `TimePicker` blocked with `A2UI_RESERVED_NAME`; `--components TimePicker` exits 1 and writes nothing;
Angular-Vite fixture exports (and its tests pass); `npm pack` (19 files, no tests/fixtures/docs) installed into a fresh project and
run with the exporter repository unreadable (macOS `sandbox-exec`): GovBanner, full omit, selected TimePicker, Angular, mixed
React+Angular all behave as above, and an independent ajv script against upstream schemas at the pinned commit passes.
Also verified on 2026-10-29 (macOS, Node 24.22.1): the separate-config recipe in `docs/TEAM_TESTING.md` (copy `.storybook` to
`.storybook-a2ui`, add `features.componentsManifest` and `reactDocgen`, `storybook build -c .storybook-a2ui -o <dir>`) on the
pinned react-uswds clone: build succeeds, only untracked `.storybook-a2ui/` appears in `git status`, and the exporter reads
the fresh build (2 OK, 73 BLOCKED, same as the committed fixture; `project.json` records `storybookVersion` 10.6.3).
Windows: an independent tester reported (not run by the author) that `083b4f7` installs, exports GovBanner identical to the golden catalog and passes pinned validation on Windows 11, Node v24.20.0, with `npm test` 46/47; the one failure was `EPERM` creating a directory symlink in the manifest-reference containment test, fixed in the test only (directory junction) and not yet re-run on Windows.
Not verified: the external-library PowerShell commands in `docs/TEAM_TESTING.md` (never executed), a Storybook build of anyone
else's project, a second external library.

## Install and run (Node 24; on this Mac `eval "$(fnm env)"; fnm exec --using=24 -- <cmd>`)

```bash
cd /Users/oavdi/repos/bacs496/a2ui-storybook-exporter
npm ci --ignore-scripts --no-audit --no-fund      # installs ajv 8.20.0 only
npm test                                          # 47 tests, no network
node bin/storybook-a2ui.mjs inspect --storybook test/fixtures/react-uswds
node bin/storybook-a2ui.mjs export --storybook test/fixtures/react-uswds --components GovBanner \
  --catalog-id https://example.org/catalogs/react-uswds/govbanner --out /tmp/govbanner   # must match test/golden
```

Verified from a clean copy of the files outside the capstone tree: `npm ci`, all tests, every import is inside the repo
except `ajv`, CLI output byte-identical to the golden file. Demo script: `docs/DEMO_FRIDAY.md`.
Teammate setup from a source-only ZIP (macOS and PowerShell), the baseline, external-library testing and the results
template: `docs/TEAM_TESTING.md`, `docs/TEAM_TEST_RESULTS_TEMPLATE.md`.

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
With `--unmapped-events omit`: 4 export, 71 blocked (11 of the blocked ones also carry `A2UI_RESERVED_NAME`).
Earlier: Chromatic `Button` exports as properties-only with `--unmapped-events omit` (`onClick` recorded as not exported).

## Known limitations (read before claiming anything)

1. **Source contract is not verified.** Storybook's manifest hides inherited props: `GovBannerProps` is 282 properties in
   TypeScript, 2 in the manifest. Reports say `sourceContractVerified: false`, `inheritedAttributes: "unknown"`,
   `projectedContent: "unknown"`, and `omittedKnown: []` is not a completeness claim. Do not describe exports as "strict" or "complete".
2. **Hidden `children`.** react-uswds `Collection` exports with only `condensed` yet renders `{children}`; the catalog
   cannot place content in it. This is now disclosed in every component description and in the report
   (`projectedContent: "unknown"`) but not detected. Deliberately NOT built: a regex over the manifest's story snippets that
   would raise `POSSIBLE_PROJECTED_CONTENT` (a quick check flagged 7 of 53 components without a `children` prop, all genuine
   containers). Decide later; if built it must warn, never block, and never invent a mapping.
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

## Next priorities

1. Review the branch (`git log main..release-readiness`), then decide on merging into `main`. Nothing was pushed.
2. License sign-off: `LICENSE` (Apache-2.0) and `THIRD_PARTY_NOTICES.md` are prepared, but the copyright holder and any
   university/sponsor/teammate permission are unconfirmed (the capstone repo also has commits by Eric Dong and Audrey Lundy;
   it has no LICENSE). The Chromatic fixture source is MIT (notice included). Package name `storybook-a2ui` returned 404
   on the npm registry on 2026-10-28 (not a reservation); the `storybook-` prefix may imply Storybook affiliation.
   `repository`/`author`/`bugs` fields are omitted until a remote exists.
3. Add `string[]` and nullable primitives using the capstone assessment, only if an external run shows they block real components.
4. Run one more external library (candidate: `gravity-ui/uikit`, or an Angular library) and record the result like react-uswds.
   Teammates can do this with `docs/TEAM_TESTING.md` and send back `docs/TEAM_TEST_RESULTS_TEMPLATE.md` filled in.
5. Verify on Windows; only then discuss a remote repository with Omar.
6. Optional cleanup: the generator still accepts caller-supplied `reviewedPolicies`/`componentInstructions` that the CLI never
   passes; `spec/v1_0` ships three schema files the validator never loads (~60 KB, kept so PROVENANCE.md stays accurate).
7. Not covered by the symlink fix: the top-level `index.json` / `manifests/components.json` themselves (the files the user
   pointed at) are read as given, even if they are symlinks.

## Future enhancement, NOT implemented: AI-assisted event mapping

For unresolved events/callbacks (the main reason components are blocked), an LLM could read source and docs evidence and
*propose* an A2UI action mapping. A developer approves it explicitly; the accepted mapping is saved as a reviewed sidecar
file that the exporter reads, so exports stay deterministic and never call a model. It must never add or alter property
schemas. Strict behavior (events block) stays the default; the acceptance path needs no LLM or API key.

## Design notes, 2026-10-29: advice only, NOTHING below is implemented

### A. Reviewed event mapping (source event -> A2UI action)

Where it fits: `makeCatalogV1` already turns a component's `events` map (`{eventName: propertyName}`) into an optional property
typed `$ref common_types.json#/$defs/Action`, but `toGeneratorComponent` in `src/contract.mjs` hard-codes `events: {}` and
`evaluate` blocks or omits every event. The smallest change is therefore one input and one code path, not a redesign.

Minimal viable version: a JSON file the developer commits next to their library, passed as `--mappings a2ui-mappings.json`.

```json
{ "version": 1, "mappings": [
  { "component": "Button", "event": "onClick", "sourceSignature": "() => void",
    "action": "onPress", "status": "approved", "approvedBy": "name", "approvedOn": "2026-11-02" } ] }
```

- An approved entry adds one optional `onPress: Action` property to `Button` and moves `onClick` from blocked/omitted to
  "mapped" in the report. It adds no other schema and never alters a property schema.
- Hard errors, never silent: component or event not in the manifest; `sourceSignature` differs from the manifest's current
  event type (`STALE_MAPPING`, so an approval cannot carry over to a changed callback); action name reserved (`id`, `component`),
  invalid, duplicated or colliding with an existing property; entries without `status: approved` are ignored and listed.
- The report records the mapping file's sha256 and every mapped event. Without `--mappings` the output stays byte-identical.
- The exporter still does not write the handler. The developer's renderer calls its dispatcher when the source event fires
  (`onClick={() => dispatch(instance.onPress)}`). The A2UI `Action` carries `event.name`, optional `userMessage` and `context`,
  which the agent and renderer fill in at runtime. Callbacks whose argument matters (`onChange(value)`) are out of scope for v1
  of this file and stay blocked; they need a data-binding decision (not verified how v1.0 renderers write values back).
- Tests to write first: golden with one mapping; stale signature; unknown event; name collision; reserved name; unapproved
  entry ignored; two runs byte-identical; no flag means the existing golden unchanged.

GenAI later: a separate `propose` step, outside `export`, reads the blocked-by-event list plus whatever source and story
snippets the developer chooses to share (sending proprietary source to a model is their call) and writes the same file with
`status: "proposed"`, a rationale and evidence (`file:line`), never `approved`. The model may only choose among events already
in the manifest and name an action property; it defines no types, and its output is validated like any other input. A
human flips entries to `approved` in a normal code review (or via a `review` command that shows each proposal next to the
signature and records approver and date). `export` never calls a model and applies only approved entries, so builds stay
deterministic and key-free.

### B. Supporting A2UI v0.9.1 and v1.0 with a CLI flag

Feasible, but it is two generators and two validators behind one front end, not a flag that changes strings. Everything up
to the policy (`storybook-build`, adapters, `contract`, `evaluate`, the report) is version-independent. The version-specific
parts are `src/a2ui/catalog.mjs` (`makeCatalogV1`, `formatFieldPropertyV1`), `src/a2ui/validate.mjs`, `spec/v1_0/`, and the
hard-coded strings (`protocolVersion: '1.0'`, "official A2UI v1.0 validation: PASS", the `@path` sentence in `INSTRUCTIONS`).

Differences that matter, v1.0 as implemented here versus the v0.9 catalog the legacy capstone exporter emits
(`capstone-catalogs/.../scripts/a2ui/metadata.mjs` `makeCatalog`, `universal-json.mjs`):

| Area | v1.0 (this repo) | v0.9 (legacy capstone output) |
|---|---|---|
| Component schema | flat `type: object`, `properties`, `required`, `additionalProperties: false` | `allOf [ComponentCommon, CatalogComponentCommon, {...}]` plus `unevaluatedProperties: false` |
| `id` | rejected as a component property (envelope-only); `allOf` over `ComponentCommon` is rejected | required by `ComponentCommon` on the component |
| Root `$defs` | only `anyComponent` (with `discriminator: component`) and `anyFunction`; anything else is an error | extra local `common_types_*` / `catalog_*` helpers; no discriminator |
| Root fields | the 10 normative fields; `protocolVersion: "1.0"`, `instructions`, `$id` equals `catalogId` | no `protocolVersion`, no `instructions` |
| Property typing | `$ref common_types.json#/$defs/DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`; unions as `oneOf` with `DataBinding` and `FunctionCall` | `anyOf [plain schema, local DataBinding]` |
| Binding spelling | `{"@path": "/x"}` | `{"path": "/x"}` |
| Action | `$ref common_types.json#/$defs/Action` (agent event or function call) | local `{event: {name, context}}` |
| Schema validation | Ajv 2020 over the pinned official `catalog_definition.json` + `common_types.json`, reference checks, structural rules, per-component compile | no pinned official v0.9 schemas exist in either repository (legacy `specification/` holds only `v1_0`) |

Caveat: the right-hand column is what the team's own v0.9 code emitted, not the official v0.9.1 schemas, which were not
available offline. Item 1 below must come first; this table should then be redone against the real v0.9.1 files.

Smallest testable approach:
1. Pin the official v0.9.1 schemas at an upstream commit into `spec/v0_9_1/` with a `PROVENANCE.md`, and write an
   independent ajv script (like the one used for v1.0) before writing any generator code.
2. Add `--protocol 1.0|0.9.1` (default `1.0`) and a small table `{ make, validate }` per version. Copy-and-diverge the
   wrapper and field formatter into `src/a2ui/v0_9_1/`; do not add `if (version)` branches to the v1.0 generator.
   Generate from the normalized contract, never by rewriting a finished v1.0 catalog.
3. Same policy and same supported types for both versions at first. A component blocked under 1.0 is blocked under 0.9.1.
4. Tests: existing golden unchanged (byte-identical default); new 0.9.1 golden for GovBanner; a catalog of one version
   must fail the other version's validator; both versions export the same components and property names; the report and
   CLI line name the chosen version.
Do it only if a v0.9.1 consumer exists; otherwise it doubles the validation surface for no user.

### C. What stays the developer's responsibility

The exporter describes the surface Storybook exposes; it should not decide or generate any of these:
- The renderer: the component implementations behind each catalog entry, the dispatcher that turns an `Action` into the
  source callback, and the data model and bindings behind dynamic values.
- Behavior: what each event does (submit, navigation, validation, state, permissions, analytics, side effects).
- Projected content: how children and slots nest, and whether a container may hold other components (`allowedParents`,
  `allowedChildren` exist in the generator but the exporter never sets them).
- Which components and properties an agent may use at all (`--components` is an allowlist), and which props are unsafe to
  hand to a model (HTML injection, URLs, file paths).
- The catalog's identity and lifecycle: the stable `catalogId` URI they own, versioning, deprecation, `functions` the agent
  may call, and agent-facing usage instructions beyond the generated sentence.
- Verifying the source contract that Storybook metadata hides (inherited attributes, `children`), and reviewing defaults,
  requiredness and descriptions, which come from docgen.
- Validating the renderer against the catalog and the right to publish the catalog.
