import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { exportCatalog } from '../src/export.mjs';
import { createCatalogValidator, validateCatalogStructuralRules, validateV1Export } from '../src/a2ui/validate.mjs';
import { makeCatalogV1, sortDeterministic } from '../src/a2ui/catalog.mjs';

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
  const badge = (directory) => component(run({ builds: [directory], components: ['StatusBadgeComponent'], unmappedEvents: 'omit' }), 'StatusBadgeComponent');
  // A directory link. 'junction' makes a directory junction on Windows, where creating a symbolic link needs a privilege
  // (EPERM for an ordinary user); realpath still resolves it to its target. POSIX ignores the type and makes a symlink.
  const link = (target, at) => fs.symlinkSync(target, at, 'junction');
  const copy = (name) => { const dir = path.join(root, name); fs.cpSync(ANGULAR, dir, { recursive: true }); return dir; };
  // Move the referenced files outside the build and leave only a link to them inside it.
  const escaping = copy('escaping-build');
  fs.mkdirSync(path.join(root, 'outside'));
  fs.renameSync(path.join(escaping, 'services'), path.join(root, 'outside/services'));
  link(path.join(root, 'outside/services'), path.join(escaping, 'services'));
  const blocked = badge(escaping);
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.blocking[0].message, /escapes the Storybook build directory through a symbolic link/);
  // A link that stays inside the build is fine, and so is a build directory that is itself reached through a link.
  const build = copy('build');
  fs.renameSync(path.join(build, 'services'), path.join(build, 'real-services'));
  link(path.join(build, 'real-services'), path.join(build, 'services'));
  assert.equal(badge(build).status, 'exported');
  const linked = path.join(root, 'linked-build');
  link(build, linked);
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

test('CLI: a slow reader on a pipe still receives the complete output', async () => {
  // process.exit() used to truncate piped output at the 64 KB pipe buffer; `inspect` on react-uswds is ~150 KB.
  const args = [CLI, 'inspect', '--storybook', path.join(here, 'fixtures/react-uswds')];
  const expected = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.length;
  assert.ok(expected > 70000, 'the fixture output must exceed one pipe buffer for this test to mean anything');
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
  const closed = new Promise((resolve) => child.on('close', resolve));
  child.stdout.pause();
  let received = 0;
  child.stdout.on('data', (chunk) => { received += chunk.length; });
  await new Promise((resolve) => setTimeout(resolve, 400));
  child.stdout.resume();
  await closed;
  assert.equal(received, Buffer.byteLength(spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout));
});

// ---- Names A2UI reserves block one component; they never abort the export or get renamed

