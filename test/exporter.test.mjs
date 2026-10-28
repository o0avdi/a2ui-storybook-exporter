import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { exportCatalog } from '../src/export.mjs';
import { validateV1Export } from '../src/a2ui/validate.mjs';
import { makeCatalogV1 } from '../src/a2ui/catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REACT = path.join(here, 'fixtures/chromatic-react');
const ANGULAR = path.join(here, 'fixtures/angular-vite-spike');
const CLI = path.join(here, '../bin/storybook-a2ui.mjs');
const catalogId = 'https://example.org/catalogs/test/1';
const run = (options) => exportCatalog({ catalogId, ...options });
const component = (result, name) => result.report.components.find((item) => item.name === name);

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-export-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// ---- React manifest v0: real Chromatic Storybook output (genuinely external component)

test('React: the external Button is blocked by default because onClick has no reviewed mapping', () => {
  const result = run({ builds: [REACT], components: ['Button'] });
  assert.equal(result.ok, false);
  assert.equal(result.catalog, undefined);
  assert.deepEqual(component(result, 'Button').blocking.map((issue) => issue.code), ['UNMAPPED_EVENT']);
});

test('React: with explicit event omission Button exports exactly its documented properties', () => {
  const result = run({ builds: [REACT], components: ['Button'], unmappedEvents: 'omit' });
  assert.equal(result.ok, true);
  const button = result.catalog.components.Button;
  assert.deepEqual(Object.keys(button.properties).sort(), ['backgroundColor', 'component', 'label', 'primary', 'size']);
  assert.deepEqual(button.required, ['component', 'label']);
  assert.equal(button.properties.primary.default, false);
  assert.equal(button.properties.primary.$ref, 'common_types.json#/$defs/DynamicBoolean');
  assert.deepEqual(button.properties.size, { default: 'medium', description: 'How large should the button be?', enum: ['large', 'medium', 'small'], type: 'string' });
  assert.equal(button.properties.label.description, 'Button contents');
  assert.ok(!('onClick' in button.properties), 'unmapped event must not appear as a property');
  assert.match(button.description, /Events not exported \(no reviewed A2UI mapping\): onClick\./);
  assert.deepEqual(component(result, 'Button').omittedKnown.map((item) => [item.kind, item.name]), [['event', 'onClick']]);
  assert.equal(validateV1Export(result.catalog).valid, true);
});

test('React: object-typed props and empty prop surfaces stay blocked even when events are omitted', () => {
  const result = run({ builds: [REACT], unmappedEvents: 'omit' });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.catalog.components), ['Button']);
  assert.ok(component(result, 'Header').blocking.some((issue) => issue.code === 'UNSUPPORTED_PROP_TYPE' && issue.subject === 'user'));
  assert.ok(component(result, 'Page').blocking.some((issue) => issue.code === 'NO_EXPORTABLE_PROPS'));
});

// ---- Angular-Vite manifest v1: real @storybook/angular-vite 10.6.5 output (self-authored components)

test('Angular: ref-based v1 manifest is read; decorator and signal inputs both become properties', () => {
  const result = run({ builds: [ANGULAR], unmappedEvents: 'omit' });
  assert.equal(result.ok, true);
  for (const name of ['StatusBadgeComponent', 'StatusChipComponent']) {
    const schema = result.catalog.components[name];
    assert.deepEqual(Object.keys(schema.properties).sort(), ['compact', 'component', 'label', 'tone'], name);
    assert.deepEqual(schema.required, ['component', 'label'], name);
    assert.equal(schema.properties.compact.default, false);
    assert.deepEqual(schema.properties.tone.enum, ['info', 'success', 'warning']);
    assert.equal(schema.properties.tone.default, 'info');
    assert.match(schema.description, /Events not exported .*: dismissed\./);
  }
  assert.equal(component(result, 'StatusChipComponent').omittedKnown[0].name, 'dismissed');
});

