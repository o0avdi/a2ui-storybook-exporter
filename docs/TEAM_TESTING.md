# Team testing guide

Goal: every teammate can install the exporter from a ZIP, prove it works on a known library, then try it on a library
we have never seen, and send back results we can compare. You do not need to understand the code.

| Platform | Status |
|---|---|
| macOS (Node 24.22.1) | **Verified.** Every macOS command below was run from a fresh ZIP extraction. |
| Windows PowerShell | **Unverified.** Written carefully, never executed. If one fails, copy the exact error into your results. |
| Linux | Same commands as macOS; not run. |

## Read this first (2 minutes)

- **The exporter makes a catalog, not a renderer.** A *catalog* is a JSON file (`catalog.json`) that lists the UI
  components an AI agent may ask for and the properties each one accepts. Nothing is drawn on screen. A developer's own
  renderer is what turns an agent's request into real UI.
- **Stories are examples, not components.** A Storybook *story* is one example of a component in one state. The
  react-uswds `GovBanner` has five stories (English/Spanish, `.gov`/`.mil`, default) and becomes **one** A2UI component,
  `GovBanner`, whose properties `language` and `tld` are what those stories vary. The exporter never creates a component per
  story. Stories are only used to check the manifest and index agree.
- **It reads Storybook's *Components Manifest*,** a file (`manifests/components.json`) Storybook >= 10.6 writes when you turn
  on a feature flag. The exporter never reads the library's source code.
- **Blocked is a normal result.** If a component has something with no faithful A2UI form (a callback such as `onClick`,
  React `children`, an object prop), the exporter *blocks* it and says why, instead of guessing. A bug is: a crash, a wrong
  property/type/default, a component marked `OK` that should not be, or a report that hides something.
- **The catalog is not proof of the full component contract.** Storybook metadata can hide props (`GovBanner` has 282
  props in TypeScript and 2 in the manifest). The report says so in `contract` and `notice`; keep that wording when you
  describe results.

## 1. Install from the source ZIP