function renamedButtonProp(t, to) {
  return mutatedReact(t, ({ read, write }) => {
    const manifest = read('manifests/components.json');
    const props = manifest.components['example-button'].reactDocgen.props;
    Object.defineProperty(props, to, { value: props.label, enumerable: true, writable: true, configurable: true });
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

// ---- Names that exist on Object.prototype must never disappear or be misread by a plain JavaScript dictionary

const PROTOTYPE_NAMES = Object.getOwnPropertyNames(Object.prototype); // __proto__, constructor, toString, hasOwnProperty, ...
const INHERITED_PROPERTY_NAMES = PROTOTYPE_NAMES.filter((name) => name !== '__proto__');
const stringField = (name, required = false) => ({ name, schema: { type: 'string' }, required, descriptionOrigin: 'manifest' });
const thing = (extra = {}) => ({ name: 'Thing', framework: 'react', required: [], fields: [stringField('label')], ...extra });

// The catalog and the report must describe the same components and properties, and every required property must exist.
function assertCatalogMatchesReport(result) {
  const names = Object.getOwnPropertyNames(result.catalog.components).sort();
  const exported = result.report.components.filter((item) => item.status === 'exported');
  assert.deepEqual(exported.map((item) => item.name).sort(), names);
  assert.deepEqual(result.catalog.$defs.anyComponent.oneOf.map((item) => item.$ref).sort(), names.map((name) => `#/components/${name}`));
  for (const item of exported) {
    const schema = result.catalog.components[item.name];
    const properties = Object.getOwnPropertyNames(schema.properties).filter((name) => name !== 'component').sort();
    assert.deepEqual(properties, [...item.properties].sort(), item.name);
    for (const required of schema.required) assert.ok(Object.hasOwn(schema.properties, required), `${item.name}.${required} is required but not defined`);
  }
  assert.equal(result.report.validation.valid, true);
}

test('Generator: property names inherited from Object.prototype are emitted as real properties, never lost', () => {
  for (const name of INHERITED_PROPERTY_NAMES) {
    const catalog = makeCatalogV1([thing({ fields: [stringField(name, true), stringField('other')], required: [name] })], { catalogId });
    const schema = catalog.components.Thing;
    assert.deepEqual(Object.getOwnPropertyNames(schema.properties).sort(), ['component', 'other', name].sort(), name);
    assert.equal(schema.properties[name].$ref, 'common_types.json#/$defs/DynamicString', name);
    assert.deepEqual(schema.required, ['component', name], name);
    assert.equal(validateV1Export(catalog).valid, true, name);
    assert.ok(JSON.stringify(catalog).includes(`"${name}":{"$ref"`), `${name} survives serialization`);
  }
});

test('Generator: a property named __proto__ is rejected with a clear message instead of vanishing', () => {
  assert.throws(() => makeCatalogV1([thing({ fields: [stringField('__proto__', true)], required: ['__proto__'] })], { catalogId }),
    /property name "__proto__".*Thing/s);
});

test('Generator: a required property that is only inherited from Object.prototype is not treated as defined', () => {
  for (const name of INHERITED_PROPERTY_NAMES)
    assert.throws(() => makeCatalogV1([thing({ required: [name] })], { catalogId }), /not defined in component properties/, name);
});

test('Generator: event properties named like inherited keys are emitted, and __proto__ is rejected', () => {
  for (const name of INHERITED_PROPERTY_NAMES) {
    const catalog = makeCatalogV1([thing({ events: { onGo: name } })], { catalogId });
    assert.equal(catalog.components.Thing.properties[name].$ref, 'common_types.json#/$defs/Action', name);
  }
  assert.throws(() => makeCatalogV1([thing({ events: { onGo: '__proto__' } })], { catalogId }), /"__proto__"/);
});

test('Generator: component names that exist on Object.prototype are rejected with a clear message', () => {
  for (const name of PROTOTYPE_NAMES)
    assert.throws(() => makeCatalogV1([thing({ name })], { catalogId }), new RegExp(`Component name "${name}".*Object\\.prototype`, 's'), name);
});

test('Generator: deterministic sorting keeps an own "__proto__" key', () => {
  const sorted = sortDeterministic(JSON.parse('{"b":1,"__proto__":{"a":1},"a":{"__proto__":2}}'));
  assert.deepEqual(Object.getOwnPropertyNames(sorted), ['__proto__', 'a', 'b']);
  assert.deepEqual(Object.getOwnPropertyNames(sorted.a), ['__proto__']);
  assert.equal(Object.getPrototypeOf(sorted), Object.prototype);
});

test('Pipeline: a property named constructor, toString or hasOwnProperty exports, and catalog and report agree', (t) => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const result = run({ builds: [renamedButtonProp(t, name)], unmappedEvents: 'omit' });
    assert.equal(result.ok, true, name);
    const button = result.catalog.components.Button;
    assert.ok(Object.hasOwn(button.properties, name), `${name} must be a real property`);
    assert.deepEqual(button.required, ['component', name], name);
    assert.ok(component(result, 'Button').properties.includes(name), name);
    assertCatalogMatchesReport(result);
  }
});

test('Pipeline: a property named __proto__ blocks that component with a named reason and nothing is dropped or aborted', (t) => {
  const result = run({ builds: [renamedButtonProp(t, '__proto__')], unmappedEvents: 'omit' });
  const button = component(result, 'Button');
  assert.equal(button.status, 'blocked');
  assert.ok(button.blocking.some((issue) => issue.code === 'UNSAFE_NAME' && issue.subject === '__proto__' && /__proto__/.test(issue.message)));
  assert.deepEqual(button.properties, []);
  assert.equal(result.ok, false);
});

test('Pipeline: projected content named __proto__ is still seen and blocks the component', (t) => {
  const directory = mutatedReact(t, ({ read, write }) => {
    const manifest = read('manifests/components.json');
    const props = manifest.components['example-button'].reactDocgen.props;
    Object.defineProperty(props, '__proto__', { value: { required: false, tsType: { name: 'ReactNode' }, description: 'Hidden slot' }, enumerable: true, writable: true, configurable: true });
    write('manifests/components.json', manifest);
  });
  const button = component(run({ builds: [directory], unmappedEvents: 'omit' }), 'Button');
  assert.equal(button.status, 'blocked');
  assert.ok(button.blocking.some((issue) => issue.code === 'PROJECTED_CONTENT_UNMAPPED' && issue.subject === '__proto__'));
  assert.equal(button.contract.projectedContent, 'present');
});

test('Pipeline: a component named like an Object.prototype member is blocked, not aborting, and the rest still exports', (t) => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    const directory = path.join(temporary(t), 'build');
    fs.cpSync(USWDS, directory, { recursive: true });
    const file = path.join(directory, 'manifests/components.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entry = Object.values(manifest.components).find((item) => item.name === 'Collection');
    entry.name = name;
    entry.reactDocgen.displayName = name;
    fs.writeFileSync(file, JSON.stringify(manifest));
    const result = run({ builds: [directory], catalogId: USWDS_ID });
    const blocked = component(result, name);
    assert.equal(blocked.status, 'blocked', name);
    assert.ok(blocked.blocking.some((issue) => issue.code === 'UNSAFE_NAME' && issue.subject === name && /Object\.prototype/.test(issue.message)), name);
    assert.equal(result.ok, true, name);
    assert.deepEqual(Object.getOwnPropertyNames(result.catalog.components), ['GovBanner'], name);
    assertCatalogMatchesReport(result);
  }
});

