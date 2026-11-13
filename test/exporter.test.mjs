import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { exportCatalog } from '../src/export.mjs';
import { evaluate } from '../src/contract.mjs';
import { readReactV0 } from '../src/adapters/react-v0.mjs';
import { createCatalogValidator, createComponentInstanceValidator, validateCatalogStructuralRules, validateV1Export } from '../src/a2ui/validate.mjs';
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

test('Subset: content, events and metadata errors are never omitted, even when optional', (t) => {
  const build = buttonWith(t, {
    children: { required: false, tsType: { name: 'ReactNode' }, description: '' },                       // projected content
    tone: { required: false, tsType: { name: 'string' }, description: '', defaultValue: { value: 'pick()', computed: false } },  // unverifiable default
  });
  const result = run({ builds: [build], components: ['Button'], supportedSubset: true });
  assert.equal(result.ok, false);
  const entry = component(result, 'Button');
  assert.deepEqual(entry.blocking.map((issue) => [issue.code, issue.subject]).sort(), [
    ['MANIFEST_ENTRY_INVALID', 'tone'], ['PROJECTED_CONTENT_UNMAPPED', 'children'], ['UNMAPPED_EVENT', 'onClick'],
  ]);
  assert.deepEqual(entry.omittedKnown, []);
  for (const name of ['children', 'tone', 'onClick'])
    assert.deepEqual(sourceProperty(entry, name).map((item) => [item.requiredness, item.disposition]), [['optional', 'blocked']], name);
  // The four original supported properties are not blocked themselves; the component is.
  assert.deepEqual(entry.sourceProperties.filter((item) => item.disposition === 'supported').map((item) => item.name), ['primary', 'backgroundColor', 'size', 'label']);
  assert.equal(entry.status, 'blocked');
  assert.deepEqual(entry.properties, []);
});

// ---- Supported-subset mode: an optional source property named "id" or "component" is left out and disclosed (C2).
// A2UI uses both names itself, so the property cannot be exported. Required or unknown requiredness still blocks.

const STRING = { name: 'string' };

test('Subset: an optional property named id or component is left out and disclosed, whatever its type', (t) => {
  const build = buttonWith(t, {
    id: { required: false, tsType: STRING, description: '' },             // a type the exporter supports
    component: { required: false, tsType: OBJECT_TYPE, description: '' },  // a type it does not
  });
  const options = { builds: [build], components: ['Button'], unmappedEvents: 'omit' };

  // Without the mode both still block, exactly as before.
  const strict = component(run(options), 'Button');
  assert.deepEqual(strict.blocking.map((issue) => [issue.code, issue.subject]).sort(), [['A2UI_RESERVED_NAME', 'id'], ['UNSUPPORTED_PROP_TYPE', 'component']]);
  assert.match(strict.blocking.find((issue) => issue.subject === 'id').message, /This exporter does not rename or drop properties\.$/);

  const result = run({ ...options, supportedSubset: true });
  assert.equal(result.ok, true);
  const entry = component(result, 'Button');
  assert.deepEqual(entry.blocking, []);
  assert.deepEqual(entry.properties, ['primary', 'backgroundColor', 'size', 'label']);
  assert.deepEqual(entry.omittedKnown.map((item) => [item.kind, item.name]), [['reserved-name', 'id'], ['reserved-name', 'component'], ['event', 'onClick']]);
  for (const name of ['id', 'component']) {
    const [item] = sourceProperty(entry, name);
    assert.deepEqual([item.requiredness, item.disposition], ['optional', 'omitted'], name);
    assert.match(item.reason, new RegExp(`^Property "${name}" is not exported: '${name}' `), name);
    assert.match(item.reason, /required: false/, name);
    assert.match(item.reason, new RegExp(`A renderer must never pass the A2UI "${name}" of an instance to the source component as this property\\.$`), name);
  }
  // In the catalog "component" is only the A2UI discriminator, and there is no "id" property.
  const schema = result.catalog.components.Button;
  assert.deepEqual(Object.keys(schema.properties).sort(), ['backgroundColor', 'component', 'label', 'primary', 'size']);
  assert.deepEqual(schema.properties.component, { const: 'Button' });
  assert.match(schema.description, /Optional source properties with a name A2UI reserves are not exported: id, component\. The A2UI "component" and "id" of an instance are never passed to the source component as these properties\./);
  assert.equal(validateV1Export(result.catalog).valid, true);
});