test('Angular: outputs block by default, with the payload type from the manifest', () => {
  const result = run({ builds: [ANGULAR] });
  assert.equal(result.ok, false);
  assert.match(component(result, 'StatusChipComponent').blocking[0].message, /dismissed \(string\)/);
  assert.match(component(result, 'StatusBadgeComponent').blocking[0].message, /dismissed \(EventEmitter\)/);
});

// ---- Honest reporting: conversion of exposed metadata is not verification of the source contract

function mutatedReact(t, mutate) {
  const directory = path.join(temporary(t), 'build');
  fs.cpSync(REACT, directory, { recursive: true });
  const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const write = (name, json) => fs.writeFileSync(path.join(directory, name), JSON.stringify(json));
  mutate({ read, write });
  return directory;
}

test('Report: a successful export states that the source contract is not verified', () => {
  const result = run({ builds: [REACT], components: ['Button'], unmappedEvents: 'omit' });
  assert.match(result.report.notice, /source component contract is not verified/);
  assert.match(result.report.notice, /empty list is not proof/);
  assert.deepEqual(component(result, 'Button').contract, { basis: 'storybook-manifest', sourceContractVerified: false, inheritedAttributes: 'unknown', projectedContent: 'unknown' });
  assert.ok(!('omitted' in component(result, 'Button')), 'the old "omitted" key read as a completeness claim');
  assert.match(result.catalog.components.Button.description, /Properties listed by Storybook metadata only; inherited HTML\/DOM attributes and handlers are not part of this schema\./);
  assert.match(result.catalog.components.Button.description, /Projected content \(for example React children\) may be missing from Storybook metadata and is not described here\./);
  assert.match(result.report.notice, /projected content like React children/);
});

test('Report: projectedContent is "present" only on evidence (a listed children property), otherwise "unknown"', () => {
  // react-uswds Form lists `children` in docgen: evidence, and the component is blocked. GovBanner lists none: unknown.
  const { report } = run({ builds: [USWDS], catalogId: USWDS_ID });
  assert.equal(report.components.find((item) => item.name === 'Form').contract.projectedContent, 'present');
  for (const name of ['GovBanner', 'Collection']) {
    const entry = report.components.find((item) => item.name === name);
    assert.equal(entry.status, 'exported');
    assert.equal(entry.contract.projectedContent, 'unknown');
  }
});

test('Report: an empty omittedKnown (the GovBanner case) still reports inherited attributes as unknown', (t) => {
  // Same shape as react-uswds GovBanner: docgen lists only the declared props, nothing the exporter can see is omitted.
  const build = mutatedReact(t, ({ read, write }) => {
    const manifest = read('manifests/components.json');
    delete manifest.components['example-button'].reactDocgen.props.onClick;
    write('manifests/components.json', manifest);
  });
  const result = run({ builds: [build], components: ['Button'] });
  assert.equal(result.ok, true);
  assert.deepEqual(component(result, 'Button').omittedKnown, []);
  assert.equal(component(result, 'Button').contract.inheritedAttributes, 'unknown');
  assert.equal(component(result, 'Button').contract.sourceContractVerified, false);
  assert.match(result.catalog.components.Button.description, /not part of this schema/);
});

test('Report: an inherited attribute that docgen does list is recorded and marked present', (t) => {
  const build = mutatedReact(t, ({ read, write }) => {
    const manifest = read('manifests/components.json');
    manifest.components['example-button'].reactDocgen.props['aria-label'] = { required: false, tsType: { name: 'string' }, description: '' };
    write('manifests/components.json', manifest);
  });
  const result = run({ builds: [build], components: ['Button'], unmappedEvents: 'omit' });
  assert.equal(component(result, 'Button').contract.inheritedAttributes, 'present');
  assert.ok(component(result, 'Button').omittedKnown.some((item) => item.kind === 'dom-attribute' && item.name === 'aria-label'));
  assert.match(result.catalog.components.Button.description, /Inherited DOM attributes not exported: aria-label\./);
});