// ---- A name that an object only inherits from Object.prototype is not a definition: not for the validator's own
// rules, and not for a manifest reference. `'toString' in {}` is true, `Object.hasOwn({}, 'toString')` is false.

// The messages of the exporter's own rules for a valid generated catalog that was changed in one place.
function ownRuleErrors(change) {
  const catalog = makeCatalogV1([thing()], { catalogId });
  change(catalog);
  return { catalog, reference: createCatalogValidator()(catalog).referenceErrors, structural: validateCatalogStructuralRules(catalog).errors };
}

test('Validator: a required property that exists only on Object.prototype is reported as missing', () => {
  for (const name of PROTOTYPE_NAMES) {
    const { catalog, reference, structural } = ownRuleErrors((changed) => changed.components.Thing.required.push(name));
    const message = `Component 'Thing' required property '${name}' does not exist in component properties.`;
    assert.ok(reference.includes(message), `reference check: ${name}`);
    assert.ok(structural.includes(message), `structural rules: ${name}`);
    assert.throws(() => validateV1Export(catalog), /catalog validation failed/, name);
  }
});

test('Validator: a $ref to a common type that exists only on Object.prototype is unresolved', () => {
  for (const name of PROTOTYPE_NAMES) {
    const ref = `common_types.json#/$defs/${name}`;
    const { catalog, reference } = ownRuleErrors((changed) => { changed.components.Thing.properties.label = { $ref: ref }; });
    assert.ok(reference.includes(`Unresolved external reference '${ref}' at components.Thing.properties.label: '${name}' is not defined in common_types.json.`), name);
    assert.throws(() => validateV1Export(catalog), /catalog validation failed/, name);
  }
});

test('Validator: an internal $ref through a name that exists only on Object.prototype is unresolved', () => {
  for (const name of PROTOTYPE_NAMES) {
    for (const ref of [`#/components/${name}`, `#/components/Thing/properties/${name}`]) {
      const { catalog, reference } = ownRuleErrors((changed) => { changed.components.Thing.properties.label = { $ref: ref }; });
      assert.ok(reference.includes(`Unresolved internal reference '${ref}' at components.Thing.properties.label.`), ref);
      assert.throws(() => validateV1Export(catalog), /catalog validation failed/, ref);
    }
  }
  // A key or an array position that the catalog really contains still resolves.
  for (const ref of ['#/components/Thing/properties/component', '#/$defs/anyComponent/oneOf/0']) {
    const { catalog, reference } = ownRuleErrors((changed) => { changed.components.Thing.properties.label = { $ref: ref }; });
    assert.deepEqual(reference, [], ref);
    assert.equal(validateV1Export(catalog).valid, true, ref);
  }
});

