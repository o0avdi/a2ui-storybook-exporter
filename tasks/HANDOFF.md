# Handoff: Storybook-to-A2UI exporter

Written 2026-11-09 for a fresh Claude Code session. Read this file, then `tasks/plan.md` (roadmap, acceptance
criteria, verified findings) and `tasks/todo.md` (checklist). `docs/HANDOFF.md` is an older handoff from before this
plan and is partly out of date.

## State of the repository (verified 2026-11-10)

- Branch: `feat/exporter-hardening`, tracking `origin/feat/exporter-hardening`.
- Commits on top of `4fc9d40` (the baseline the plan refers to), all pushed to `origin/feat/exporter-hardening`:
  - `c2b4b14` Add the exporter-only roadmap and task list
  - `010aa61` Pin current report and validator behavior with characterization tests (task M1)
  - `67543e4` Add a session handoff and tick M1 in the task list
  - `3e4758f` Add CI for Node 22 and 24 on Ubuntu and Node 22 on Windows (task N2)
- **Nothing is merged into `main`.** `origin/main` is at `142dd7b`, `origin/docs/share-floorplan` at `4fc9d40`.
- Tests at `3e4758f`: `npm test` gives 50 passed, 0 failed (47 in `test/exporter.test.mjs`, 3 in
  `test/characterization.test.mjs`). With M2 it is 55, with the Material UI fixtures (C0b) 59, with C1 70.
- CI: `.github/workflows/ci.yml` runs on every push. At `3e4758f` all three jobs passed (Node 22 and 24 on Ubuntu,
  Node 22 on Windows; GitHub Actions run 42757388584).
- Remote: `https://github.com/o0avdi/a2ui-storybook-exporter.git`.

## Objective

A standalone, general-purpose CLI that reads a Storybook build, writes a validated A2UI v1.0 `catalog.json` for the
components it can represent faithfully, and explains every component it cannot. University capstone sponsored by
Google Cloud (contact: Alan). Deadline: showcase on **Fri Nov 20, 2026**. Feature freeze target Sun Nov 15 (moved
from Fri Nov 13 on 2026-11-10), code freeze target Tue Nov 17. Both are targets: a correct, tested smaller scope
beats a complete rushed one.

**Priority since 2026-11-10: real third-party React libraries, with Material UI as the acceptance target** (tasks
C0 to C2 in `tasks/todo.md`). They come before M3 to M9. Material UI is a test target only: the exporter contains no
Material UI-specific logic and does not depend on it.

**Scope is exporter-only.** The exporter must not depend on the showcase demo, on Material UI, or on any renderer or
agent. The demo team consumes `catalog.json` through a documented output contract (task N3) like any other user.
Do not add demo tasks (wrapper components, component registration, agent interactions, UI checks) to this plan.

## People

- **Omar:** owns the exporter; works with Claude on implementation; approves and reviews every change.
- **Eric:** external library testing, compatibility evidence, bug reproduction. No changes under `src/` or `test/`.
- **Audrey and Matangi:** the separate demo application.

## How Omar wants to work (binding)

1. **Omar must understand every meaningful change.** Explain the files, functions and design decisions, not only
   the result. Claude acts as senior engineer, mentor and critical reviewer.
2. **Approval gates.** No task starts without Omar's approval. Stop after each task and wait for review.
3. **Show before committing.** Present the change and the test results first; commit after Omar's go-ahead.
4. **No push or merge without explicit approval**, each time. No installs without approval, and no changes to
   global tools.
5. **Test first, small commits.** One task is one commit. A failing test comes before the change. Run the full
   suite after every change. Report results exactly as they are.
6. **Snapshots and golden files are never updated blindly.** The diff is read and committed with its cause.
7. **Sources of truth:** official A2UI and Storybook documentation, real input manifests, existing behavior,
   reproducible tests. Mark anything else UNVERIFIED.
8. **Never** silently omit fields, invent component behavior, fabricate test results, or weaken validation.
9. **Prefer the simpler solution.** Sponsor suggestions are weighed, not adopted automatically. If the diagnostics
   work (M4–M8) grows more complicated than planned, stop and discuss a simpler version.
10. If the pace slips, recommend specific scope cuts (drop order in `tasks/plan.md`) instead of rushing.

## Architecture (keep it; no rewrites)

Adapter → normalized contract → shared policy → catalog generator → validator.

