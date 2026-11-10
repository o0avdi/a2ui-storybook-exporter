# Task list

Details, acceptance criteria and reasons are in `tasks/plan.md`. One task is one commit. Each task needs Omar's
approval before it starts and a review before the next one begins.

## Implementation (Omar with Claude)

### Before the feature freeze (target Fri Nov 13)

- [x] **M1** Characterization tests: react-uswds report under both policies; validator on the official basic catalog (`010aa61`)
- [ ] **N2** CI: Node 22 and 24 on Ubuntu, Node 22 on Windows; `npm ci`, `npm test`, clean tarball install (push needs approval)
- [ ] **M2** Own-property checks in the validator and ref resolver (Codex review)
- [ ] **M3** `MISSING_PROP_TYPE` replaces `Unsupported type ''`

**Checkpoint A:** `npm test` green; catalog golden byte-identical; react-uswds still 2/73 and 4/71; snapshot diffs reviewed.

- [ ] **M4** Code registry (`src/diagnostics.mjs`) and `reportVersion: 1`
- [ ] **M5** Specific React codes in `code` (Codex review)
- [ ] **M6** Fatal error codes
- [ ] **M7** Report summary, `descriptionOrigin`, accurate validation label

**Checkpoint B:** apply the drop order if the pace has slipped; stop and simplify if M4–M8 grew.

- [ ] **M8** `--json` for `inspect` and `export`, including fatal errors (Codex review with M6)
- [ ] **M9** `--exclude`

**Feature freeze.**

### After the feature freeze (code freeze target Tue Nov 17)

- [ ] **M10** `docs/DIAGNOSTICS.md`, filtering docs, short `docs/design/SOURCES.md`
- [ ] **N3** `docs/OUTPUT.md` output contract
- [ ] **N1** Packaged CLI works and ships its docs; version `0.2.0`; `CHANGELOG.md`
- [ ] **M11** Real-world integration test on a new external fixture (golden, docgen cross-check, source check, instance validation)
- [ ] **N4** README for external developers and `docs/COMPATIBILITY.md`

**Code freeze.**

## Compatibility evidence (Eric)

- [ ] **E0** Install from the tarball following the README only; record friction
- [ ] **E1** Corpus: React with react-docgen-typescript
- [ ] **E1** Corpus: external Angular library on `@storybook/angular-vite`
- [ ] **E1** Corpus: second React design system
- [ ] **E1** Corpus: React library with difficult patterns
- [ ] **E2** Manifest-tag test (`tags: ['!manifest']`)
- [ ] **E3** Bug reports reduced to one manifest entry each (ongoing)
- [ ] **E4** Final run at the freeze candidate with `--json`; `docs/evaluation/<library>.md`

**Fallback, Thu Nov 12:** if no usable external build has arrived, Omar and Claude build one additional external library.

## Should (only if the tasks above finish early)

- [ ] `UNKNOWN_REQUIREDNESS` for React (Must if a corpus run shows a non-boolean `required`)
- [ ] `ReactNode[]` classified as content
- [ ] Per-property description coverage in the report
- [ ] Single string literal as a one-value enum
- [ ] Separate pass/fail per validation layer in the report
