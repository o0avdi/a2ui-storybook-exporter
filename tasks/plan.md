# Implementation plan: standalone Storybook-to-A2UI exporter

Approved 2026-11-09. Baseline commit `4fc9d40` on `feat/exporter-hardening`. The task checklist is `tasks/todo.md`.

## Overview

The deliverable is the exporter itself: a standalone, general-purpose CLI that reads a Storybook build, writes a
validated A2UI v1.0 catalog for the components it can represent faithfully, and explains every component it cannot.
It does not depend on the showcase demo application, on any component library, renderer or agent. The demo team
consumes `catalog.json` through the documented output contract (task N3) like any other user.

The goal for the November 20, 2026 showcase is a reliable, honest, extensible tool with verified support for a useful
subset of real Storybook catalogs. It is not universal compatibility.

## Ownership

- **Omar with Claude:** core exporter implementation and reviews. Omar approves each task before it starts and
  reviews each commit before the next task begins.
- **Eric:** external library testing, compatibility evidence, bug reproduction. No changes under `src/` or `test/`.
- **Audrey and Matangi:** the separate A2UI demo application. Nothing in this plan depends on it.

## Working agreement

1. One task is one small commit. A failing test comes before the change.
2. Each commit comes with an explanation of the files, functions and design decisions.
3. `npm test` runs in full after every change.
4. Work stops for review after each task. No pushes or merges without explicit approval. Pushes go to
   `feat/exporter-hardening`.
5. Golden and snapshot files are never updated blindly: the diff is reviewed in the same commit.
6. Codex gives a targeted independent review of M2, M5 and M6+M8. The exact command is confirmed before each run.

## Design rules

| | Rule |
|---|---|
| D1 | `export` and `inspect` stay deterministic and offline, and need no API key. |
| D2 | Keep the architecture: adapter → normalized contract → shared policy (`evaluate` in `src/contract.mjs`) → catalog generator → validator. Adapters block only on input they cannot read faithfully. Everything else is decided by the shared policy. No rewrites. |
| D3 | Accuracy over export counts. Every exported property must be defensible against the source metadata. Limitations are reported, never hidden. |
| D4 | No new runtime dependency (`ajv` stays the only one). |
| D5 | Codes already emitted are not renamed silently. The report gains `reportVersion`. Report changes are additive. |
| D6 | Validation is never weakened. The official schemas and the exporter's own rules must both pass before anything is written. |
| D7 | Diagnostics stay minimal: useful, consistent, actionable, no extra abstractions. If M4–M8 grow more complicated than planned, stop and discuss a simpler version. |

## Decisions already made

- **Diagnostic codes:** the specific code goes in the existing `code` field (Option A).
- **Filtering:** document Storybook's `manifest` tag, keep `--components`, add a simple `--exclude`. No configuration system.
- **Rename of `src/a2ui/react-manifest.mjs`:** deferred.
- **AI-assisted descriptions, a descriptions file, wider type support:** after the showcase.
- **npm publish:** not before the showcase. Be publish-ready. The name `storybook-a2ui` was free on 2026-11-09.

## Verified findings the tasks rely on

- Baseline: 47/47 tests. react-uswds: 2 exported / 73 blocked by default, 4 / 71 with `--unmapped-events omit`.
- The validator uses `in` where it needs an own-property check (`validate.mjs:89, 120, 133, 144, 176, 367`) and so
  does the ref resolver (`storybook-build.mjs:76`). Three catalogs that should fail are accepted today: `required`
  listing `toString`, `$ref: "common_types.json#/$defs/toString"`, and `$ref: "#/components/constructor"`.
- 11 react-uswds properties are reported as `Unsupported type ''` because docgen supplied no type.
- The 12 react-uswds `MANIFEST_ENTRY_INVALID` entries are 9 missing `meta.component` and 3 docgen errors.
- The official `basic_catalog.json` (18 components) passes the official meta-schema with 0 errors. The exporter's own
  rules report 37 problems on it: 31 from the reference checks and 6 from the structural rules. The exporter's rules
  are therefore stricter than the specification, and the report must say so (M7).
