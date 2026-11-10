# Handoff: Storybook-to-A2UI exporter

Written 2026-11-09 for a fresh Claude Code session. Read this file, then `tasks/plan.md` (roadmap, acceptance
criteria, verified findings) and `tasks/todo.md` (checklist). `docs/HANDOFF.md` is an older handoff from before this
plan and is partly out of date.

## State of the repository (verified 2026-11-09)

- Branch: `feat/exporter-hardening`. Working tree clean.
- Commits on top of `4fc9d40` (the baseline the plan refers to), all local only:
  - `c2b4b14` Add the exporter-only roadmap and task list
  - `010aa61` Pin current report and validator behavior with characterization tests (task M1)
  - one documentation commit that adds this handoff and ticks M1 in `tasks/todo.md`
- **Nothing from this plan is pushed.** `origin/main` is at `142dd7b`, `origin/docs/share-floorplan` at `4fc9d40`.
- **Upstream trap:** the local branch tracks `origin/docs/share-floorplan`, and `feat/exporter-hardening` does not
  exist on the remote. An approved push must name the branch: `git push -u origin feat/exporter-hardening`.
- Tests: `npm test` gives 50 passed, 0 failed (47 in `test/exporter.test.mjs`, 3 in
  `test/characterization.test.mjs`), run on Node 26.7.0. Node 22 and 24 have never been run.
- Remote: `https://github.com/o0avdi/a2ui-storybook-exporter.git`. No `.github/` folder, no CI yet.

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
2. **Approval gates.** No task starts without Omar's approval (N2 already has it, see below). Stop after each
   task and wait for review.
3. **Show before committing.** Present the change and the test results first; commit after Omar's go-ahead.
4. **No push or merge without explicit approval**, each time. No installs without approval; the one standing
   exception is described under N2.
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
  (`~/.local/bin/codex`, version and login not yet checked) gives targeted reviews of M2, M5 and M6+M8.
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

## Next task: N2, continuous integration (not started)

**Already approved for local implementation and testing**, so it can begin without asking again. Stop for Omar's
review before committing, before pushing, and before moving to any other task.

**Installs:** temporary, isolated npm installations needed to test N2 are approved (for example installing the
packed tarball into a throwaway directory). Do not install or modify global tools without asking; that includes
adding Node versions.

Approved shape:

- Matrix: Node 22 and Node 24 on Ubuntu, Node 22 on Windows.
- Steps: `npm ci`, `npm test`, then a clean install of the packed tarball in an empty directory, followed by
  running the installed CLI (`--version` and an `inspect` on a repository fixture).
- Prepare and test as much as possible locally. **Do not push until Omar explicitly approves**, and push
  `feat/exporter-hardening` by name (see the upstream trap above).

Facts that help:

- `package.json` has `"private": true`, which blocks publishing but not `npm pack` or a tarball install.
- `npm pack --dry-run` gave 19 files, 47 KB; `test/` and `docs/` are not in the package, so the CI step must point
  the installed CLI at a fixture in the checked-out repository.
- `fnm` and `gh` are installed locally. Only Node 26.7.0 is known to be installed; adding Node 22 or 24 with
  `fnm` changes a global tool, so ask first.
- Snapshot tests compare parsed JSON, not bytes, so Windows line endings should not affect them. The existing golden
  catalog test compares bytes; watch it on Windows.

After N2: M2 (own-property checks in the validator and ref resolver), then M3. See `tasks/todo.md`.

## Open risks

- Review time is the real limit: about two commits a day before the feature freeze.
- Node 22 and Windows are unverified until N2 runs.
- The validator still accepts three known-bad catalogs until M2 (`in` instead of an own-property check).
- No external React fixture with react-docgen-typescript and no external Angular library exist yet. The only real
  Angular fixture uses self-written components.
- Most components in real libraries are blocked (children, callbacks, object props). That is reported, not worked
  around.
- The catalog cannot express actions (`events: {}`); this must appear as a limitation in the output contract.
- Open questions: who would own an npm package, and what Storybook's docs say about the `manifest` tag.