test('Subset: a property named id or component that is required, or whose requiredness is unknown, still blocks', (t) => {
  for (const [label, required, why] of [['required', true, 'the source metadata marks it required'], ['key absent', undefined, 'the source metadata does not say whether it is required']]) {
    const props = { id: { tsType: STRING, description: '' }, component: { tsType: OBJECT_TYPE, description: '' } };
    if (required !== undefined) for (const prop of Object.values(props)) prop.required = required;
    const result = run({ builds: [buttonWith(t, props)], components: ['Button'], unmappedEvents: 'omit', supportedSubset: true });
    assert.equal(result.ok, false, label);
    const entry = component(result, 'Button');
    assert.deepEqual(entry.blocking.map((issue) => [issue.code, issue.subject]).sort(), [['A2UI_RESERVED_NAME', 'id'], ['UNSUPPORTED_PROP_TYPE', 'component']], label);
    for (const issue of entry.blocking) assert.ok(issue.message.endsWith(`Supported-subset mode does not omit it: ${why}.`), `${label}: ${issue.message}`);
    assert.ok(!entry.omittedKnown.some((item) => ['id', 'component'].includes(item.name)), label);
    for (const name of ['id', 'component']) assert.equal(sourceProperty(entry, name)[0].disposition, 'blocked', `${label} ${name}`);
  }
});

