# Mappings and renderer obligations

This document covers two things that belong together:

1. the **mappings file** (`--mappings`), which lets a developer export a component whose content the exporter would
   otherwise block, and
2. what a **renderer** must do to use the component definitions that result.

Both are opt-in. Without `--supported-subset` and `--mappings` the exporter's output is unchanged, byte for byte.

## Why a mappings file exists

Storybook metadata types React content as `ReactNode`. That type accepts a string, a number, an element, a list of
those, or nothing. A2UI v1.0 has no type that means "any of these", so the exporter blocks the component
(`PROJECTED_CONTENT_UNMAPPED`) instead of guessing.

A person who knows the component can make the choice the exporter cannot: "for this catalog, `children` of
`Typography` is text". The mappings file records that choice. The exporter then checks it against the metadata and
refuses any entry the metadata does not back, so a mapping can only **narrow** what the source accepts. It can never
give a property a type the source does not accept, rename it, or leave out something the source requires.

## Running it

```bash
node bin/storybook-a2ui.mjs export \
  --storybook test/fixtures/mui-rdt-pass \
  --catalog-id https://example.org/catalogs/material-ui/1 \
  --out out \
  --supported-subset --unmapped-events omit \
  --mappings test/fixtures/mui.mappings.json
```

`--mappings` needs `--supported-subset`; alone it stops with an error (exit code 2). The same holds for the library
API: `exportCatalog({ ..., supportedSubset: true, mappings })`, where `mappings` is a file path or the parsed object.

On the Material UI fixture (six components, `@mui/material` 9.5.0) this exports **Typography, Button and Chip**.
Alert, Switch and TextField stay blocked, each with its reasons in the report: they need element content (an icon, an
action button), which this version does not map.

## The file

```json
{
  "version": 1,
  "components": {
    "Typography": {
      "children": { "map": "text" }
    },
    "Chip": {
      "label": { "map": "text" },
      "children": { "map": "omit", "reason": "The source types it as null and documents it as not supported. Chip takes its content through label." }
    }
  }
}
```

`components` is keyed by component name, then by the property's name in the source. There are two verbs.

### `"map": "text"`

Exports the content as an A2UI text property: `common_types.json#/$defs/DynamicString`, the official A2UI v1.0 type.

- The property keeps **its own name** (`children`, `label`). Nothing is renamed.
- It keeps **the source requiredness**: required stays required, optional stays optional.
- It is allowed only where the metadata types the content as accepting a string. For React that is `ReactNode`
  (also written `React.ReactNode`, or `node` in PropTypes). A `ReactElement`, a render function, a property that is
  content by name only (Material UI types `Chip.children` as `null`), an ordinary string property, an event and any
  Angular input are all refused.
- A property named `id` or `component` cannot be mapped to text (A2UI reserves both names).

The result is narrower than the source: A2UI accepts a string where React accepts any node. The property's
description, the component's description and the report all say so.

### `"map": "omit"`

Leaves a property out of the A2UI component.

- It is allowed for a property the metadata marks `required: false`: content, an unsupported type, an inherited
  attribute, an optional `id` or `component`, or a property the exporter supports but the catalog should not offer.
- It is refused for a required property and for one whose requiredness the metadata does not state.
- It **never hides an error in the source metadata**. A property whose metadata the exporter cannot verify (a default
  that is invalid or cannot be read, for example) is refused, and without the entry it blocks its component as
  before. The fix belongs in the metadata, not in the mappings file.
- It **never gets around `--unmapped-events fail`**. An entry may name an event only when the run uses
  `--unmapped-events omit`; with `fail` (the default) the run stops. Under `omit` the event would be left out anyway,
  and the entry then only replaces the standard reason in the report with yours.
- `reason` is mandatory: at least 10 characters that tell a reviewer why. It is copied into the report.

A property left out cannot be set through A2UI, so the component always behaves as if it was not passed.

### What is checked

Every problem stops the run with exit code 2 and writes nothing. Messages start with `Invalid mappings:`.

| Check | Example message |
|---|---|
| File readable, valid JSON | `Mappings file is not valid JSON (...)` |
| `version` is `1` | `"version" must be 1 (found 2).` |
| Only known keys, objects where objects belong | `unknown key "mappings"; allowed: "version" and "components".` |
| Known verb | `Button.children has "map": "child"; supported: "text" and "omit".` |
| Component exists in the build(s) | `component "Buton" is not in the Storybook build(s). Components: ...` |
| Property is listed by the metadata | `Button.colour is not a property the Storybook metadata lists. Listed: ...` |
| `text`: source type accepts a string | `Button.icon cannot be mapped to text: the source metadata does not show that it accepts string content (source type: React.ReactElement). ...` |
| `omit`: source says `required: false` | `Button.label cannot be omitted: the source metadata marks it required.` |
| `omit`: no error in the property's metadata | `Button.tone cannot be omitted: its source metadata has an error, which a mapping must not hide (MANIFEST_ENTRY_INVALID: ...)` |
| `omit`: an event only with `--unmapped-events omit` | `Button.onClick cannot be omitted: it is an event, and events block under --unmapped-events fail. Pass --unmapped-events omit ...` |
| `omit`: a reason | `Button.startIcon needs a "reason" of at least 10 characters that says why the property is left out.` |

The checks run against every component of the build(s), before `--components` is applied. One file can therefore
serve several exports: an entry for a component that is in the build but not selected is checked and then unused. An
entry for a component that is in no build is an error, because it is most likely a typing mistake.

Names in the file are treated as data. A component or property called `constructor`, `toString` or `__proto__` is
looked up like any other name and never read from JavaScript's `Object.prototype`.

