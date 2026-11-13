# Fixture provenance

The build fixtures are **unmodified or minimally normalized copies of real `storybook build` output**. No build
output here was written by hand to suit the exporter. The one hand-written file is `mui.mappings.json`, which is
exporter configuration and not Storybook output (see its section below).

## `chromatic-react/` (genuinely external)

- Project: https://github.com/chromaui/intro-storybook-react-template, commit
  `5cad2aa3f096ddd24fe24c62842e4e1d1a3958dd` (Chromatic's "Intro to Storybook" template; independent of this repo).
- Built by the independent Codex React experiment (Storybook / `@storybook/react-vite` **10.6.5**, React 19.3.1,
  `react-docgen` 8.0.4, `features.componentsManifest: true`). That build changed only `.storybook/main.ts`
  (adds the manifest feature and `reactDocgen: "react-docgen"`); component source was untouched.
- `index.json`: byte-identical to the build output (sha256 `99994ee3...7ec12`).
- `manifests/components.json`: the build output with **one transformation**, the absolute `definedInFile` paths
  (which pointed into a scratch directory) rewritten to `./src/stories/Button.tsx` style relative paths. All
  prop metadata is unchanged. Original sha256 `b55df579c4b849237e65aa4ae00ea16a93b34edab598c14909a0ae22dad3ab60`.
- Manifest format: **v0**, inline `reactDocgen`.

## `angular-vite-spike/` (real tool output, self-authored components)

- Produced by the Angular-Vite spike (`@storybook/angular-vite` **10.6.5**, Angular 22.2.x, `features.componentsManifest: true`).
- The two components (`StatusBadgeComponent` with decorator inputs, `StatusChipComponent` with signal inputs/outputs)
  were **written for the spike**. They are therefore evidence for the *adapter* (does it read real Storybook Angular
  output) and **not** evidence of external compatibility.
- All files are byte-identical copies:
  - `manifests/components.json` sha256 `fb794e7f...5deaae`
  - `services/core/docgen/spike-statusbadge.json` sha256 `070e4a23...e4969c`
  - `services/core/docgen/spike-statuschip.json` sha256 `c376358d...726f63`
- Manifest format: **v1**, components reference `docgen` and `stories` via relative `$ref` JSON pointers into
  `services/core/...`.

## `react-uswds/` (genuinely external, the end-to-end fixture)

- Project: https://github.com/trussworks/react-uswds, commit `0c6fab64c104dd04b0edcacb9d3c949c27abe013` (Apache-2.0).
- Built with Storybook / `@storybook/react-vite` **10.6.3**, `react-docgen`, `features.componentsManifest: true`, Node 24.22.1,
  from the repository's own `package-lock.json` (`npm ci --ignore-scripts`). Only an untracked copy of `.storybook` was changed.
- `index.json`: byte-identical (sha256 `5e06901369ece50b0cc4db57161176a1ab24de70333f5c13ff0507eb17a4eca7`).
- `manifests/components.json`: the build output with one transformation, 72 absolute `definedInFile` paths
  (`/Users/<user>/a2ui-pilots/react-uswds/src/`) made repository-relative. Original sha256
  `3432bbafff854ca6698ece0a2c2dd58b1d499fd422f8aee54e4c5759f3857d35`. 75 components, manifest v0.
- `../golden/govbanner.catalog.json`: the catalog the exporter produced from the real build. Under the
  default policy 2 of 75 components convert (`GovBanner`, and `Collection` with its single `condensed` property, whose
  `children` the manifest hides); 73 are blocked (children, callbacks, object props).

## `mui-rdt-pass/`, `mui-rdt-direct/`, `mui-rd-pass/` (genuinely external components, Material UI)

Three real `storybook build` outputs of one small project, `mui-harness/`, which shows six unmodified Material UI
components: Alert, Button, Chip, Switch, TextField and Typography. The project and its lockfile are committed, so the
builds can be repeated.

- Library: `@mui/material` **9.5.0** from npm (MIT License, Copyright (c) 2014 Call-Em-All), with `@emotion/react`
  11.14.0 and `@emotion/styled` 11.14.1.
- Tools: Storybook / `@storybook/react-vite` **10.6.7**, React 19.3.1, TypeScript 5.9.3, Vite 8.3.8,
  `features.componentsManifest: true`. Exact versions are pinned in `mui-harness/package.json`; the resolved tree is
  `mui-harness/package-lock.json` (sha256 `34d70b2c7ae1c2bbf370459e8def8531aed5c9769a5d53ed1bbd7f48d7ebd6b8`).
- Built on 2026-11-11 with Node 22.23.4 and npm 10.9.9 on macOS, from a copy of `mui-harness/` outside this
  repository: `npm ci` (223 packages, lockfile unchanged), `npx tsc --noEmit` and the three builds all exited 0.

| Fixture | Storybook config | Docgen engine | Stories import | What Storybook wrote |
|---|---|---|---|---|
| `mui-rdt-pass/` | `.storybook-rdt-pass/` | `react-docgen-typescript` with the options of Storybook's Material UI recipe | pass-through files (`passthrough/`) | 6 components, 156 properties |
| `mui-rdt-direct/` | `.storybook-rdt/` | the same | `@mui/material/<Component>` directly (`src/stories/`) | 6 entries, each with an `error`, no docgen |
| `mui-rd-pass/` | `.storybook-rd-pass/` | `react-docgen` | pass-through files | 6 components, 0 properties |

The recipe is https://storybook.js.org/recipes/@mui/material; its `reactDocgenTypescriptOptions` are copied unchanged.

### The exported components are Storybook pass-through components

The entries in `mui-rdt-pass/` are **not** manifest entries of the upstream Material UI components. Storybook writes no
docgen for a component whose file is in `node_modules` (that is what `mui-rdt-direct/` records). Each file in
`mui-harness/passthrough/` therefore re-declares one component in the project, in the form the recipe gives:

```tsx
export interface ButtonProps extends MuiButtonProps {}
export const Button = (props: ButtonProps) => <MuiButton {...props} />;
```

The real Material UI component renders, and the props type is inherited whole: nothing is picked, omitted, renamed or
narrowed. `TextField.tsx` uses `export type TextFieldProps = MuiTextFieldProps;` because Material UI declares that type
as a union, which an interface cannot extend (TypeScript error TS2312). What the manifest describes is the pass-through
component with the inherited public props type. Each property's `parent.fileName` names the Material UI declaration
file it comes from. Properties declared in `@types/react` are removed by the recipe's `propFilter`; `onClick` is
absent from Button and Chip, and that filter is the likely cause (not verified).

### Normalization and hashes

Each `index.json` is byte-identical to the build output. Each `manifests/components.json` is the build output with
**one transformation**, made by `mui-harness/normalize-paths.mjs` on the file text: the absolute path of the build
directory is replaced by `.`, six times per file (`filePath` in `mui-rdt-pass/`, `definedInFile` in `mui-rd-pass/`,
the file named in each error message in `mui-rdt-direct/`). No property name, type, default, description or
requiredness is changed.

| File | sha256 as built | sha256 committed |
|---|---|---|
| `mui-rdt-pass/index.json`, `mui-rd-pass/index.json` | `18d2c93d103accbb20a3db0014dad357c93b8db5214a9cc5a4f88e8ca853c016` | the same |
| `mui-rdt-direct/index.json` | `3797d740c889b1811480e55deb5dad67fb46bb7df02b60fa9033659d922ff445` | the same |
| `mui-rdt-pass/manifests/components.json` | `dce5a949a4e6e006454e738e9d7466085f9a44b46a4307d9bb1940237292d02b` | `cd63cbf7050a4174e1bab637f40184acb6bc87236de9287c6d55a05c6f3998ea` |
| `mui-rdt-direct/manifests/components.json` | `8e8feace2de613e95df3fdd227609d0698f658937aaf156286a82dae3ca12942` | `160c07b60231c417a431a3faaebcd3f60c890db2709c59d359bf0523b1c46443` |
| `mui-rd-pass/manifests/components.json` | `2e4752dda8dc0b2c2692f5c1900890c04695ef5bf07480141060ce3f64080b62` | `e3d2235a65fe314be0579efcffe85a0269c9e7cab525d337884c5e78a1f6d477` |

### Rebuilding

```bash
cp -R test/fixtures/mui-harness /somewhere/outside/the/repository/mui-harness   # keep the directory name
cd /somewhere/outside/the/repository/mui-harness
npm ci
npm run build:rdt-pass && node normalize-paths.mjs out-rdt-pass <fixture-directory>
npm run build:rdt      && node normalize-paths.mjs out-rdt      <fixture-directory>
npm run build:rd-pass  && node normalize-paths.mjs out-rd-pass  <fixture-directory>
```

A rebuild is **not byte-identical**, for two measured reasons:

- `meta.durationMs` in each manifest is the time the docgen step took (1126 in the committed `mui-rdt-pass/`, 1122
  in the first build of the same sources).
- `react-docgen-typescript` writes `parent.fileName` and `declarations[].fileName` starting with the name of the
  build directory (`mui-harness/node_modules/@mui/material/...`, 323 times). A copy with another directory name gives
  another prefix.

The committed manifests were compared with the first builds of these sources (2026-11-10/11, in a directory named
`mui-c0`): apart from `durationMs`, the directory name and the absolute paths, the three files are identical.
`normalize-paths.mjs` expects POSIX paths; it has not been run on Windows.

## `mui.mappings.json` (hand-written configuration, not build output)

A mappings file for `mui-rdt-pass/`, written for this repository on 2026-11-12 (format: `docs/MAPPINGS.md`). It is the
only fixture written by hand. It changes no build output: the exporter reads it next to the build, with
`--supported-subset --mappings`.

| Entry | Verb | Backed by the manifest in `mui-rdt-pass/` |
|---|---|---|
| `Typography.children`, `Button.children`, `Chip.label` | `text` | type `ReactNode`, `required: false`, description "The content of the component." |
| `Button.startIcon`, `Button.endIcon` | `omit` | type `ReactNode`, `required: false`; "Element placed before/after the children." |
| `Button.loadingIndicator` | `omit` | type `ReactNode`, `required: false`; default `<CircularProgress color="inherit" size={16} />` |
| `Chip.children` | `omit` | type `null`, `required: false`; "This prop isn't supported." |

The exporter re-checks the type and the requiredness of every entry on each run. The reasons given for the four
omissions are this repository's own wording. `../golden/mui.catalog.json` and `../golden/mui-rdt-pass.report.mapped.json`
are what the exporter produced from the build and this file.