test('Identity: two story files sharing one Storybook id are reported as ambiguous', (t) => {
  // The react-uswds GovBanner / CustomBanner collision: same title, two files, one manifest entry.
  const build = mutatedReact(t, ({ read, write }) => {
    const index = read('index.json');
    index.entries['example-button--other'] = { type: 'story', id: 'example-button--other', name: 'Other', title: 'Example/Button',
      importPath: './src/stories/OtherButton.stories.tsx', tags: ['story'] };
    write('index.json', index);
  });
  const result = run({ builds: [build], components: ['Button'], unmappedEvents: 'omit' });
  assert.equal(result.ok, true, 'ambiguity is reported, it does not block');
  const [warning] = component(result, 'Button').warnings;
  assert.equal(warning.code, 'AMBIGUOUS_COMPONENT_ID');
  assert.match(warning.message, /example-button.*OtherButton\.stories\.tsx/);
  assert.deepEqual(component(run({ builds: [REACT], components: ['Button'], unmappedEvents: 'omit' }), 'Button').warnings, []);
});

test('Identity: warnings and the notice reach the CLI output', (t) => {
  const build = mutatedReact(t, ({ read, write }) => {
    const index = read('index.json');
    index.entries['example-button--other'] = { type: 'story', id: 'example-button--other', name: 'Other', title: 'Example/Button',
      importPath: './src/stories/OtherButton.stories.tsx', tags: ['story'] };
    write('index.json', index);
  });
  const inspect = spawnSync(process.execPath, [CLI, 'inspect', '--storybook', build, '--unmapped-events', 'omit'], { encoding: 'utf8' });
  assert.match(inspect.stdout, /WARNING AMBIGUOUS_COMPONENT_ID/);
  assert.match(inspect.stdout, /source component contract is not verified/);
});

test('Policy is unchanged: events still block by default', () => {
  assert.equal(run({ builds: [REACT], components: ['Button'] }).ok, false);
});

// ---- Mixed frameworks, determinism and safety

test('Mixed React and Angular builds produce one valid catalog, deterministically', (t) => {
  const first = run({ builds: [REACT, ANGULAR], components: ['Button', 'StatusBadgeComponent'], unmappedEvents: 'omit' });
  const second = run({ builds: [ANGULAR, REACT], components: ['Button', 'StatusBadgeComponent'], unmappedEvents: 'omit' });
  assert.deepEqual(Object.keys(first.catalog.components).sort(), ['Button', 'StatusBadgeComponent']);
  assert.equal(JSON.stringify(first.catalog), JSON.stringify(second.catalog), 'build order must not change the catalog');
  assert.equal(validateV1Export(first.catalog).valid, true);
});

test('An explicit selection is all-or-nothing and writes no output when anything is blocked', (t) => {
  const out = path.join(temporary(t), 'out');
  const result = run({ builds: [REACT], components: ['Button', 'Header'], unmappedEvents: 'omit', out });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(out), false);
});

test('A successful export writes only catalog.json and a timestamp-free report', (t) => {
  const out = path.join(temporary(t), 'out');
  run({ builds: [REACT], components: ['Button'], unmappedEvents: 'omit', out });
  assert.deepEqual(fs.readdirSync(out).sort(), ['catalog.json', 'export-report.json']);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'export-report.json'), 'utf8'));
  assert.equal(report.result, 'exported');
  assert.equal(report.builds[0].manifestVersion, 0);
  assert.match(report.builds[0].manifestSha256, /^[0-9a-f]{64}$/);
});

test('Unknown component names and bad catalog ids fail clearly', () => {
  assert.throws(() => run({ builds: [REACT], components: ['Nope'] }), /Unknown component\(s\): Nope/);
  assert.throws(() => run({ builds: [REACT], catalogId: 'urn:x:y' }), /Invalid --catalog-id/);
  assert.throws(() => run({ builds: [] }), /At least one Storybook build/);
});

// ---- Fail-closed behavior on shapes not present in real output (mutation tests; not success evidence)