| Step | File |
|---|---|
| CLI, exit codes 0 / 1 / 2 | `bin/storybook-a2ui.mjs` |
| Orchestration, selection, report | `src/export.mjs` (`exportCatalog`) |
| Reading `index.json`, the manifest, `$ref` resolution | `src/storybook-build.mjs` |
| Adapters | `src/adapters/react-v0.mjs` (uses the classifier in `src/a2ui/react-manifest.mjs`), `src/adapters/angular-vite-v1.mjs` |
| Policy | `src/contract.mjs` (`evaluate`, `toGeneratorComponent`) |
| Catalog generation | `src/a2ui/catalog.mjs` (`makeCatalogV1`) |
| Validation against pinned schemas in `spec/v1_0` | `src/a2ui/validate.mjs` (`validateV1Export`) |

Adapters describe and block only on input they cannot read faithfully; the shared policy decides everything else.
Output is deterministic and offline. `ajv` is the only runtime dependency and stays the only one.

## Decisions made in conversation

- Diagnostic codes: the specific code goes in the existing `code` field; the report gains `reportVersion`.
- `--json` covers fatal errors too, with about twelve coarse codes and no error classes (design in the plan).
- Filtering: document Storybook's `manifest` tag, keep `--components`, add a simple `--exclude`.
- Deferred until after the showcase: renaming `react-manifest.mjs`, AI-assisted descriptions, a descriptions file,
  wider type support, a reviewed event mapping, npm publish (name `storybook-a2ui` was free on 2026-11-09).
- The roadmap already had one adversarial review; a second full review was declined. Codex
  (`~/.local/bin/codex`; codex-cli 0.167.0 and logged in when checked on 2026-11-10) gives targeted reviews of M2,
  M5 and M6+M8.
  Confirm the exact command with Omar before each run and use a read-only sandbox.
- Accuracy matters more than export counts. Low counts on real libraries are reported with causes, not hidden.
- M11 must include a check against real component source or a TypeScript interface, not only against docgen, and
  must say what each part proves.
- If Eric has no usable external build by Thu Nov 12, Omar and Claude build one more external library themselves.

## Completed

**M1, characterization tests** (`010aa61`, tests only, nothing under `src/`, `bin/` or `spec/` changed):

- `test/characterization.test.mjs` pins current behavior. It does not claim that behavior is correct.
- `test/golden/react-uswds.report.fail.json`: the report entry of all 75 components under the default policy.
- `test/golden/react-uswds.report.omit-changes.json`: the 8 components whose entry differs with
  `--unmapped-events omit`.
- `test/golden/basic-catalog.local-rules.json`: what the validator reports on the official `basic_catalog.json`.
- Regenerate with `UPDATE_SNAPSHOTS=1 node --test test/characterization.test.mjs`, then review the diff.

Numbers later tasks rely on, all read from these snapshots:

- react-uswds: 2 exported / 73 blocked by default (GovBanner, Collection); 4 / 71 with `omit`.
- 11 messages say `Unsupported type ''` (M3 replaces them).
- 12 `MANIFEST_ENTRY_INVALID` entries: 9 missing `meta.component`, 3 docgen extraction errors (M5 splits them).
- Official basic catalog: 0 official meta-schema errors, 31 reference-check problems and 6 structural-rule
  problems. The exporter's own rules are stricter than the specification (M7 must label this honestly).

**N2, continuous integration** (`3e4758f`): `.github/workflows/ci.yml`.

- Matrix: Node 22 and Node 24 on Ubuntu, Node 22 on Windows. Steps: `npm ci`, `npm test`, then a clean install of
  the packed tarball in an empty directory outside the checkout, followed by the installed CLI (`--version` and
  `inspect` on the react-uswds fixture).
- `.gitattributes` checks text files out with LF on every platform, so the byte-for-byte golden catalog test
  passes on Windows.
- Local Node versions: 22 and 24 through `fnm` (`fnm exec --using=22 npm test`), 26.7.0 as the system Node.

**M2, own-property checks in the validator and the ref resolver** (committed together with this entry):

- Seven lookups that followed the prototype chain (`key in object` or `object?.[key]`) now use `Object.hasOwn`: six
  in `src/a2ui/validate.mjs` (`validateCatalogReferences` and `validateCatalogStructuralRules`) and one in
  `resolveRef` in `src/storybook-build.mjs`.