test('Subset: an optional id whose metadata has an error stays blocked; optional content named component is left out', (t) => {
  const broken = run({ builds: [buttonWith(t, { id: { required: false, tsType: STRING, description: '', defaultValue: { value: 'pick()', computed: false } } })],
    components: ['Button'], unmappedEvents: 'omit', supportedSubset: true });
  assert.equal(broken.ok, false);
  assert.deepEqual(component(broken, 'Button').blocking.map((issue) => [issue.code, issue.subject]).sort(), [['A2UI_RESERVED_NAME', 'id'], ['MANIFEST_ENTRY_INVALID', 'id']]);
  assert.equal(sourceProperty(component(broken, 'Button'), 'id')[0].disposition, 'blocked');

  const content = run({ builds: [buttonWith(t, { component: { required: false, tsType: { name: 'ReactNode' }, description: '' } })],
    components: ['Button'], unmappedEvents: 'omit', supportedSubset: true });
  assert.equal(content.ok, true);
  assert.deepEqual(component(content, 'Button').omittedKnown.map((item) => [item.kind, item.name]), [['reserved-name', 'component'], ['event', 'onClick']]);
  assert.deepEqual(content.catalog.components.Button.properties.component, { const: 'Button' });
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

// ---- Mappings (opt-in, C2): a reviewed file maps content to text or leaves an optional property out. Every entry is
// checked against the source metadata, and the file is only read in supported-subset mode.

const TEXT = 'common_types.json#/$defs/DynamicString';
const NODE = (required = false, description = 'What the button shows.') => ({ required, tsType: { name: 'ReactReactNode', raw: 'React.ReactNode' }, description });
const mappingsFor = (properties, name = 'Button') => ({ version: 1, components: { [name]: properties } });
const mapped = (build, mappings, extra = {}) => run({ builds: [build], components: ['Button'], unmappedEvents: 'omit', supportedSubset: true, mappings, ...extra });

test('Mappings: content the source types as ReactNode becomes a text property under its own name, with the source requiredness', (t) => {
  const build = buttonWith(t, { children: NODE() });
  // Without a mapping the content blocks, in strict and in supported-subset mode.
  assert.deepEqual(component(run({ builds: [build], components: ['Button'], unmappedEvents: 'omit', supportedSubset: true }), 'Button').blocking.map((issue) => issue.code), ['PROJECTED_CONTENT_UNMAPPED']);

  const result = mapped(build, mappingsFor({ children: { map: 'text' } }));
  assert.equal(result.ok, true);
  const schema = result.catalog.components.Button;
  assert.deepEqual(schema.properties.children, { $ref: TEXT, description: 'What the button shows. Text only. The source type is React.ReactNode; this catalog accepts a string.' });
  assert.deepEqual(schema.required, ['component', 'label']);
  assert.match(schema.description, /Text only, where the source accepts more \(explicit mapping\): children \(source type React\.ReactNode\)\./);
  assert.match(schema.description, /Projected content is described only by the text properties named above; other content the source accepts is not part of this schema\.$/);
  assert.doesNotMatch(schema.description, /may be missing from Storybook metadata/);
  assert.equal(validateV1Export(result.catalog).valid, true);

  const entry = component(result, 'Button');
  assert.deepEqual(entry.properties, ['primary', 'backgroundColor', 'size', 'label', 'children']);
  const [item] = sourceProperty(entry, 'children');
  assert.deepEqual([item.sourceType, item.requiredness, item.disposition, item.mapping], ['React.ReactNode', 'optional', 'mapped', 'text']);
  assert.match(item.reason, /^Mapped to text by the mappings file: /);
  assert.ok(!entry.omittedKnown.some((omission) => omission.name === 'children'));
  // The notice defines all four dispositions and says when "mapped" is used; it no longer calls it unused.
  for (const notice of [result.report.notice, run({ builds: [build], unmappedEvents: 'omit', supportedSubset: true }).report.notice]) {
    assert.match(notice, /one disposition: "supported" \([^)]+\), "mapped" \([^)]+\), "omitted" \([^)]+\) or "blocked" \([^)]+\)\./);
    assert.match(notice, /"mapped" \(an explicit text mapping in a mappings file exports it as an A2UI text property/);
    assert.doesNotMatch(notice, /not used yet|reserved and/);
  }
  assert.match(result.report.notice, /Mappings are on/);

  // What an agent may send: a literal string or an @path binding. Anything else is rejected.
  const valid = createComponentInstanceValidator(result.catalog);
  assert.equal(valid({ component: 'Button', label: 'Save', children: 'Save draft' }).valid, true);
  assert.equal(valid({ component: 'Button', label: 'Save', children: { '@path': '/draft/title' } }).valid, true);
  assert.equal(valid({ component: 'Button', label: 'Save', children: 5 }).valid, false);
  assert.equal(valid({ component: 'Button', label: 'Save', children: ['a', 'b'] }).valid, false);
  assert.equal(valid({ component: 'Button', label: 'Save', children: { path: '/draft/title' } }).valid, false);

  // Required content stays required.
  const required = mapped(buttonWith(t, { children: NODE(true, '') }), mappingsFor({ children: { map: 'text' } }));
  assert.deepEqual(required.catalog.components.Button.required, ['component', 'label', 'children']);
  assert.deepEqual(required.catalog.components.Button.properties.children, { $ref: TEXT, description: 'Text only. The source type is React.ReactNode; this catalog accepts a string.' });
  assert.equal(sourceProperty(component(required, 'Button'), 'children')[0].requiredness, 'required');
  assert.equal(createComponentInstanceValidator(required.catalog)({ component: 'Button', label: 'Save' }).valid, false);
});