function mutatedAngular(t, mutate) {
  const directory = path.join(temporary(t), 'build');
  fs.cpSync(ANGULAR, directory, { recursive: true });
  const file = path.join(directory, 'services/core/docgen/spike-statusbadge.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(json.components['spike-statusbadge'].argTypes);
  fs.writeFileSync(file, JSON.stringify(json));
  return directory;
}

test('Angular: an unsupported input type blocks the component instead of being dropped', (t) => {
  const build = mutatedAngular(t, (argTypes) => { argTypes.label.type = { name: 'other', value: 'Foo[]' }; });
  const result = run({ builds: [build], components: ['StatusBadgeComponent'], unmappedEvents: 'omit' });
  assert.equal(result.ok, false);
  assert.equal(component(result, 'StatusBadgeComponent').blocking[0].code, 'UNSUPPORTED_PROP_TYPE');
});

test('Angular: a string default with no verified encoding is refused, not guessed', (t) => {
  const build = mutatedAngular(t, (argTypes) => { argTypes.label.table.defaultValue = { summary: "'x'" }; });
  const result = run({ builds: [build], components: ['StatusBadgeComponent'], unmappedEvents: 'omit' });
  assert.equal(component(result, 'StatusBadgeComponent').blocking[0].code, 'UNSUPPORTED_DEFAULT');
});

test('Angular: an enum default that is not a declared value is refused', (t) => {
  const build = mutatedAngular(t, (argTypes) => { argTypes.tone.table.defaultValue = { summary: 'danger' }; });
  const result = run({ builds: [build], components: ['StatusBadgeComponent'], unmappedEvents: 'omit' });
  assert.equal(component(result, 'StatusBadgeComponent').blocking[0].code, 'UNSUPPORTED_DEFAULT');
});

test('Angular: a manifest reference that escapes the build directory is rejected', (t) => {
  const directory = path.join(temporary(t), 'build');
  fs.cpSync(ANGULAR, directory, { recursive: true });
  const file = path.join(directory, 'manifests/components.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.components['spike-statusbadge'].docgen.$ref = '../../outside.json#/x';
  fs.writeFileSync(file, JSON.stringify(json));
  const result = run({ builds: [directory], components: ['StatusBadgeComponent'], unmappedEvents: 'omit' });
  assert.match(component(result, 'StatusBadgeComponent').blocking[0].message, /escapes the Storybook build directory/);
});

test('Angular: a symbolic link inside the build cannot make a manifest reference read a file outside it', (t) => {
  const root = temporary(t);
  const build = path.join(root, 'build');
  fs.cpSync(ANGULAR, build, { recursive: true });
  const badge = (directory) => component(run({ builds: [directory], components: ['StatusBadgeComponent'], unmappedEvents: 'omit' }), 'StatusBadgeComponent');
  // Move the referenced files outside the build and leave only a link to them inside it.
  fs.mkdirSync(path.join(root, 'outside'));
  fs.renameSync(path.join(build, 'services'), path.join(root, 'outside/services'));
  fs.symlinkSync(path.join(root, 'outside/services'), path.join(build, 'services'), 'dir');
  const blocked = badge(build);
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.blocking[0].message, /escapes the Storybook build directory through a symbolic link/);
  // A link that stays inside the build is fine, and so is a build directory that is itself reached through a link.
  fs.rmSync(path.join(build, 'services'));
  fs.cpSync(path.join(root, 'outside/services'), path.join(build, 'real-services'), { recursive: true });
  fs.symlinkSync(path.join(build, 'real-services'), path.join(build, 'services'), 'dir');
  assert.equal(badge(build).status, 'exported');
  const linked = path.join(root, 'linked-build');
  fs.symlinkSync(build, linked, 'dir');
  assert.equal(badge(linked).status, 'exported');
});

test('Stories listed by the manifest but absent from the Storybook index block the component', (t) => {
  const directory = path.join(temporary(t), 'build');
  fs.cpSync(REACT, directory, { recursive: true });
  const index = JSON.parse(fs.readFileSync(path.join(directory, 'index.json'), 'utf8'));
  delete index.entries['example-button--primary'];
  fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index));
  const result = run({ builds: [directory], components: ['Button'], unmappedEvents: 'omit' });
  assert.equal(component(result, 'Button').blocking[0].code, 'INDEX_MISMATCH');
});