- The three known-bad catalogs are rejected: `required` listing `toString`,
  `$ref: "common_types.json#/$defs/toString"` and `$ref: "#/components/constructor"`. A manifest reference to
  `#/constructor` reports "does not resolve".
- Five regression tests in `test/exporter.test.mjs`. `npm test` gives 55 passed, 0 failed, run locally on Node
  22.23, 24.22 and 26.7. No golden file, snapshot or fixture changed.
- Codex reviewed the change in a read-only sandbox on 2026-11-10 and found nothing in the change itself. The two
  gaps it found next to it are recorded under "Known validator limitations" below.

**C0, Material UI experiment** (2026-11-10/11, outside the repository, nothing committed): Storybook 10.6.7 and
`@mui/material` 9.5.0, six components (Alert, Button, Chip, Switch, TextField, Typography).

- Stories that import Material UI directly give a manifest in which every entry carries an `error` and no docgen.
  The exporter stops with "Unsupported components manifest format", which does not name the cause.
- `react-docgen` over project-local pass-through files finds the components and 0 properties.
- `react-docgen-typescript` with the options of Storybook's Material UI recipe over pass-through files gives 156
  properties, all with `required: false`. The unmodified exporter exports **0 of 6** from it, under both event
  policies. 74 blocking issues: `UNSUPPORTED_PROP_TYPE` 48, `PROJECTED_CONTENT_UNMAPPED` 15, `UNMAPPED_EVENT` 8,
  `A2UI_RESERVED_NAME` 2 (optional `id`), `MANIFEST_ENTRY_INVALID` 1 (`TextField.variant`, default repeated once per
  union member).
- Button and Chip have no `onClick` in the manifest. `label`, `children`, `startIcon` and `Alert.action` are all
  `ReactNode`: the type cannot tell text from a slot for another component.

**C0b, Material UI fixtures and characterization tests** (tests and fixtures only, nothing under `src/` or `bin/`):

- `test/fixtures/mui-harness/` is the Storybook project (pinned `package.json`, `package-lock.json`, three Storybook
  configurations, the pass-through files and the direct-import stories). A clean `npm ci` and all three builds were
  run from a copy of it on 2026-11-11.
- `test/fixtures/mui-rdt-pass/` (156 properties), `mui-rdt-direct/` (every entry an error) and `mui-rd-pass/`
  (0 properties) are the build outputs. Only the absolute build path is normalized, by
  `mui-harness/normalize-paths.mjs`; hashes before and after are in `test/fixtures/PROVENANCE.md`.
- The exported components are Storybook pass-through components that keep the real Material UI component and its
  inherited props type. They are not manifest entries of the upstream components. PROVENANCE.md says so.
- Four tests in `test/characterization.test.mjs`. `test/golden/mui-rdt-pass.report.fail.json` holds the report entry
  of the six components under the default policy; `mui-rdt-pass.report.omit-changes.json` the five that differ with
  `--unmapped-events omit`. `npm test` gives 59 passed, 0 failed. No existing golden file changed.

**C1, opt-in supported-subset mode** (`--supported-subset`, library option `supportedSubset: true`):

- One rule, in `evaluate` (`src/contract.mjs`): a property whose only blocker is `UNSUPPORTED_PROP_TYPE` is recorded
  as omitted when the metadata says `required: false`. Required, unknown requiredness and the reserved names `id`
  and `component` still block, and the blocker's message says which of the three applies. Content, events,
  unsupported defaults and metadata errors are untouched.
- The contract has a new list, `source`: every property the metadata lists, with its original type text, `required`
  as `true`, `false` or `null`, and the blockers the adapter raised for it. Both adapters fill it. The policy reads it
  only in this mode.
- Report, in this mode only: `policy.supportedSubset`, one more paragraph in `notice`, `omittedKnown` entries with
  `kind: "property"`, and per component `sourceProperties` (name, `sourceType`, `requiredness`, `disposition`,
  `reason`). `mapped` is never emitted yet. The component description in the catalog names every property left out.
- Default mode is byte-identical: no existing golden changed, and 44 CLI runs of the old and new code over all six
  fixtures gave the same stdout, stderr, exit code and files. Only `--help` differs.
- Measured: Material UI stays at **0 of 6**. `UNSUPPORTED_PROP_TYPE` falls from 48 to 6 (the `component` property of
  each component). Of 156 source properties, 76 are supported, 48 omitted (42 by the new rule and `style` six times)
  and 32 blocked; with `--unmapped-events omit` 76, 56 and 24. react-uswds goes from 2 to 4 of 75 (Card,
  SearchButton), and from 4 to 6 with `--unmapped-events omit`.
