# Third-party notices

`storybook-a2ui` is licensed under the Apache License 2.0 (see `LICENSE`). It includes or depends on the following
third-party material.

## Included in the npm package

### A2UI v1.0 specification schemas (`spec/v1_0/*.json`)

- Source: https://github.com/a2ui-project/a2ui, commit `059b8d34874f96c0395dbfe23e6cc8b41cdb0f87`
- License: Apache License 2.0 (the upstream `LICENSE` at that commit)
- The five JSON files are unmodified copies, byte-identical to upstream at that commit. They carry no copyright
  header and upstream has no `NOTICE` file at that commit. Details: `spec/v1_0/PROVENANCE.md`.

### Runtime dependency: `ajv` 8.20.0

Installed by npm, not bundled. `ajv` is MIT licensed (Copyright (c) 2015-2021 Evgeny Poberezkin); its own
dependencies (`fast-deep-equal`, `json-schema-traverse`, `require-from-string`: MIT; `fast-uri`: BSD-3-Clause)
ship their license files inside `node_modules`.

## In the repository only (not in the npm package)

### Test fixtures (`test/fixtures/`)

The fixtures are `storybook build` output (component names, property metadata, descriptions and story snippets), so
they contain text taken from the projects they were built from. See `test/fixtures/PROVENANCE.md` for exact sources.

- `react-uswds/`: built from https://github.com/trussworks/react-uswds at commit
  `0c6fab64c104dd04b0edcacb9d3c949c27abe013`, Apache License 2.0. The golden catalog in `test/golden/` is derived from it.
- `chromatic-react/`: built from https://github.com/chromaui/intro-storybook-react-template at commit
  `5cad2aa3f096ddd24fe24c62842e4e1d1a3958dd`, MIT License, Copyright (c) 2018 Chroma Software Inc. The full MIT
  license text is reproduced below.
- `angular-vite-spike/`: real `@storybook/angular-vite` output for two components written by this project's
  authors; no third-party component code.

The Storybook-generated files themselves are tool output; Storybook is MIT licensed.

#### MIT License text for `chromatic-react/`

```
The MIT License (MIT)

Copyright (c) 2018 Chroma Software Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