test('Unsupported manifest formats and index versions fail with a clear error', (t) => {
  const directory = path.join(temporary(t), 'build');
  fs.cpSync(REACT, directory, { recursive: true });
  const file = path.join(directory, 'manifests/components.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.v = 7;
  fs.writeFileSync(file, JSON.stringify(json));
  assert.throws(() => run({ builds: [directory] }), /Unsupported components manifest format/);
  fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify({ v: 4, entries: {} }));
  assert.throws(() => run({ builds: [directory] }), /Unsupported Storybook index/);
});

test('CLI: inspect exits 0 and export exits 1 with nothing written when the policy blocks everything', (t) => {
  const out = path.join(temporary(t), 'out');
  const inspect = spawnSync(process.execPath, [CLI, 'inspect', '--storybook', REACT], { encoding: 'utf8' });
  assert.equal(inspect.status, 0);
  assert.match(inspect.stdout, /BLOCKED Button/);
  const blocked = spawnSync(process.execPath, [CLI, 'export', '--storybook', REACT, '--components', 'Button', '--catalog-id', catalogId, '--out', out], { encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.equal(fs.existsSync(out), false);
  const ok = spawnSync(process.execPath, [CLI, 'export', '--storybook', REACT, '--components', 'Button', '--unmapped-events', 'omit', '--catalog-id', catalogId, '--out', out], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(fs.existsSync(path.join(out, 'catalog.json')));
});

// ---- Release readiness: no component-specific logic, clear CLI errors

test('Generator: names from the capstone prototype get no special treatment', () => {
  const field = (name, schema, required) => ({ name, schema, required, descriptionOrigin: 'manifest' });
  const catalog = makeCatalogV1([
    { name: 'MaterialButton', framework: 'react', fields: [field('label', { type: 'string' }, false), field('amount', { type: ['number', 'string'] }, false)], required: [] },
    { name: 'FinanceMetricCard', framework: 'react', fields: [field('title', { type: 'string' }, true)], required: ['title'] },
  ], { catalogId });
  assert.deepEqual(validateV1Export(catalog).valid, true);
  assert.deepEqual(catalog.components.MaterialButton.required, ['component']);
  assert.deepEqual(catalog.components.FinanceMetricCard.required, ['component', 'title']);
  assert.equal(catalog.components.FinanceMetricCard.description, 'FinanceMetricCard component definition exported from react.');
  assert.match(catalog.components.MaterialButton.properties.amount.description, /^Dynamic value supporting/);
  assert.equal(catalog.title, 'React A2UI Catalog');
  assert.doesNotMatch(JSON.stringify(catalog), /finance and|Angular Material|MaterialCheckbox|executive/i);
  assert.throws(() => makeCatalogV1([{ name: 'A', fields: [field('x', { type: 'string' })] }]), /Invalid catalogId/);
});

test('A build without manifests/components.json explains the Storybook feature flag', (t) => {
  const directory = path.join(temporary(t), 'build');
  fs.cpSync(REACT, directory, { recursive: true });
  fs.rmSync(path.join(directory, 'manifests'), { recursive: true });
  assert.throws(() => run({ builds: [directory] }), (error) => /No components manifest found/.test(error.message) && /componentsManifest: true/.test(error.message) && /reactDocgen/.test(error.message));
  assert.throws(() => run({ builds: [path.join(directory, 'missing')] }), /build directory not found/);
  fs.rmSync(path.join(directory, 'index.json'));
  assert.throws(() => run({ builds: [directory] }), /no index\.json/);
});

test('CLI: --help, -h and --version succeed; unknown commands and a missing --catalog-id fail clearly', (t) => {
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  for (const args of [['--help'], ['-h'], ['help'], ['export', '--help'], ['inspect', '-h']]) {
    const result = cli(...args);
    assert.equal(result.status, 0, args.join(' '));
    assert.match(result.stdout, /Usage:/);
  }
  assert.match(cli('--version').stdout, /^\d+\.\d+\.\d+/);
  const unknown = cli('bogus');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command "bogus"/);
  const out = path.join(temporary(t), 'out');
  const missingId = cli('export', '--storybook', REACT, '--out', out);
  assert.equal(missingId.status, 2);
  assert.match(missingId.stderr, /--catalog-id/);
  assert.equal(fs.existsSync(out), false);
});

// ---- Names A2UI reserves block one component; they never abort the export or get renamed

function renamedButtonProp(t, to) {
  return mutatedReact(t, ({ read, write }) => {
    const manifest = read('manifests/components.json');
    const props = manifest.components['example-button'].reactDocgen.props;
    props[to] = props.label;
    delete props.label;
    write('manifests/components.json', manifest);
  });
}

test('Reserved property names (id, component) block that component with a named reason and are never renamed', (t) => {
  for (const reserved of ['id', 'component']) {
    const result = run({ builds: [renamedButtonProp(t, reserved)], unmappedEvents: 'omit' });
    const button = component(result, 'Button');
    assert.equal(button.status, 'blocked');
    assert.ok(button.blocking.some((issue) => issue.code === 'A2UI_RESERVED_NAME' && issue.subject === reserved), reserved);
    assert.deepEqual(button.properties, []);
    // Blocked, not aborted and not renamed: nothing else in this small build is exportable, so no catalog is produced.
    assert.equal(result.ok, false);
    assert.equal(result.catalog, undefined);
  }
});

test('Reserved or invalid component names block that component instead of aborting', (t) => {
  for (const name of ['Surface', 'Bad-Name']) {
    const directory = mutatedReact(t, ({ read, write }) => {
      const manifest = read('manifests/components.json');
      manifest.components['example-button'].name = name;
      manifest.components['example-button'].reactDocgen.displayName = name;
      write('manifests/components.json', manifest);
    });
    const result = run({ builds: [directory], unmappedEvents: 'omit' });
    const blocked = component(result, name);
    assert.equal(blocked.status, 'blocked', name);
    assert.ok(blocked.blocking.some((issue) => issue.code === 'A2UI_RESERVED_NAME'));
    assert.equal(result.ok, false);
  }
});

test('The pinned validator is unchanged: a catalog that does define an id property is still rejected', () => {
  const catalog = makeCatalogV1([{ name: 'Thing', framework: 'react', required: [],
    fields: [{ name: 'id', schema: { type: 'string' }, required: false, descriptionOrigin: 'manifest' }] }], { catalogId });
  assert.throws(() => validateV1Export(catalog), /envelope property 'id'/);
});

// ---- End to end: real react-uswds Storybook 10.6.3 build (see test/fixtures/PROVENANCE.md)

const USWDS = path.join(here, 'fixtures/react-uswds');
const GOLDEN = path.join(here, 'golden/govbanner.catalog.json');
const USWDS_ID = 'https://example.org/catalogs/react-uswds/govbanner';

test('E2E react-uswds: of 75 components GovBanner and Collection export under the default policy', () => {
  // Collection is {condensed?: boolean} & JSX.IntrinsicElements['ul'] and renders {children}; docgen hides
  // children, so it converts with one property. That is the hidden-contract risk the report's notice describes.
  const result = run({ builds: [USWDS], catalogId: USWDS_ID });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.catalog.components), ['Collection', 'GovBanner']);
  assert.equal(result.report.components.length, 75);
  assert.equal(result.report.components.filter((item) => item.status === 'blocked').length, 73);
  assert.equal(result.report.validation.valid, true);
});