## Reserved names: `component` and `id`

A2UI v1.0 uses two names itself:

- `component` is the **discriminator**: `"component": "Typography"` says which catalog component an instance is.
- `id` is the **instance id** in the A2UI envelope, used to refer to the instance and to update it.

Many React components also have a property with one of these names (Material UI's polymorphic `component` property;
`id` on form controls). The source property cannot be exported under its own name, and the exporter does not rename.

In supported-subset mode an **optional** source property named `component` or `id` is therefore left out, whatever its
type, and disclosed: in `omittedKnown` with `kind: "reserved-name"`, in `sourceProperties` with disposition `omitted`,
and in the component's description. This is a rule of the mode, not of the mappings file, so it needs no entry.

It still blocks when the source marks the property **required**, when the metadata **does not say** whether it is
required, or when its metadata has an error. The blocker's message says which.

Leaving the property out does not change the React component: it renders as it does when the property is not passed.
What it requires of a renderer is the first obligation below.

## What the report records

- `policy.mappings`: `{ "version": 1, "file": "mui.mappings.json", "sha256": "..." }`. `file` is the base name only,
  never a directory. `sha256` is of the file's bytes (`shasum -a 256 <file>` gives the same value). When the library
  API is given an object instead of a path, `file` is `null` and the hash is of the object's JSON with sorted keys
  and no whitespace.
- `sourceProperties`, per component: every property the metadata lists, exactly once, with one disposition.

| Disposition | Meaning | In the catalog |
|---|---|---|
| `supported` | represented directly in A2UI | yes |
| `mapped` | represented through a reviewed mapping (`mapping: "text"`), narrower than the source | yes |
| `omitted` | deliberately left out, with the reason | no |
| `blocked` | prevents the export of its component | no |

- `omittedKnown`: each omission with its `kind`. `mapping` is an explicit `omit`, `reserved-name` the rule above,
  `property` an optional unsupported type, `event` and `dom-attribute` as before.
- The component's description in `catalog.json` names every mapped and omitted property, so an agent reading only
  the catalog sees that the interface is narrower than the React component.

## Renderer obligations

A renderer that follows these rules shows what the catalog describes. They are derived from the generated catalog and
the pinned A2UI v1.0 schemas (`spec/v1_0`). **They have not been tested against a renderer** (the exporter contains
none); the instance tests in `test/characterization.test.mjs` cover only what the catalog accepts and rejects.

1. **`component` and `id` belong to A2UI, never to the React component.** An instance arrives as the A2UI envelope
   (`id`, optionally `catalogId`, `accessibility`, `metadata`) together with the catalog component's properties,
   `component` among them. Use `component` to choose the React component and `id` to track the instance. Pass neither
   on as a property. A renderer that spreads the whole instance into the component would hand Material UI
   `component="Typography"`, which that library reads as the element type to render, and would set `id` to the A2UI
   instance id.

2. **Pass only the properties the catalog declares.** Build the properties from an allow-list: the keys of
   `catalog.components[<name>].properties`, without `component`. Every component has `additionalProperties: false`,
   so validating an incoming instance against the catalog rejects anything else. A property the description lists as
   left out (`sx`, `startIcon`, `onClick`, ...) is never set from what an agent sends.

3. **Resolve dynamic values before passing them.** A property declared with `DynamicString`, `DynamicBoolean` or
   `DynamicNumber` holds either a literal or a data binding, `{ "@path": "/json/pointer" }`. Resolve the binding
   against the surface's data model and pass the resulting value; render again when that value changes. This catalog
   defines no functions (`functions` is empty), so an agent has no catalog function to call. A property declared
   with `enum` (`variant`, `color`, `size`, `align`) takes a literal only.

4. **A mapped text property is plain text.** Pass the resolved string as the property of the same name (`children`
   for Typography and Button, `label` for Chip). Do not interpret it as Markdown or HTML and do not insert it as raw
   markup. If a binding resolves to something that is not a string, the catalog gives no rule: never pass an object,
   and treat a missing value as "property absent".

5. **A property that is absent is not passed.** The React component then uses its own default. The `default` values
   in the catalog are those defaults, read from the metadata; they describe the component and are not for the
   renderer to apply.

6. **There are no A2UI actions or callbacks.** Events have no reviewed A2UI mapping, so no component in the catalog
   can send anything to the agent: pressing an exported Button reports nothing, unless the host application adds
   behavior itself. The Material UI fixture does not even list `onClick` (see `test/fixtures/PROVENANCE.md`).
   That is not the same as "does nothing". `Button.href` is exported, and Material UI renders a Button that has an
   `href` as a link (an `a` element), so the browser **navigates** when it is pressed. Chip has no `href` in this
   catalog.

7. **Strings from an agent stay untrusted.** `className` and `Button.href` are ordinary string properties and are
   exported, so an agent chooses the URL a Button navigates to. A renderer must treat that URL as untrusted: check
   it before passing it on (for example allow only `https:` and relative URLs, never `javascript:`), or do not offer
   it at all. A host application that does not want an agent to choose these properties can leave them out with
   `"map": "omit"`.

## Limits of this version

- Text and omission only. A reference to another component (an icon in a button, an action in an alert) is not
  mapped; A2UI's `Child` and `ChildList` types are the likely target of a later version.
- No event or action mapping.
- React only in practice: the Angular adapter reports no content properties, and its real output never marks an
  input `required: false`, so neither verb has anything to apply to there.
- The check that a type "accepts a string" recognizes exactly `ReactNode`, `React.ReactNode` and `node`. A union
  that contains `ReactNode`, or an alias for it, is not recognized and is refused.