test('Validator: anyComponent and anyFunction cannot list a component or function that exists only on Object.prototype', () => {
  for (const name of PROTOTYPE_NAMES) {
    const { catalog, reference } = ownRuleErrors((changed) => {
      changed.$defs.anyComponent.oneOf.push({ $ref: `#/components/${name}` });
      // The function has the shape of `required` in the official basic catalog.
      changed.functions = { required: { type: 'object', returnType: 'validationResult', properties: { '@call': { const: 'required' } }, required: ['@call'] } };
      changed.$defs.anyFunction = { oneOf: [{ $ref: '#/functions/required' }, { $ref: `#/functions/${name}` }] };
    });
    assert.ok(reference.includes(`$defs.anyComponent.oneOf references non-existent component '${name}'.`), `component ${name}`);
    assert.ok(reference.includes(`$defs.anyFunction.oneOf references non-existent function '${name}'.`), `function ${name}`);
    assert.throws(() => validateV1Export(catalog), /catalog validation failed/, name);
  }
});

test('Angular: a manifest reference through a name that exists only on Object.prototype does not resolve', (t) => {
  const DOCGEN = 'services/core/docgen/spike-statusbadge.json';
  // The status badge of a copy of the build whose docgen (or stories) reference ends in `pointer`.
  const badge = (kind, pointer, editDocgen = (json) => json) => {
    const directory = path.join(temporary(t), 'build');
    fs.cpSync(ANGULAR, directory, { recursive: true });
    const file = path.join(directory, 'manifests/components.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const [target] = manifest.components['spike-statusbadge'][kind].$ref.split('#');
    manifest.components['spike-statusbadge'][kind].$ref = `${target}#${pointer}`;
    fs.writeFileSync(file, JSON.stringify(manifest));
    const docgen = path.join(directory, DOCGEN);
    fs.writeFileSync(docgen, JSON.stringify(editDocgen(JSON.parse(fs.readFileSync(docgen, 'utf8')))));
    return component(run({ builds: [directory], components: ['StatusBadgeComponent'], unmappedEvents: 'omit' }), 'StatusBadgeComponent');
  };
  for (const [kind, pointer, missing] of [
    ['docgen', '/constructor', 'constructor'],
    ['docgen', '/components/toString', 'toString'],
    ['docgen', '/__proto__/hasOwnProperty', '__proto__'],
    ['stories', '/components/valueOf', 'valueOf'],
  ]) {
    const blocked = badge(kind, pointer);
    assert.equal(blocked.status, 'blocked', pointer);
    const invalid = blocked.blocking.filter((issue) => issue.code === 'MANIFEST_ENTRY_INVALID');
    assert.equal(invalid.length, 1, pointer);
    assert.ok(invalid[0].message.endsWith(`#${pointer} does not resolve (missing "${missing}").`), invalid[0].message);
  }
  // A key with such a name that the referenced file really contains is ordinary data and still resolves.
  const exported = badge('docgen', '/constructor/spike-statusbadge', (json) => JSON.parse(`{"constructor":${JSON.stringify(json.components)}}`));
  assert.equal(exported.status, 'exported');
  assert.deepEqual(exported.properties, ['compact', 'label', 'tone']);
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

// ---- Supported-subset mode (opt-in): an unsupported property is left out only when the source says required: false

const MUI = path.join(here, 'fixtures/mui-rdt-pass');
const OBJECT_TYPE = { name: 'signature', type: 'object', raw: '{ dark: boolean }', signature: { properties: [{ key: 'dark', value: { name: 'boolean', required: true } }] } };
const sourceProperty = (entry, name) => entry.sourceProperties.filter((item) => item.name === name);

// The external Button with extra properties in its docgen. `props` maps a property name to its docgen entry.
function buttonWith(t, props) {
  return mutatedReact(t, ({ read, write }) => {
    const manifest = read('manifests/components.json');
    Object.assign(manifest.components['example-button'].reactDocgen.props, props);
    write('manifests/components.json', manifest);
  });
}

test('Subset: an unsupported property with required: false is left out, recorded with its type and disclosed', (t) => {
  const build = buttonWith(t, { theme: { required: false, tsType: OBJECT_TYPE, description: '' } });
  const options = { builds: [build], components: ['Button'], unmappedEvents: 'omit' };

  // Without the option nothing changes: the property blocks, and the report has no new keys.
  const strict = run(options);
  assert.equal(strict.ok, false);
  assert.deepEqual(component(strict, 'Button').blocking.map((issue) => [issue.code, issue.subject]), [['UNSUPPORTED_PROP_TYPE', 'theme']]);
  assert.deepEqual(strict.report.policy, { unmappedEvents: 'omit' });
  assert.ok(!('sourceProperties' in component(strict, 'Button')));

  const result = run({ ...options, supportedSubset: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.report.policy, { unmappedEvents: 'omit', supportedSubset: true });
  const schema = result.catalog.components.Button;
  assert.deepEqual(Object.keys(schema.properties).sort(), ['backgroundColor', 'component', 'label', 'primary', 'size']);
  assert.deepEqual(schema.required, ['component', 'label']);
  assert.match(schema.description, /Narrower interface than the source component: these optional properties have types this exporter does not represent in A2UI and are not exported: theme\./);
  assert.equal(validateV1Export(result.catalog).valid, true);

  const entry = component(result, 'Button');
  assert.equal(entry.status, 'exported');
  assert.deepEqual(entry.properties, ['primary', 'backgroundColor', 'size', 'label']);
  assert.deepEqual(entry.omittedKnown.map((item) => [item.kind, item.name]), [['property', 'theme'], ['event', 'onClick']]);
  assert.match(entry.omittedKnown[0].reason, /Unsupported type '\{ dark: boolean \}'/);
  assert.match(entry.omittedKnown[0].reason, /required: false/);
  assert.deepEqual(entry.sourceProperties.map((item) => [item.name, item.sourceType, item.requiredness, item.disposition]), [
    ['primary', 'boolean', 'optional', 'supported'],
    ['backgroundColor', 'string', 'optional', 'supported'],
    ['size', '"small" | "medium" | "large"', 'optional', 'supported'],
    ['label', 'string', 'required', 'supported'],
    ['onClick', '() => void', 'optional', 'omitted'],
    ['theme', '{ dark: boolean }', 'optional', 'omitted'],
  ]);
  assert.equal(sourceProperty(entry, 'theme')[0].reason, entry.omittedKnown[0].reason);
  assert.ok(!('reason' in sourceProperty(entry, 'label')[0]), 'a supported property needs no reason');
  assert.match(result.report.notice, /sourceProperties/);
  assert.throws(() => run({ ...options, supportedSubset: 'yes' }), /supportedSubset must be true or false/);
});

test('Subset: an unsupported property that is required still blocks the component', (t) => {
  const build = buttonWith(t, { theme: { required: true, tsType: OBJECT_TYPE, description: '' } });
  const result = run({ builds: [build], components: ['Button'], unmappedEvents: 'omit', supportedSubset: true });
  assert.equal(result.ok, false);
  assert.equal(result.catalog, undefined);
  const entry = component(result, 'Button');
  assert.deepEqual(entry.blocking.map((issue) => [issue.code, issue.subject]), [['UNSUPPORTED_PROP_TYPE', 'theme']]);
  assert.match(entry.blocking[0].message, /Supported-subset mode does not omit it: the source metadata marks it required\./);
  assert.ok(!entry.omittedKnown.some((item) => item.name === 'theme'));
  assert.deepEqual(sourceProperty(entry, 'theme').map((item) => [item.requiredness, item.disposition]), [['required', 'blocked']]);
  assert.match(sourceProperty(entry, 'theme')[0].reason, /^UNSUPPORTED_PROP_TYPE: theme: /);
});

test('Subset: an unsupported property with unknown requiredness still blocks; a missing or non-boolean "required" is not "optional"', (t) => {
  for (const [label, required] of [['key absent', undefined], ['string "false"', 'false'], ['null', null], ['0', 0]]) {
    const theme = { tsType: OBJECT_TYPE, description: '' };
    if (required !== undefined) theme.required = required;
    const result = run({ builds: [buttonWith(t, { theme })], components: ['Button'], unmappedEvents: 'omit', supportedSubset: true });
    assert.equal(result.ok, false, label);
    const entry = component(result, 'Button');
    assert.deepEqual(entry.blocking.map((issue) => [issue.code, issue.subject]), [['UNSUPPORTED_PROP_TYPE', 'theme']], label);
    assert.match(entry.blocking[0].message, /Supported-subset mode does not omit it: the source metadata does not say whether it is required\./, label);
    assert.deepEqual(sourceProperty(entry, 'theme').map((item) => [item.requiredness, item.disposition]), [['unknown', 'blocked']], label);
  }
});

test('Subset: content, events, reserved names and metadata errors are never omitted, even when optional', (t) => {
  const build = buttonWith(t, {
    children: { required: false, tsType: { name: 'ReactNode' }, description: '' },                       // projected content
    id: { required: false, tsType: { name: 'string' }, description: '' },                                // reserved, supported type
    component: { required: false, tsType: OBJECT_TYPE, description: '' },                                // reserved, unsupported type
    tone: { required: false, tsType: { name: 'string' }, description: '', defaultValue: { value: 'pick()', computed: false } },  // unverifiable default
  });
  const result = run({ builds: [build], components: ['Button'], supportedSubset: true });
  assert.equal(result.ok, false);
  const entry = component(result, 'Button');
  assert.deepEqual(entry.blocking.map((issue) => [issue.code, issue.subject]).sort(), [
    ['A2UI_RESERVED_NAME', 'id'], ['MANIFEST_ENTRY_INVALID', 'tone'], ['PROJECTED_CONTENT_UNMAPPED', 'children'],
    ['UNMAPPED_EVENT', 'onClick'], ['UNSUPPORTED_PROP_TYPE', 'component'],
  ]);
  assert.match(entry.blocking.find((issue) => issue.subject === 'component').message, /does not omit it: "component" is a name A2UI reserves/);
  assert.deepEqual(entry.omittedKnown, []);
  for (const name of ['children', 'id', 'component', 'tone', 'onClick'])
    assert.deepEqual(sourceProperty(entry, name).map((item) => [item.requiredness, item.disposition]), [['optional', 'blocked']], name);
  assert.equal(sourceProperty(entry, 'id')[0].reason.startsWith('A2UI_RESERVED_NAME: '), true);
  // The four original supported properties are not blocked themselves; the component is.
  assert.deepEqual(entry.sourceProperties.filter((item) => item.disposition === 'supported').map((item) => item.name), ['primary', 'backgroundColor', 'size', 'label']);
  assert.equal(entry.status, 'blocked');
  assert.deepEqual(entry.properties, []);
});

test('Subset: leaving properties out never produces an empty component (the external Header)', () => {
  // Header lists an optional object property and three callbacks. With both omissions nothing is left to export.
  const result = run({ builds: [REACT], unmappedEvents: 'omit', supportedSubset: true });
  const header = component(result, 'Header');
  assert.equal(header.status, 'blocked');
  assert.deepEqual(header.blocking.map((issue) => issue.code), ['NO_EXPORTABLE_PROPS']);
  assert.deepEqual(header.sourceProperties.map((item) => [item.name, item.disposition]), [['user', 'omitted'], ['onLogin', 'omitted'], ['onLogout', 'omitted'], ['onCreateAccount', 'omitted']]);
  assert.deepEqual(Object.keys(result.catalog.components), ['Button']);
});

test('Subset, Angular: an input is omitted only when type.required is false; an absent key is unknown requiredness', (t) => {
  // Real @storybook/angular-vite output has no "required" key on an optional input, so this mode omits nothing there.
  const options = { components: ['StatusBadgeComponent'], unmappedEvents: 'omit', supportedSubset: true };
  const unknown = run({ ...options, builds: [mutatedAngular(t, (argTypes) => { argTypes.compact.type = { name: 'other', value: 'Foo[]' }; argTypes.compact.table.type.summary = 'Foo[]'; delete argTypes.compact.table.defaultValue; })] });
  assert.equal(unknown.ok, false);
  const blocked = component(unknown, 'StatusBadgeComponent');
  assert.match(blocked.blocking[0].message, /does not omit it: the source metadata does not say whether it is required\./);
  assert.deepEqual(sourceProperty(blocked, 'compact').map((item) => [item.sourceType, item.requiredness, item.disposition]), [['Foo[]', 'unknown', 'blocked']]);

  const optional = run({ ...options, builds: [mutatedAngular(t, (argTypes) => { argTypes.compact.type = { name: 'other', value: 'Foo[]', required: false }; argTypes.compact.table.type.summary = 'Foo[]'; delete argTypes.compact.table.defaultValue; })] });
  assert.equal(optional.ok, true);
  const exported = component(optional, 'StatusBadgeComponent');
  assert.deepEqual(exported.sourceProperties.map((item) => [item.name, item.sourceType, item.requiredness, item.disposition]), [
    ['compact', 'Foo[]', 'optional', 'omitted'], ['label', 'string', 'required', 'supported'],
    ['tone', '"info" | "success" | "warning"', 'unknown', 'supported'], ['dismissed', 'EventEmitter', 'unknown', 'omitted'],
  ]);
  assert.deepEqual(Object.keys(optional.catalog.components.StatusBadgeComponent.properties).sort(), ['component', 'label', 'tone']);
  assert.match(optional.catalog.components.StatusBadgeComponent.description, /are not exported: compact\./);
});

test('Subset: every source property of every fixture is accounted for exactly once, under both event policies', () => {
  // The expected names are read from the manifests here, without the exporter.
  const reactProps = (build) => Object.fromEntries(Object.values(JSON.parse(fs.readFileSync(path.join(build, 'manifests/components.json'), 'utf8')).components)
    .map((entry) => [entry.id, Object.keys((entry.reactDocgenTypescript ?? entry.reactDocgen)?.props ?? {})]));
  const angularProps = { 'spike-statusbadge': ['compact', 'label', 'tone', 'dismissed'], 'spike-statuschip': ['compact', 'label', 'tone', 'dismissed'] };
  let total = 0;
  for (const [build, expected] of [[REACT, reactProps(REACT)], [USWDS, reactProps(USWDS)], [MUI, reactProps(MUI)], [ANGULAR, angularProps]]) {
    for (const unmappedEvents of ['fail', 'omit']) {
      const { report } = run({ builds: [build], unmappedEvents, supportedSubset: true });
      assert.deepEqual(report.components.map((entry) => entry.id).sort(), Object.keys(expected).sort());
      for (const entry of report.components) {
        const where = `${path.basename(build)} ${entry.name} (${unmappedEvents})`;
        const of = (disposition) => entry.sourceProperties.filter((item) => item.disposition === disposition).map((item) => item.name);
        assert.deepEqual(entry.sourceProperties.map((item) => item.name), expected[entry.id], where);
        assert.equal(new Set(expected[entry.id]).size, expected[entry.id].length, where);
        for (const item of entry.sourceProperties) {
          assert.ok(['supported', 'omitted', 'blocked'].includes(item.disposition), where);
          assert.ok(['required', 'optional', 'unknown'].includes(item.requiredness), where);
          assert.equal(typeof item.reason, item.disposition === 'supported' ? 'undefined' : 'string', `${where} ${item.name}`);
        }
        // The three lists agree with the rest of the entry: nothing is counted twice or left out.
        assert.deepEqual(of('omitted').sort(), entry.omittedKnown.map((item) => item.name).sort(), where);
        for (const name of of('blocked')) assert.ok(entry.blocking.some((issue) => issue.subject === name), `${where} ${name}`);
        if (entry.status === 'exported') {
          assert.deepEqual(of('blocked'), [], where);
          assert.deepEqual(of('supported'), entry.properties, where);
        }
        total += entry.sourceProperties.length;
      }
    }
  }
  assert.equal(total, 2 * (5 + 4 + 0 + 305 + 156 + 8));
});

test('Subset, CLI: --supported-subset is off unless given, and reaches the printed report and export-report.json', (t) => {
  const build = buttonWith(t, { theme: { required: false, tsType: OBJECT_TYPE, description: '' } });
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  const strict = cli('inspect', '--storybook', build, '--unmapped-events', 'omit');
  assert.match(strict.stdout, /BLOCKED Button/);
  assert.doesNotMatch(strict.stdout, /source properties|not exported \(property\)/);
  const inspect = cli('inspect', '--storybook', build, '--unmapped-events', 'omit', '--supported-subset');
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.match(inspect.stdout, /OK +Button \[react\] properties: primary, backgroundColor, size, label/);
  assert.match(inspect.stdout, /not exported \(property\): theme/);
  assert.match(inspect.stdout, /source properties: 4 supported, 2 omitted, 0 blocked/);
  const out = path.join(temporary(t), 'out');
  const exported = cli('export', '--storybook', build, '--components', 'Button', '--unmapped-events', 'omit', '--supported-subset', '--catalog-id', catalogId, '--out', out);
  assert.equal(exported.status, 0, exported.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'export-report.json'), 'utf8'));
  assert.equal(report.policy.supportedSubset, true);
  assert.equal(report.components[0].sourceProperties.length, 6);
  assert.ok(!('theme' in JSON.parse(fs.readFileSync(path.join(out, 'catalog.json'), 'utf8')).components.Button.properties));
  assert.match(cli('--help').stdout, /--supported-subset/);
});