test('E2E react-uswds: GovBanner matches the source contract for the two properties Storybook exposes', () => {
  // Source: GovBanner.tsx  type Language = 'english' | 'spanish'; type TLD = '.gov' | '.mil'; defaults 'english', '.gov'.
  const { catalog, report } = run({ builds: [USWDS], catalogId: USWDS_ID, components: ['GovBanner'] });
  const schema = catalog.components.GovBanner;
  assert.deepEqual(Object.keys(schema.properties).sort(), ['component', 'language', 'tld']);
  assert.deepEqual(schema.properties.language, { default: 'english', enum: ['english', 'spanish'], type: 'string' });
  assert.deepEqual(schema.properties.tld, { default: '.gov', enum: ['.gov', '.mil'], type: 'string' });
  assert.deepEqual(schema.required, ['component']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(catalog.catalogId, USWDS_ID);
  assert.equal(catalog.$id, USWDS_ID);
  assert.equal(new URL(catalog.catalogId).protocol, 'https:');
  // The honest part: nothing visible was omitted, yet the contract is not verified.
  const entry = report.components[0];
  assert.deepEqual(entry.omittedKnown, []);
  assert.deepEqual(entry.contract, { basis: 'storybook-manifest', sourceContractVerified: false, inheritedAttributes: 'unknown', projectedContent: 'unknown' });
  assert.match(schema.description, /inherited HTML\/DOM attributes and handlers are not part of this schema/);
  assert.deepEqual(entry.warnings.map((warning) => warning.code), ['AMBIGUOUS_COMPONENT_ID']);
  assert.match(entry.warnings[0].message, /components-banner.*CustomBanner\.stories\.tsx.*GovBanner\.stories\.tsx/);
});

test('E2E react-uswds: the CLI writes a catalog identical to the committed golden file', (t) => {
  const out = path.join(temporary(t), 'out');
  const cli = spawnSync(process.execPath, [CLI, 'export', '--storybook', USWDS, '--components', 'GovBanner', '--catalog-id', USWDS_ID, '--out', out], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /AMBIGUOUS_COMPONENT_ID/);
  assert.equal(fs.readFileSync(path.join(out, 'catalog.json'), 'utf8'), fs.readFileSync(GOLDEN, 'utf8'));
  assert.equal(validateV1Export(JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))).valid, true);
});