- All 305 react-uswds properties carry a boolean `required`. Optional Angular inputs have no `required` key.
- All 637 react-uswds index entries carry the `manifest` tag (to be confirmed by Eric's E2 test and the Storybook docs).
- The catalog cannot express actions today: `toGeneratorComponent` sets `events: {}`.
- Packaging: `npm pack --dry-run` gives 19 files, 47 KB. `docs/` is not packaged. `"private": true` is set.
  `engines` says Node >= 22, but tests have only been run on Node 26.7.

## Tasks, in order

Sizes: XS under an hour, S about one session, M two sessions.

### Before the feature freeze (target Fri Nov 13)

| # | ID | Task | Acceptance criteria | Size | Deps |
|---|---|---|---|---|---|
| 1 | M1 | **Characterization tests** (tests only): the react-uswds report under both event policies, and the validator's result on the official `basic_catalog.json` | No `src/` change. Passes on `4fc9d40`. Later snapshot updates are reviewed diffs | S | – |
| 2 | N2 | **CI:** Node 22 and 24 on Ubuntu, Node 22 on Windows. Steps: `npm ci`, `npm test`, a clean install of the packed tarball followed by `--version` and `inspect` | Prepared and tested locally. All jobs green after an approved push of `feat/exporter-hardening` | S | M1 |
| 3 | M2 | **Own-property checks** in the validator and the ref resolver. Codex review | The 3 known-bad catalogs are rejected. A ref to `#/constructor` reports "does not resolve". M1 baselines and the catalog golden unchanged | S | M1 |
| 4 | M3 | **`MISSING_PROP_TYPE`** replaces `Unsupported type ''` | The `Tooltip.position` message says docgen supplied no type and how to fix it. The snapshot diff is exactly 11 properties. Still 2/73 and 4/71 | S | M1 |
| 5 | M4 | **Code registry and `reportVersion: 1`.** `src/diagnostics.mjs`: a frozen map from code to `blocking`, `warning` or `fatal`. Issue creation throws on an unregistered code | Unregistered-code test. Every current code registered. Catalog golden unchanged | S | M1 |
| 6 | M5 | **Specific React codes** in `code`. Codex review | react-uswds shows 9 `MISSING_META_COMPONENT` and 3 `MANIFEST_DOCGEN_ERROR` in place of the 12 `MANIFEST_ENTRY_INVALID`, and the snapshot shows only that. Angular unchanged. The other 4 React codes each tested on a modified fixture copy | S | M4 |
| 7 | M6 | **Fatal error codes** (see below). Codex review with M8 | One CLI test per code. Existing error-message tests pass unchanged. A validation failure prints a readable list. Any other error gives `INTERNAL_ERROR` | M | M4 |
| 8 | M7 | **Report summary:** `summary {components, exported, blocked, byCode}`, per-component `descriptionOrigin`, a validation label that names both the official schemas and the exporter's own rules. `valid` stays | Golden report for GovBanner with paths normalized. Existing assertions unchanged | S | M4 |
| 9 | M8 | **`--json`** for `inspect` and `export`, including fatal errors | Exit 0, 1 and 2 each print parseable JSON on stdout. A failed export still writes nothing to `--out`. Output without the flag unchanged | S | M6, M7 |
| 10 | M9 | **`--exclude A,B`**, matched by name or id like `--components`, applied after it | Unknown name gives `UNKNOWN_COMPONENT`. Excluding everything gives `USAGE_ERROR`. Help text updated | S | M6 |

### After the feature freeze (docs, tests, packaging; code freeze target Tue Nov 17)

| # | ID | Task | Acceptance criteria | Size | Deps |
|---|---|---|---|---|---|
| 11 | M10 | **`docs/DIAGNOSTICS.md`** (per code: meaning, a real example, who fixes it, how), a filtering section, a short `docs/design/SOURCES.md` | A test checks that the registry and the doc sections match exactly. Every claim cited or marked UNVERIFIED | S | M4, E2 |
| 12 | N3 | **`docs/OUTPUT.md`**, the output contract: files written, guarantees, report and `--json` shapes, exit codes, known limitations (no actions, no projected content, properties from Storybook metadata only) | Every guarantee names the test that backs it. A consumer needs no other document | S | M8 |
| 13 | N1 | **Packaged CLI works:** ship `docs/DIAGNOSTICS.md` and `docs/OUTPUT.md`, add `repository` and `bugs`, version `0.2.0`, `CHANGELOG.md` | A test asserts the packed file list (needed files present, no tests or fixtures). The CI clean-install step runs the installed CLI | S | M10, N3 |
| 14 | M11 | **Real-world integration test** on a new external fixture (see below) | See below | S–M | E1 |
| 15 | N4 | **README for external developers** (install, enable the manifest, inspect, export, troubleshoot, CLI-only statement) and **`docs/COMPATIBILITY.md`** built from recorded runs | Each support claim cites a recorded run or is marked unverified | S | E4 |

### M6: fatal error codes

A single helper creates an `Error` with a `code` property, as Node itself does (`ENOENT`). No error classes.
Twelve coarse codes: `USAGE_ERROR`, `BUILD_NOT_FOUND`, `INDEX_UNSUPPORTED`, `MANIFEST_NOT_FOUND`,
`MANIFEST_UNSUPPORTED`, `JSON_UNREADABLE`, `MANIFEST_REF_INVALID`, `UNKNOWN_COMPONENT`, `NAME_COLLISION`,
`OUTPUT_NOT_EMPTY`, `CATALOG_INVALID`, `INTERNAL_ERROR`.

The backstop checks in `src/a2ui/catalog.mjs` get no code of their own. Reaching one means the policy let something
through, which is an exporter bug, so they surface as `INTERNAL_ERROR`.

With `--json`, exit 2 prints `{"reportVersion":1,"result":"fatal","error":{"code":"…","message":"…"}}` on stdout.
Without it, stderr shows `CODE: message`. Exit codes are unchanged: 0 success, 1 blocked by policy, 2 fatal.

Not planned: a code per `throw` site, error classes, JSON on stderr, partial reports after a fatal error.

### M11: real-world integration test

The fixture is a real external library build from Eric's corpus, chosen for coverage the suite lacks
(react-docgen-typescript or an external Angular library), license and size permitting. The test runs offline through
the CLI. It has four parts, and each states what it proves:

| Part | Check | What it proves | What it does not prove |
|---|---|---|---|
| 1 | Catalog bytes equal a committed golden file | Output is stable and deterministic | That the output is correct |
| 2 | Every exported property, type, default and requiredness is re-derived from the manifest's docgen by test code that does not call the exporter | The exporter translates Storybook's metadata faithfully | That the metadata matches the component |
| 3 | For at least one exported component, expectations transcribed by hand from the component's source or TypeScript interface at the pinned commit (file, commit and lines cited) | The catalog matches the real component for that component, and anything the metadata hides is listed as a limitation | Anything about components not transcribed |
| 4 | A valid instance passes `createComponentInstanceValidator` and an instance with an unknown property fails | The catalog constrains what an agent may send | That a renderer displays it |

### Drop order if the pace slips

Correctness and meaningful tests come before finishing every task. If we fall behind, Claude recommends specific
cuts instead of rushing. The default order:

1. `descriptionOrigin` moves out of M7.
2. M9 becomes documentation only (manifest tag and `--components`).
3. `SOURCES.md` shrinks to the claims the docs make.
4. `COMPATIBILITY.md` becomes a short table in the README.

Never dropped: M1, M2, M6, M7, M8, M11.

## Compatibility evidence (Eric, starts immediately)

| ID | Task | Output |
|---|---|---|
| E0 | Install the tool as an outsider would: from the packed tarball, following the README only | A list of every point of friction |
| E1 | Corpus runs, in this order: React with react-docgen-typescript; an external Angular library on `@storybook/angular-vite` 10.6 or later; a second React design system; a React library with difficult patterns (compound components, `forwardRef`, generics, polymorphic `as`, PropTypes) | Per run: exporter commit, library commit, Storybook version, builder, docgen tool, commands |
| E2 | Manifest-tag test: add `tags: ['!manifest']` to one component's stories, rebuild, compare | Component counts before and after in `components.json` and `index.json`; Storybook version; docs link |
| E3 | Bug reports: each crash or wrong export reduced to the single manifest entry, the command, expected and actual | Becomes a failing test before any fix |
| E4 | Final run of every library at the freeze candidate with `--json`; every exported component checked against its source | `docs/evaluation/<library>.md`, absolute paths removed |

Rules for the evidence:

- These are libraries as their authors wrote them, not components shaped to pass the exporter.
- Runs before M8 are qualitative. Final numbers come from E4.
- Targets: zero crashes on a valid build; zero exported properties that contradict the source. Exports that miss
  something the source accepts are counted and disclosed. Blocked components are counted by cause and by who can fix
  them (developer configuration, component source, exporter, needs a reviewed mapping, not representable).
- **Fallback:** if no usable external build has arrived by Thu Nov 12, Omar and Claude build at least one additional
  external library themselves, so M11 and the compatibility statement never rest on react-uswds alone.
- If no external Angular library can be built with `@storybook/angular-vite`, that is recorded as a support boundary.

## Freeze rules

- **Feature freeze, target Fri Nov 13:** no new options, codes, report fields or type support afterward. Bug fixes
  found by the corpus, tests, docs, fixtures and packaging are still allowed.
- **Code freeze, target Tue Nov 17:** the freeze commit is recorded. After it, only showstopper fixes, each approved
  by Omar and followed by a full `npm test`.
- Both dates are targets. A correct, tested smaller scope is preferred to a complete rushed one.

## Should (only if the Must tasks finish early), in order

1. `UNKNOWN_REQUIREDNESS` for React when `required` is not a boolean. Promoted to Must if any corpus run shows one.
2. `ReactNode[]` classified as content instead of an unsupported type.
3. Per-property description coverage in the report.
4. A single string literal becomes a one-value enum (`Button.size` in react-uswds).
5. Separate pass/fail in the report for the official schemas and the exporter's own rules.

## After the showcase

React v0 manifests whose entries are all errors; a reviewed descriptions file and the AI-description design note;
wider type support chosen from corpus evidence; a reviewed event mapping (`Action` properties); the
`react-manifest.mjs` rename; npm publish if Omar and Alan decide on it.

## Risks

| Risk | Effect | Response |
|---|---|---|
| Review time: about two commits a day | Tasks slip past the freeze | Small commits with explanations; the drop order above |
| No external fixture arrives in time | M11 and the compatibility statement lack evidence | Fallback date Thu Nov 12 |
| External Angular library cannot be built | No external Angular evidence | Document it as a support boundary |
| Most components in real libraries are blocked | Low export counts | Report the causes accurately; do not loosen the policy to raise counts |
| M4–M8 grow in complexity | Diagnostics become an abstraction project | Stop and simplify (D7) |
| Node 22 or Windows behaves differently | Hidden portability bugs | N2 runs second, so every later commit is checked |

## Open questions

- Who owns an eventual npm package, and is the name `storybook-a2ui` acceptable to the sponsor?
- What does Storybook's documentation say about the `manifest` tag (pending E2 and M10)?
