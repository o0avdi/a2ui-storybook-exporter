# Fixture provenance

Both fixtures are **unmodified or minimally normalized copies of real `storybook build` output**. Nothing here
was written by hand to suit the exporter.

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