test('Mappings: "text" is refused unless the source metadata shows content that accepts a string', (t) => {
  const refuse = (props, property, pattern) => assert.throws(() => mapped(buttonWith(t, props), mappingsFor({ [property]: { map: 'text' } })), pattern, property);
  const noString = /^Error: Invalid mappings: Button\.\w+ cannot be mapped to text: the source metadata does not show that it accepts string content \(source type: /;
  refuse({}, 'label', noString);                                                                                   // a string property, already supported
  refuse({}, 'onClick', noString);                                                                                 // an event
  refuse({ theme: { required: false, tsType: OBJECT_TYPE, description: '' } }, 'theme', noString);                // an unsupported type
  refuse({ children: { required: false, tsType: { name: 'null' }, description: '' } }, 'children', noString);      // content by name only
  refuse({ icon: { required: false, tsType: { name: 'ReactElement', raw: 'React.ReactElement' }, description: '' } }, 'icon', noString);  // an element, not a string
  refuse({ id: NODE() }, 'id', /Button\.id cannot be mapped to text: "id" is a name A2UI reserves/);
  // An Angular input is never content.
  assert.throws(() => run({ builds: [ANGULAR], unmappedEvents: 'omit', supportedSubset: true, mappings: mappingsFor({ label: { map: 'text' } }, 'StatusChipComponent') }),
    /StatusChipComponent\.label cannot be mapped to text/);
});

test('Mappings: "omit" leaves out an optional property of any ordinary kind, with its reason in the report and its name in the description', (t) => {
  const reason = 'Not needed by this catalog.';
  const build = buttonWith(t, {
    children: NODE(),                                                                                     // content
    theme: { required: false, tsType: OBJECT_TYPE, description: '' },                                     // unsupported type
    'aria-label': { required: false, tsType: STRING, description: '' },                                   // inherited DOM attribute
    id: { required: false, tsType: STRING, description: '' },                                             // reserved name
  });
  // A supported property as well, and an event: the event policy of this run is "omit" (see the two tests below).
  const names = ['backgroundColor', 'onClick', 'children', 'theme', 'aria-label', 'id'];
  const result = mapped(build, mappingsFor(Object.fromEntries(names.map((name) => [name, { map: 'omit', reason }]))));
  assert.equal(result.report.policy.unmappedEvents, 'omit');
  assert.equal(result.ok, true);
  const entry = component(result, 'Button');
  assert.deepEqual(entry.blocking, []);
  assert.deepEqual(entry.properties, ['primary', 'size', 'label']);
  assert.deepEqual(entry.omittedKnown, names.map((name) => ({ kind: 'mapping', name, reason: `Left out by the mappings file: ${reason}` })));
  for (const name of names) assert.deepEqual(sourceProperty(entry, name).map((item) => [item.disposition, item.reason]), [['omitted', `Left out by the mappings file: ${reason}`]], name);
  const schema = result.catalog.components.Button;
  assert.deepEqual(Object.keys(schema.properties).sort(), ['component', 'label', 'primary', 'size']);
  assert.match(schema.description, /Left out by an explicit mapping: backgroundColor, onClick, children, theme, aria-label, id\./);
  assert.doesNotMatch(schema.description, /Inherited DOM attributes not exported|Events not exported|name A2UI reserves/);
  assert.equal(validateV1Export(result.catalog).valid, true);
  assert.equal(createComponentInstanceValidator(result.catalog)({ component: 'Button', label: 'Save', backgroundColor: 'red' }).valid, false);
});

test('Mappings: "omit" never hides a source metadata error, such as a default that cannot be verified', (t) => {
  const reason = 'Not needed by this catalog.';
  const badDefault = { required: false, tsType: STRING, description: '', defaultValue: { value: 'pick()', computed: false } };
  const refused = /^Error: Invalid mappings: Button\.\w+ cannot be omitted: its source metadata has an error, which a mapping must not hide \(MANIFEST_ENTRY_INVALID: /;
  // An ordinary property, and one with a reserved name: the error decides, not the name.
  for (const name of ['tone', 'id'])
    assert.throws(() => mapped(buttonWith(t, { [name]: badDefault }), mappingsFor({ [name]: { map: 'omit', reason } })), refused, name);
  // Without the entry the property blocks its component, exactly as before; the error is still reported.
  const build = buttonWith(t, { tone: badDefault });
  const blocked = mapped(build, mappingsFor({ backgroundColor: { map: 'omit', reason } }));
  assert.equal(blocked.ok, false);
  assert.deepEqual(component(blocked, 'Button').blocking.map((issue) => [issue.code, issue.subject]), [['MANIFEST_ENTRY_INVALID', 'tone']]);
  assert.deepEqual(sourceProperty(component(blocked, 'Button'), 'tone').map((item) => item.disposition), ['blocked']);
  // Angular reports a default it cannot read under another code; it is refused the same way.
  const angular = mutatedAngular(t, (argTypes) => { argTypes.label.type.required = false; argTypes.label.table.defaultValue = { summary: "'x'" }; });
  assert.throws(() => run({ builds: [angular], unmappedEvents: 'omit', supportedSubset: true, mappings: mappingsFor({ label: { map: 'omit', reason } }, 'StatusBadgeComponent') }),
    /^Error: Invalid mappings: StatusBadgeComponent\.label cannot be omitted: its source metadata has an error, which a mapping must not hide \(UNSUPPORTED_DEFAULT: /);
  // The policy itself refuses as well, should a caller skip the check.
  const [contract] = readReactV0({ manifest: JSON.parse(fs.readFileSync(path.join(build, 'manifests/components.json'), 'utf8')) }).filter((item) => item.name === 'Button');
  assert.throws(() => evaluate(contract, { unmappedEvents: 'omit', supportedSubset: true, mappings: new Map([['tone', { map: 'omit', reason }]]) }),
    /Internal error: Button\.tone was omitted by a mapping that the checks do not allow/);
});

test('Mappings: "omit" on an event needs --unmapped-events omit; it is never a way around --unmapped-events fail', (t) => {
  const reason = 'Not needed by this catalog.';
  const mappings = mappingsFor({ onClick: { map: 'omit', reason } });
  const refused = /^Error: Invalid mappings: Button\.onClick cannot be omitted: it is an event, and events block under --unmapped-events fail\. Pass --unmapped-events omit \(unmappedEvents: "omit"\) to leave events out\./;
  assert.throws(() => mapped(REACT, mappings, { unmappedEvents: 'fail' }), refused);
  assert.throws(() => run({ builds: [REACT], components: ['Button'], supportedSubset: true, mappings }), refused, 'fail is the default');
  // Also for a component this export does not select: the file is checked as a whole.
  assert.throws(() => run({ builds: [REACT], components: ['Page'], supportedSubset: true, mappings }), refused);
  // Other omissions do not need the event policy, and the event then still blocks.
  const others = mapped(REACT, mappingsFor({ backgroundColor: { map: 'omit', reason } }), { unmappedEvents: 'fail' });
  assert.equal(others.ok, false);
  assert.deepEqual(component(others, 'Button').blocking.map((issue) => [issue.code, issue.subject]), [['UNMAPPED_EVENT', 'onClick']]);
  // With --unmapped-events omit the entry is allowed, and the report gives the reason from the file.
  const allowed = mapped(REACT, mappings);
  assert.equal(allowed.ok, true);
  assert.deepEqual(component(allowed, 'Button').omittedKnown, [{ kind: 'mapping', name: 'onClick', reason: `Left out by the mappings file: ${reason}` }]);
  // The policy itself refuses as well, should a caller skip the check.
  const [contract] = readReactV0({ manifest: JSON.parse(fs.readFileSync(path.join(REACT, 'manifests/components.json'), 'utf8')) }).filter((item) => item.name === 'Button');
  const direct = (unmappedEvents) => evaluate(contract, { unmappedEvents, supportedSubset: true, mappings: new Map([['onClick', { map: 'omit', reason }]]) });
  assert.throws(() => direct('fail'), /Internal error: Button\.onClick was omitted by a mapping that the checks do not allow/);
  assert.equal(direct('omit').exportable, true);
  // The CLI stops with exit 2 and writes nothing.
  const file = path.join(temporary(t), 'button.mappings.json');
  fs.writeFileSync(file, JSON.stringify(mappings));
  const out = path.join(temporary(t), 'out');
  const cli = spawnSync(process.execPath, [CLI, 'export', '--storybook', REACT, '--components', 'Button', '--supported-subset', '--mappings', file, '--catalog-id', catalogId, '--out', out], { encoding: 'utf8' });
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /Error: Invalid mappings: Button\.onClick cannot be omitted: it is an event/);
  assert.equal(fs.existsSync(out), false);
});

test('Mappings: "omit" is refused for a required property, for unknown requiredness, and without a meaningful reason', (t) => {
  const reason = 'Not needed by this catalog.';
  assert.throws(() => mapped(REACT, mappingsFor({ label: { map: 'omit', reason } })), /Invalid mappings: Button\.label cannot be omitted: the source metadata marks it required\./);
  assert.throws(() => mapped(buttonWith(t, { theme: { tsType: OBJECT_TYPE, description: '' } }), mappingsFor({ theme: { map: 'omit', reason } })),
    /Invalid mappings: Button\.theme cannot be omitted: the source metadata does not say whether it is required\./);
  for (const entry of [{ map: 'omit' }, { map: 'omit', reason: '' }, { map: 'omit', reason: '   n/a   ' }, { map: 'omit', reason: 42 }])
    assert.throws(() => mapped(REACT, mappingsFor({ backgroundColor: entry })), /Invalid mappings: Button\.backgroundColor needs a "reason" of at least 10 characters/, JSON.stringify(entry));
  assert.throws(() => mapped(REACT, mappingsFor({ backgroundColor: { map: 'text', reason } })), /Button\.backgroundColor: "reason" belongs to "map": "omit" only/);
});

test('Mappings: version, structure, verbs, component names and property names are all checked, and anything unknown fails', (t) => {
  const reason = 'Not needed by this catalog.';
  const refuse = (mappings, pattern) => assert.throws(() => mapped(REACT, mappings), pattern, JSON.stringify(mappings));
  // A string is a file path (tested below); any other value that is not an object is refused.
  for (const notAnObject of [null, [], 7, true]) refuse(notAnObject, /Invalid mappings: expected an object with "version" and "components"/);
  refuse({ components: {} }, /Invalid mappings: "version" must be 1 \(found undefined\)/);
  refuse({ version: 2, components: {} }, /Invalid mappings: "version" must be 1 \(found 2\)/);
  refuse({ version: '1', components: {} }, /Invalid mappings: "version" must be 1 \(found "1"\)/);
  refuse({ version: 1 }, /Invalid mappings: "components" must be an object keyed by component name/);
  refuse({ version: 1, components: [] }, /Invalid mappings: "components" must be an object keyed by component name/);
  refuse({ version: 1, components: {}, mappings: [] }, /Invalid mappings: unknown key "mappings"/);
  refuse(mappingsFor(['children']), /Invalid mappings: components\.Button must be an object keyed by property name/);
  refuse(mappingsFor({ backgroundColor: 'omit' }), /Invalid mappings: Button\.backgroundColor must be an object such as \{ "map": "text" \}/);
  refuse(mappingsFor({ backgroundColor: {} }), /Invalid mappings: Button\.backgroundColor has "map": undefined; supported: "text" and "omit"/);
  refuse(mappingsFor({ backgroundColor: { map: 'child' } }), /Invalid mappings: Button\.backgroundColor has "map": "child"; supported: "text" and "omit"/);
  refuse(mappingsFor({ backgroundColor: { map: 'omit', reason, as: 'x' } }), /Invalid mappings: Button\.backgroundColor has an unknown key "as"/);
  refuse(mappingsFor({ backgroundColor: { map: 'omit', reason } }, 'Buton'), /Invalid mappings: component "Buton" is not in the Storybook build\(s\)\. Components: Button, Header, Page\./);
  refuse(mappingsFor({ colour: { map: 'omit', reason } }), /Invalid mappings: Button\.colour is not a property the Storybook metadata lists\. Listed: primary, backgroundColor, size, label, onClick\./);
  // A file path: unreadable, not JSON, and a valid file.
  const directory = temporary(t);
  refuse(path.join(directory, 'missing.json'), /Cannot read Mappings file/);
  fs.writeFileSync(path.join(directory, 'broken.json'), '{ "version": 1,');
  refuse(path.join(directory, 'broken.json'), /Mappings file is not valid JSON/);
  // The option itself: only with supported-subset mode, through the API as well.
  assert.throws(() => run({ builds: [REACT], mappings: mappingsFor({}) }), /Mappings need supported-subset mode: pass --supported-subset \(supportedSubset: true\) together with --mappings\./);
  assert.throws(() => run({ builds: [REACT], supportedSubset: false, mappings: mappingsFor({}) }), /Mappings need supported-subset mode/);
});

test('Mappings: names that exist on Object.prototype are looked up as data, in the file and in the metadata', (t) => {
  const reason = 'Not needed by this catalog.';
  // As a file would arrive: JSON.parse makes "__proto__" an own key.
  const parsed = (text) => JSON.parse(text);
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    assert.throws(() => mapped(REACT, parsed(`{ "version": 1, "components": { ${JSON.stringify(name)}: { "label": { "map": "text" } } } }`)),
      /Invalid mappings: component "\w+" is not in the Storybook build\(s\)/, `component ${name}`);
    assert.throws(() => mapped(REACT, parsed(`{ "version": 1, "components": { "Button": { ${JSON.stringify(name)}: { "map": "omit", "reason": "${reason}" } } } }`)),
      /Invalid mappings: Button\.\w+ is not a property the Storybook metadata lists/, `property ${name}`);
  }
  // Keys that are only inherited are never read: this object has no own "version", "components" or "map".
  assert.throws(() => mapped(REACT, Object.create({ version: 1, components: {} })), /Invalid mappings: "version" must be 1 \(found undefined\)/);
  assert.throws(() => mapped(REACT, mappingsFor({ backgroundColor: Object.create({ map: 'omit', reason }) })), /has "map": undefined/);
  // A real property with such a name can be mapped like any other.
  const build = buttonWith(t, { constructor: { required: false, tsType: OBJECT_TYPE, description: '' }, toString: NODE() });
  const result = mapped(build, mappingsFor({ constructor: { map: 'omit', reason }, toString: { map: 'text' } }));
  assert.equal(result.ok, true);
  assert.deepEqual(component(result, 'Button').properties, ['primary', 'backgroundColor', 'size', 'label', 'toString']);
  assert.equal(Object.hasOwn(result.catalog.components.Button.properties, 'toString'), true);
  assert.equal(result.catalog.components.Button.properties.toString.$ref, TEXT);
  assert.equal(Object.hasOwn(result.catalog.components.Button.properties, 'constructor'), false);
  assertCatalogMatchesReport(result);
  // Text content named __proto__ is still blocked by name after the mapping; it is never emitted.
  const proto = mutatedReact(t, ({ read, write }) => {
    const manifest = read('manifests/components.json');
    Object.defineProperty(manifest.components['example-button'].reactDocgen.props, '__proto__', { value: NODE(), enumerable: true, writable: true, configurable: true });
    write('manifests/components.json', manifest);
  });
  const blocked = mapped(proto, parsed('{ "version": 1, "components": { "Button": { "__proto__": { "map": "text" } } } }'));
  assert.equal(blocked.ok, false);
  assert.deepEqual(component(blocked, 'Button').blocking.map((issue) => [issue.code, issue.subject]), [['UNSAFE_NAME', '__proto__']]);
  assert.deepEqual(sourceProperty(component(blocked, 'Button'), '__proto__').map((item) => item.disposition), ['blocked']);
});

test('Mappings: one file serves any selection; entries for components that are not selected are checked and then unused', (t) => {
  const reason = 'Not needed by this catalog.';
  const mappings = { version: 1, components: { Button: { backgroundColor: { map: 'omit', reason } }, Header: { user: { map: 'omit', reason } } } };
  const button = run({ builds: [REACT], components: ['Button'], unmappedEvents: 'omit', supportedSubset: true, mappings });
  assert.equal(button.ok, true);
  assert.deepEqual(button.report.components.map((item) => item.name), ['Button']);
  // An entry for an unselected component is still validated against the build.
  mappings.components.Header.nope = { map: 'omit', reason };
  assert.throws(() => run({ builds: [REACT], components: ['Button'], unmappedEvents: 'omit', supportedSubset: true, mappings }), /Invalid mappings: Header\.nope is not a property/);
});

test('Mappings: the report records the configuration by SHA-256 and file name, never by an absolute path', (t) => {
  const directory = temporary(t);
  const file = path.join(directory, 'button.mappings.json');
  const text = '{\n  "version": 1,\n  "components": { "Button": { "children": { "map": "text" } } }\n}\n';
  fs.writeFileSync(file, text);
  const build = buttonWith(t, { children: NODE() });
  const fromFile = mapped(build, file);
  assert.deepEqual(fromFile.report.policy, { unmappedEvents: 'omit', supportedSubset: true,
    mappings: { version: 1, file: 'button.mappings.json', sha256: createHash('sha256').update(text).digest('hex') } });
  // An object has no file: the hash is of its JSON with sorted keys and no whitespace, so key order does not matter.
  const canonical = '{"components":{"Button":{"children":{"map":"text"}}},"version":1}';
  for (const object of [JSON.parse(text), { components: { Button: { children: { map: 'text' } } }, version: 1 }])
    assert.deepEqual(mapped(build, object).report.policy.mappings, { version: 1, file: null, sha256: createHash('sha256').update(canonical).digest('hex') });
  assert.deepEqual(mapped(build, JSON.parse(text)).catalog, fromFile.catalog);
  assert.ok(!JSON.stringify(fromFile.report).includes(directory), 'no absolute path in the report');
  // Without mappings the report has no such key.
  assert.deepEqual(run({ builds: [build], unmappedEvents: 'omit', supportedSubset: true }).report.policy, { unmappedEvents: 'omit', supportedSubset: true });
});

test('Mappings: the normalized contract is never changed, so strict results are the same before and after a mapped export', (t) => {
  const build = buttonWith(t, { children: NODE(), id: { required: false, tsType: STRING, description: '' }, theme: { required: false, tsType: OBJECT_TYPE, description: '' } });
  const reason = 'Not needed by this catalog.';
  const deepFreeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; };
  const [contract] = readReactV0({ manifest: JSON.parse(fs.readFileSync(path.join(build, 'manifests/components.json'), 'utf8')) }).filter((item) => item.name === 'Button');
  const before = JSON.stringify(contract);
  deepFreeze(contract);   // a write to the contract now throws
  const strictBefore = evaluate(contract, { unmappedEvents: 'omit' });
  const decided = evaluate(contract, { unmappedEvents: 'omit', supportedSubset: true,
    mappings: new Map([['children', { map: 'text' }], ['backgroundColor', { map: 'omit', reason }]]) });
  assert.equal(decided.exportable, true);
  assert.deepEqual(decided.fields.map((field) => field.name), ['primary', 'size', 'label', 'children']);
  assert.equal(JSON.stringify(contract), before);
  assert.deepEqual(evaluate(contract, { unmappedEvents: 'omit' }), strictBefore);
  assert.equal(strictBefore.fields, contract.fields, 'strict mode hands the contract fields on untouched');
  assert.throws(() => evaluate(contract, { mappings: new Map([['children', { map: 'text' }]]) }), /mappings are read only in supported-subset mode/);
  // The same through the whole pipeline, in one process: strict, mapped, strict.
  const strict = () => run({ builds: [build], components: ['Button'], unmappedEvents: 'omit' });
  const first = strict();
  assert.equal(mapped(build, mappingsFor({ children: { map: 'text' } })).ok, true);
  assert.deepEqual(strict(), first);
  assert.deepEqual(first.report.policy, { unmappedEvents: 'omit' });
  assert.ok(!('sourceProperties' in component(first, 'Button')));
});

