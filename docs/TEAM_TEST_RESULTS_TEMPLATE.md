# Test results: <library name>

Copy this file to `results/<library>/RESULTS.md` and fill it in. Write "unknown" or "not run" rather than leaving a
blank or guessing. How to find each value is in `docs/TEAM_TESTING.md`, section 4.

## 1. Who, when, where

| | |
|---|---|
| Tester | |
| Date | |
| Operating system and version | |
| Shell used (zsh, bash, PowerShell 5.1, PowerShell 7) | |
| Node version (`node -v`) | |
| Exporter ZIP file name (contains the commit hash) | |

## 2. Baseline (react-uswds fixture)

| Check | Result |
|---|---|
| `npm test` (expect 37 tests, 37 pass, 0 fail) | |
| `inspect`: OK / BLOCKED counts (expect 2 / 73) | |
| GovBanner export exit code and `official A2UI v1.0 validation: PASS` line | |
| Output `MATCHES golden` | |
| Full export summary (expect `discovered 75 supported 2 blocked 73`; by code 31 / 8 / 33 / 24 / 12, see the guide) | |
| Any difference from "Expect" (paste the text) | |

## 3. External library

| | |
|---|---|
| Library name | |
| Repository URL (`git remote get-url origin`) | |
| **Exact commit** (`git rev-parse HEAD`) | |
| Framework / builder (`@storybook/react-vite` or `@storybook/angular-vite`) | |
| **Storybook version** | |
| Install command used | |
| Storybook config change, pasted exactly | |
| `git status --short` after the build (expect only `?? .storybook-a2ui/`) | |
| Build command, and whether it succeeded | |
| **Manifest version** and adapter (first line of exporter output) | |
| Manifest `meta.docgen` | |

If the library was **not testable** (older Storybook, unsupported framework, build failed), stop here and write why, with
the exact error text:

## 4. Counts

| | Default policy | `--unmapped-events omit` |
|---|---|---|
| Exit code | | |
| **Total components discovered** | | |
| **Supported (exported)** | | |
| **Blocked** | | |
| Warnings (e.g. `AMBIGUOUS_COMPONENT_ID`) | | |

Components blocked per reason code (from the summary command; one component can appear under several codes):

| Reason code | Components | One example message copied from `inspect.txt` |
|---|---|---|
| `UNMAPPED_EVENT` | | |
| `PROJECTED_CONTENT_UNMAPPED` | | |
| `UNSUPPORTED_PROP_TYPE` | | |
| `UNSUPPORTED_DEFAULT` | | |
| `A2UI_RESERVED_NAME` | | |
| `NO_EXPORTABLE_PROPS` | | |
| `MANIFEST_ENTRY_INVALID` / `INDEX_MISMATCH` | | |
| other | | |

Did the blocking reasons look correct? Name any component that was blocked, or exported, that you think is wrong, and why:

## 5. Source-contract limitations (manual spot check)

The report always says `sourceContractVerified: false`. Record what you actually saw for one or two exported components.

| Component | Properties in `catalog.json` | Props in the source that are not in the catalog | Renders `{children}` / slots? | `inheritedAttributes` / `projectedContent` in the report |
|---|---|---|---|---|
| | | | | |
| | | | | |

Other limits you noticed (hidden props, callbacks omitted, defaults, types):

## 6. Findings

| # | What happened | Expected | Command and exact text | Severity (crash / wrong output / misleading / question) |
|---|---|---|---|---|
| 1 | | | | |

## 7. Submitted files

- [ ] `RESULTS.md` (this file)
- [ ] `inspect.txt`
- [ ] `export-default/` (`catalog.json`, `export-report.json`), or note that the export exited with 1
- [ ] `export-omit/` (`catalog.json`, `export-report.json`), or note that the export exited with 1
- [ ] The library is allowed to be shared with the team (public, or Omar agreed)