- 11 tests: 8 in `test/exporter.test.mjs`, 3 in `test/characterization.test.mjs`, with
  `test/golden/mui-rdt-pass.report.subset.json`. `npm test` gives 70 passed, 0 failed.

Decided by Omar at the C1 review (2026-11-11):

- The disposition of a property that can be represented directly in A2UI is `supported`, not `exported`. `exported`
  stays the `status` of a component that was written to the catalog. `omitted` and `blocked` are unchanged, and
  `mapped` is reserved for explicit C2 mappings.
- `Chip.avatar`, `Chip.deleteIcon` and `Chip.icon` are typed `ReactElement<...>`. The existing React classifier calls
  that an unsupported type, not content, so the mode leaves them out, recorded and disclosed. This stays unchanged
  until C2.
- The mode also leaves out optional properties that carry a value: `value` of TextField and Switch and
  `TextField.defaultValue` (`unknown`), `Button.loading` (`boolean | null`), `Typography.color`, `Switch.edge`.
  Accepted for C1 as a documented omission.
- An optional `component` or `id` stays blocked in C1. Leaving them out needs a generic, reviewed rule, planned for C2.
- `THIRD_PARTY_NOTICES.md`, the task documentation and the `mui-rd-pass` negative fixture are kept.

## Next task: C2, mappings for text content and component references (design only; not approved)

What still blocks the six Material UI components after C1 with `--unmapped-events omit`: 15 content properties,
`component` six times, `id` twice (Switch, TextField) and the default of `TextField.variant`. The proposed design
and its renderer obligations were reported to Omar on 2026-11-11. No part of C2 is implemented.

M3 (`MISSING_PROP_TYPE` replaces `Unsupported type ''`) and the tasks after it are not started and now follow the
C tasks. Their acceptance criteria are in `tasks/plan.md`.

## Known validator limitations (recorded with M2; behavior deliberately unchanged)

Found by the Codex review of M2 and reproduced on 2026-11-10. Both are the M2 bug class, a name that is only
inherited from `Object.prototype` read as a definition, in places M2 does not touch. In both, a reference to a name
that exists nowhere (`Missing`) is rejected, because Ajv cannot resolve it; a reference to an inherited name is
accepted, because Ajv follows the prototype chain when it resolves a JSON pointer.

1. **`anyFunction` targets are checked only when the catalog defines a function.** `validateCatalogReferences`
   skips the `$defs.anyFunction.oneOf` check when `catalog.functions` is empty. `validateV1Export` accepts
   `functions: {}` with `$defs.anyFunction: { oneOf: [{ "$ref": "#/functions/constructor" }] }`.
2. **Only references inside `catalog.components` get the exporter's own resolution check.** A `$ref` anywhere else
   is resolved by Ajv alone. `validateV1Export` accepts `"$ref": "#/components/__proto__"` under
   `$defs.anyComponent.properties`, and `"$ref": "#/components/__proto__"` or
   `"$ref": "common_types.json#/$defs/__proto__"` inside a function's `args`.

- **Impact:** No demonstrated impact on catalogs generated by the current exporter. Those have `functions: {}` and
  `anyFunction: false`, and their only reference outside `components` is the `$defs.anyComponent.oneOf` list, which
  is checked. Every reproduction so far used a catalog edited by hand.
- **Decision (Omar, 2026-11-10):** not part of M2. Revisit the priority after M3 and the diagnostics work, or sooner
  if external testing shows an impact.
- **For a later fix:** a check that covers the whole catalog reaches 58 more references in the official basic
  catalog (32 internal, 26 to `common_types.json`), so `test/golden/basic-catalog.local-rules.json` must be
  re-reviewed.

## Open risks

- Review time is the real limit: about two commits a day before the feature freeze.
- No external Angular library exists as a fixture yet. The only real Angular fixture uses self-written components.
  A React fixture with react-docgen-typescript now exists (Material UI, C0b).
- Most components in real libraries are blocked (children, callbacks, object props). That is reported, not worked
  around.
- The catalog cannot express actions (`events: {}`); this must appear as a limitation in the output contract.
- Open questions: who would own an npm package, and what Storybook's docs say about the `manifest` tag.