You need **Node.js 24** ([nodejs.org](https://nodejs.org); `package.json` says >= 22, but only 24 was tested). Check with
`node -v`. Git is needed only for part 3.

**Omar, once (macOS):** make the ZIP from the committed branch. It contains source only (no `node_modules`, no `.git`) and
the short commit hash is in the file name, so results can name the exact version.

```bash
cd /Users/oavdi/repos/bacs496/a2ui-storybook-exporter
git archive --format=zip --prefix=a2ui-storybook-exporter/ -o ../a2ui-storybook-exporter-$(git rev-parse --short HEAD).zip HEAD
```

**Teammates, macOS / Linux:**

```bash
mkdir -p ~/a2ui-testing && cd ~/a2ui-testing
unzip ~/Downloads/a2ui-storybook-exporter-HASH.zip        # replace HASH with the real file name
cd a2ui-storybook-exporter
npm ci --ignore-scripts --no-audit --no-fund               # installs one package (ajv)
```

**Teammates, Windows PowerShell (unverified):**

```powershell
New-Item -ItemType Directory -Force $HOME\a2ui-testing | Out-Null
Set-Location $HOME\a2ui-testing
Expand-Archive -Path $HOME\Downloads\a2ui-storybook-exporter-HASH.zip -DestinationPath .
Set-Location a2ui-storybook-exporter
npm ci --ignore-scripts --no-audit --no-fund
```

If PowerShell says "running scripts is disabled", type `npm.cmd` instead of `npm` (and `npx.cmd` instead of `npx`).
All later `node ...` commands are identical in both shells. Run exporter commands from the `a2ui-storybook-exporter` folder.

## 2. Baseline: the committed react-uswds fixture (no Storybook needed)

The fixture is a real `storybook build` of [`trussworks/react-uswds`](https://github.com/trussworks/react-uswds) (75
components). If any step here differs from "Expect", stop and report it before testing anything else.

```bash
npm test
```
Expect, near the bottom: `tests 47`, `pass 47`, `fail 0` (each line starts with an `ℹ`).

```bash
node bin/storybook-a2ui.mjs inspect --storybook test/fixtures/react-uswds
```
Expect: first line `build react-uswds: react-v0 (manifest v0, react-docgen)`, then 2 components `OK` (`GovBanner`,
`Collection`) and 73 `BLOCKED`, each with a reason code. `inspect` writes nothing.

```bash
node bin/storybook-a2ui.mjs export --storybook test/fixtures/react-uswds --components GovBanner --catalog-id https://example.org/catalogs/react-uswds/govbanner --out results/baseline/govbanner
```
Expect: `Wrote .../catalog.json (official A2UI v1.0 validation: PASS) and export-report.json`, exit code 0. `--out` must be a
new or empty folder, so use a new name each time you rerun.

Check the output is identical to the committed golden file (works in both shells):

```bash
node -e "const f=require('fs');console.log(f.readFileSync('results/baseline/govbanner/catalog.json','utf8')===f.readFileSync('test/golden/govbanner.catalog.json','utf8')?'MATCHES golden':'DIFFERS')"
```
Expect: `MATCHES golden`.

**Look at the two output files** (open in any editor):

- `catalog.json` — the product. Find `components.GovBanner.properties`: `language` (`english`/`spanish`, default `english`) and
  `tld` (`.gov`/`.mil`, default `.gov`), `additionalProperties: false`, and one component, not five. The description says
  the schema lists Storybook-exposed properties only.
- `export-report.json` — the diagnostics. Look at `components[0].status` (`exported`), `.contract` (`sourceContractVerified:
  false`, `inheritedAttributes` and `projectedContent` are `"unknown"`; unknown never means none), `builds[0]` (manifest
  version and file hashes) and the top-level `notice`. Blocked components list `blocking: [{code, message}]`.

Now practise the summary you will use on the external library, on the whole fixture:

```bash
node bin/storybook-a2ui.mjs export --storybook test/fixtures/react-uswds --catalog-id https://example.org/catalogs/react-uswds/all --out results/baseline/all
node -e "const r=require('./results/baseline/all/export-report.json');const by={};let ok=0;r.components.forEach(c=>{if(c.status==='exported')ok++;new Set(c.blocking.map(b=>b.code)).forEach(k=>by[k]=(by[k]||0)+1)});console.log('discovered',r.components.length,'supported',ok,'blocked',r.components.length-ok);console.log(by)"
```
The export prints the whole 75-component list first; that is normal. Expect: `discovered 75 supported 2 blocked 73`, then the
number of *components* blocked per reason code (a component with two reasons counts under both):
`PROJECTED_CONTENT_UNMAPPED: 31`, `UNMAPPED_EVENT: 8`, `UNSUPPORTED_PROP_TYPE: 33`, `NO_EXPORTABLE_PROPS: 24`,
`MANIFEST_ENTRY_INVALID: 12`.

## 3. Test an unrelated library

**Pick a library that fits** (open its `package.json`): Storybook **10.6 or newer** and `@storybook/react-vite` or
`@storybook/angular-vite`. Anything else (older Storybook, Vue, Web Components, webpack builders, a Storybook you would
have to upgrade) is **not testable yet**: write "not compatible, reason" in the results rather than forcing it. Use a
library you are allowed to share results about; for a private repository, ask Omar before submitting anything.

### 3a. Get the library at a fixed commit

Replace `LIB_URL` and `mylib`. macOS / Linux (Windows: same `git` commands):

```bash
cd ~/a2ui-testing
git clone LIB_URL mylib && cd mylib
git rev-parse HEAD                  # RECORD: exact commit
git remote get-url origin           # RECORD: repository URL
npm ci --ignore-scripts             # or the library's own lockfile install: pnpm install --frozen-lockfile / yarn install --immutable
npx storybook --version             # RECORD: must be 10.6 or newer
```

Third-party installs run someone else's code; use the lockfile and `--ignore-scripts` as shown. If the install or build
needs scripts to run, stop and ask Omar rather than working around it.

### 3b. Turn on the manifest in a *separate* Storybook config (components are never touched)

Storybook can be pointed at a different config folder, so you copy `.storybook` and change only the copy.

```bash
cp -R .storybook .storybook-a2ui            # PowerShell: Copy-Item -Recurse .storybook .storybook-a2ui
```

Open `.storybook-a2ui/main.ts` (or `.js` / `.mjs`) and add these inside the config object. If `features` or `typescript`
already exist, add the line *inside* the existing one instead of creating a second.

```ts
  features: { componentsManifest: true },
  typescript: { reactDocgen: 'react-docgen' },   // React only; leave this line out for Angular
```

Leave `stories`, addons and everything else as they are. If the library keeps `.storybook` in a package folder of a
monorepo, do this inside that folder.

Build to a folder **outside** the library (macOS / Linux; the first variable only turns off Storybook's usage telemetry):

```bash
STORYBOOK_DISABLE_TELEMETRY=1 npx storybook build -c .storybook-a2ui -o ../mylib-sb-build
```
PowerShell (unverified): `$env:STORYBOOK_DISABLE_TELEMETRY="1"; npx storybook build -c .storybook-a2ui -o ../mylib-sb-build`

Two checks before going on:

```bash
git status --short                          # Expect exactly one line:  ?? .storybook-a2ui/
ls ../mylib-sb-build/manifests/components.json     # PowerShell: Test-Path ../mylib-sb-build/manifests/components.json
```
Any other line from `git status` means a file in the library changed: stop and tell Omar. A missing `components.json`
means the manifest flag did not take effect (wrong config folder, or Storybook older than 10.6).

### 3c. Run the exporter

From the exporter folder. Two runs show how much unlocks when callbacks are set aside (`--unmapped-events omit` exports a
component's properties and records each callback as *not exported*; it never invents a mapping).

```bash
cd ~/a2ui-testing/a2ui-storybook-exporter
mkdir -p results/mylib                                   # PowerShell: New-Item -ItemType Directory -Force results\mylib | Out-Null
node bin/storybook-a2ui.mjs inspect --storybook ../mylib-sb-build > results/mylib/inspect.txt
node bin/storybook-a2ui.mjs export --storybook ../mylib-sb-build --catalog-id https://example.org/catalogs/mylib/1 --out results/mylib/export-default
node bin/storybook-a2ui.mjs export --storybook ../mylib-sb-build --unmapped-events omit --catalog-id https://example.org/catalogs/mylib/1 --out results/mylib/export-omit
```
PowerShell: use `| Out-File -Encoding utf8 results\mylib\inspect.txt` instead of `>` (Windows PowerShell 5.1 would write UTF-16).

Exit codes: `0` exported; `1` nothing could be exported under that policy (**normal** for many libraries; no files are
written, so rely on `inspect.txt`); `2` usage or input problem (read the message; a missing manifest prints the two lines
to add). Read `results/mylib/inspect.txt` in an editor: each component is `OK` or `BLOCKED` with codes such as
`UNMAPPED_EVENT`, `PROJECTED_CONTENT_UNMAPPED`, `UNSUPPORTED_PROP_TYPE`, `UNSUPPORTED_DEFAULT`, `A2UI_RESERVED_NAME`, `UNSAFE_NAME`.

## 4. Record what you found

Copy `docs/TEAM_TEST_RESULTS_TEMPLATE.md` to `results/mylib/RESULTS.md` and fill it in. Where each fact comes from:

| Fact | How to get it |
|---|---|
| External repository commit and URL | `git rev-parse HEAD` and `git remote get-url origin`, run in the library (step 3a) |
| Storybook version | `npx storybook --version`; the build also records it: `node -e "console.log(require('../mylib-sb-build/project.json').storybookVersion)"` |
| Manifest version (and adapter) | first line of the exporter output, e.g. `react-v0 (manifest v0, react-docgen)` or `angular-vite-v1 (manifest v1, ...)` |
| Exporter version | the ZIP file name (it contains the commit hash) |
| Total discovered / supported / blocked | the summary command below |
| Reasons for blocking | the by-code counts from the summary, plus three example messages copied from `inspect.txt` |
| Source-contract limitations | the `contract` lines below, plus the manual check in the template |

Summary (run from the exporter folder; use `export-omit` for the second run). If an export exited with `1` there is no
report: count with `grep -c "^BLOCKED" results/mylib/inspect.txt` (PowerShell: `(Select-String '^BLOCKED' results\mylib\inspect.txt).Count`) and write "0 supported".

```bash
node -e "const r=require('./results/mylib/export-default/export-report.json');const by={};let ok=0;r.components.forEach(c=>{if(c.status==='exported')ok++;new Set(c.blocking.map(b=>b.code)).forEach(k=>by[k]=(by[k]||0)+1)});console.log('discovered',r.components.length,'supported',ok,'blocked',r.components.length-ok);console.log(by)"
node -e "const r=require('./results/mylib/export-default/export-report.json');r.components.filter(c=>c.status==='exported').forEach(c=>console.log(c.name,'| properties:',c.properties.join(','),'| inherited:',c.contract.inheritedAttributes,'| children:',c.contract.projectedContent,'| not exported:',c.omittedKnown.map(o=>o.kind+':'+o.name).join(',')||'-'))"
```

"Discovered" is every component in the manifest; it is not necessarily every component in the library, because Storybook
documents only components that have stories.

**Manual spot check (10 minutes, the most valuable part):** pick one or two components marked `OK`, open their source
file, and compare the props with `catalog.json`. Write down any prop the source has that the catalog lacks, and whether
the component renders `{children}` or slots. This is how we find what the manifest hides.

## 5. Submit

Send **one ZIP** per library containing `results/mylib/` (the filled `RESULTS.md`, `inspect.txt`, `export-default/` and
`export-omit/` with their `catalog.json` and `export-report.json`). Do not send the library's source or the Storybook build.
There is no shared repository yet, so send it to Omar through the team's usual channel.

```bash
zip -r mylib-results.zip results/mylib            # PowerShell: Compress-Archive -Path results\mylib -DestinationPath mylib-results.zip
```

Do not publish the catalog or the report outside the team; they contain the library's component names and descriptions.
Storybook's own error messages (copied into `inspect.txt` and `export-report.json` for blocked components) can include
absolute paths such as `/Users/<you>/...`. They are harmless for the team, but search for your user name and replace it with
`<home>` if you share the files anywhere wider.

## Troubleshooting

| You see | Do this |
|---|---|
| `npm: command not found` / wrong Node | Install Node 24 and open a new terminal. |
| `ERR_MODULE_NOT_FOUND ... ajv` | You skipped `npm ci` in the exporter folder. |
| `No components manifest found` | Step 3b was skipped or built the wrong config; rebuild with `-c .storybook-a2ui`. |
| `Unsupported components manifest format` | Not React-docgen v0 or Angular-Vite v1. Record it in the results: that is a finding. |
| `Output directory is not empty` | Choose a new `--out` name. |
| `Component name collision across builds` | Export one build at a time. |
| Anything else | Copy the full command and error text into the results. |