test('E2E react-uswds: callback-bearing and children-bearing components stay blocked', () => {
  const { report } = run({ builds: [USWDS], catalogId: USWDS_ID });
  const codes = new Set(report.components.flatMap((item) => item.blocking.map((issue) => issue.code)));
  assert.ok(codes.has('PROJECTED_CONTENT_UNMAPPED') && codes.has('UNMAPPED_EVENT') && codes.has('UNSUPPORTED_PROP_TYPE'));
});

test('E2E react-uswds, omit events: TimePicker (property "id") is blocked while the other eligible components still export', (t) => {
  const result = run({ builds: [USWDS], catalogId: USWDS_ID, unmappedEvents: 'omit' });
  assert.equal(result.ok, true);
  const timePicker = component(result, 'TimePicker');
  assert.equal(timePicker.status, 'blocked');
  assert.ok(timePicker.blocking.some((issue) => issue.code === 'A2UI_RESERVED_NAME' && issue.subject === 'id'));
  const exported = result.report.components.filter((item) => item.status === 'exported').map((item) => item.name).sort();
  assert.deepEqual(exported, ['Collection', 'GovBanner', 'NavDropDownButton', 'Pagination']);
  for (const schema of Object.values(result.catalog.components)) assert.ok(!('id' in schema.properties));
  assert.equal(result.report.validation.valid, true);
  const out = path.join(temporary(t), 'out');
  const cli = spawnSync(process.execPath, [CLI, 'export', '--storybook', USWDS, '--unmapped-events', 'omit', '--catalog-id', USWDS_ID, '--out', out], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.ok(fs.existsSync(path.join(out, 'catalog.json')));
});

test('E2E react-uswds: explicitly selecting TimePicker fails cleanly with exit 1 and writes nothing', (t) => {
  const out = path.join(temporary(t), 'out');
  const cli = spawnSync(process.execPath, [CLI, 'export', '--storybook', USWDS, '--components', 'TimePicker', '--unmapped-events', 'omit', '--catalog-id', USWDS_ID, '--out', out], { encoding: 'utf8' });
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /A2UI_RESERVED_NAME/);
  assert.equal(fs.existsSync(out), false);
  // A selection mixing a valid and an incompatible component is all-or-nothing as well.
  const mixed = run({ builds: [USWDS], components: ['GovBanner', 'TimePicker'], unmappedEvents: 'omit' });
  assert.equal(mixed.ok, false);
});