test('Mappings, CLI: --mappings needs --supported-subset, reads a file, and reaches the printed report and export-report.json', (t) => {
  const build = buttonWith(t, { children: NODE(), icon: NODE() });
  const file = path.join(temporary(t), 'button.mappings.json');
  fs.writeFileSync(file, JSON.stringify(mappingsFor({ children: { map: 'text' }, icon: { map: 'omit', reason: 'No icon component in this catalog.' } })));
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  const alone = cli('inspect', '--storybook', build, '--mappings', file);
  assert.equal(alone.status, 2);
  assert.match(alone.stderr, /Error: Mappings need supported-subset mode: pass --supported-subset/);
  assert.match(cli('inspect', '--storybook', build, '--supported-subset', '--mappings').stderr, /--mappings needs a value/);
  const inspect = cli('inspect', '--storybook', build, '--unmapped-events', 'omit', '--supported-subset', '--mappings', file);
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.match(inspect.stdout, /OK +Button \[react\] properties: primary, backgroundColor, size, label, children/);
  assert.match(inspect.stdout, /source properties: 4 supported, 1 mapped, 2 omitted, 0 blocked/);
  assert.match(inspect.stdout, /mapped to text: children/);
  assert.match(inspect.stdout, /not exported \(mapping\): icon/);
  const out = path.join(temporary(t), 'out');
  const exported = cli('export', '--storybook', build, '--components', 'Button', '--unmapped-events', 'omit', '--supported-subset', '--mappings', file, '--catalog-id', catalogId, '--out', out);
  assert.equal(exported.status, 0, exported.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'export-report.json'), 'utf8'));
  assert.deepEqual(report.policy.mappings, { version: 1, file: 'button.mappings.json', sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'catalog.json'), 'utf8')).components.Button.properties.children.$ref, TEXT);
  assert.match(cli('--help').stdout, /--mappings/);
  // A bad file stops the export with exit 2 and writes nothing.
  fs.writeFileSync(file, JSON.stringify(mappingsFor({ label: { map: 'text' } })));
  const refused = path.join(temporary(t), 'out');
  const bad = cli('export', '--storybook', build, '--supported-subset', '--mappings', file, '--catalog-id', catalogId, '--out', refused);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Error: Invalid mappings: Button\.label cannot be mapped to text/);
  assert.equal(fs.existsSync(refused), false);
});
