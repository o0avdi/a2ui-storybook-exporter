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
  `test/characterization.test.mjs`).
- CI: `.github/workflows/ci.yml` runs on every push. At `3e4758f` all three jobs passed (Node 22 and 24 on Ubuntu,
  Node 22 on Windows; GitHub Actions run 42757388584).
- Remote: `https://github.com/o0avdi/a2ui-storybook-exporter.git`.

## Objective

A standalone, general-purpose CLI that reads a Storybook build, writes a validated A2UI v1.0 `catalog.json` for the
components it can represent faithfully, and explains every component it cannot. University capstone sponsored by
Google Cloud (contact: Alan). Deadline: showcase on **Fri Nov 20, 2026**. Feature freeze target Fri Nov 13, code
freeze target Tue Nov 17. Both are targets: a correct, tested smaller scope beats a complete rushed one.

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

## Next task: M3, `MISSING_PROP_TYPE` replaces `Unsupported type ''` (not started)

Acceptance criteria are in `tasks/plan.md`. It needs Omar's approval before it starts. See `tasks/todo.md`.

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
- No external React fixture with react-docgen-typescript and no external Angular library exist yet. The only real
  Angular fixture uses self-written components.
- Most components in real libraries are blocked (children, callbacks, object props). That is reported, not worked
  around.
- The catalog cannot express actions (`events: {}`); this must appear as a limitation in the output contract.
- Open questions: who would own an npm package, and what Storybook's docs say about the `manifest` tag.
