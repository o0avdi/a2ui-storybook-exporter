// Characterization tests. They pin what the exporter does TODAY, so that a later change shows up as a reviewed diff.
// They do not claim the pinned behavior is right: some of it is known to be wrong and is scheduled to change
// (tasks/plan.md). Whether an export is correct is tested in exporter.test.mjs.
//
// To change a snapshot on purpose:   UPDATE_SNAPSHOTS=1 node --test test/characterization.test.mjs
// then read the diff of test/golden/ and commit it together with the change that caused it. Never update unread.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { exportCatalog } from '../src/export.mjs';
import { createCatalogValidator, createComponentInstanceValidator, validateCatalogStructuralRules, validateV1Export } from '../src/a2ui/validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const USWDS = path.join(here, 'fixtures/react-uswds');
const MUI = path.join(here, 'fixtures/mui-rdt-pass');
const MUI_DIRECT = path.join(here, 'fixtures/mui-rdt-direct');
const MUI_REACT_DOCGEN = path.join(here, 'fixtures/mui-rd-pass');
const BASIC_CATALOG = path.join(here, '../spec/v1_0/basic_catalog.json');
const CLI = path.join(here, '../bin/storybook-a2ui.mjs');
const golden = (name) => path.join(here, 'golden', name);
const names = (entries) => entries.map((entry) => entry.name);

// The committed snapshot. With UPDATE_SNAPSHOTS=1 the file is first rewritten from `value`.
function committed(file, value) {
  if (process.env.UPDATE_SNAPSHOTS === '1') fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// The per-component part of the report, as export-report.json would hold it (hence the JSON round trip).
function reportComponents(unmappedEvents, build = USWDS, supportedSubset = false) {
  const { report } = exportCatalog({ builds: [build], catalogId: 'https://example.org/catalogs/characterization/1', unmappedEvents, supportedSubset });
  return JSON.parse(JSON.stringify(report.components));
}

// How often each disposition occurs in the sourceProperties of a list of report entries (supported-subset mode).
function dispositions(entries) {
  const counts = {};
  for (const item of entries.flatMap((entry) => entry.sourceProperties)) counts[item.disposition] = (counts[item.disposition] ?? 0) + 1;
  return counts;
}

// How often each blocking code occurs in a list of report entries.
function blockingCodes(entries) {
  const counts = {};
  for (const issue of entries.flatMap((entry) => entry.blocking)) counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  return counts;
}

// Same components in the same order, and on a mismatch the failure shows only the entries that changed, by name.
function assertSameEntries(actual, expected) {
  assert.deepEqual(names(actual), names(expected));
  const changed = actual.map((entry, index) => index).filter((index) => !isDeepStrictEqual(actual[index], expected[index]));
  const byName = (entries) => Object.fromEntries(changed.map((index) => [entries[index].name, entries[index]]));
  assert.deepStrictEqual(byName(actual), byName(expected));
}

test('Characterization react-uswds: the report entry of every component under the default policy', () => {
  const actual = reportComponents('fail');
  assert.equal(actual.length, 75);
  assertSameEntries(actual, committed(golden('react-uswds.report.fail.json'), actual));
});

test('Characterization react-uswds: --unmapped-events omit changes the report entry of these components only', () => {
  // Stored as the difference to the default policy, so a change that affects both policies appears once in a diff.
  const fail = reportComponents('fail');
  const omit = reportComponents('omit');
  assert.deepEqual(names(omit), names(fail));
  const changed = omit.filter((entry, index) => !isDeepStrictEqual(entry, fail[index]));
  assertSameEntries(changed, committed(golden('react-uswds.report.omit-changes.json'), changed));
});

test('Characterization validator: the official basic catalog passes the official meta-schema and fails this exporter\'s own rules', (t) => {
  // The exporter's rules describe the flat shape it generates. The official catalog composes six components with
  // allOf and does not set additionalProperties: false, so those rules reject it. That is why "valid" in a report
  // means "official schema AND local rules", and why an own-property fix (M2) must leave this list unchanged.
  // Ajv warns that it ignores the "uri" format in the official catalog. Keep that out of the test output, but fail
  // on any other warning.
  const warn = t.mock.method(console, 'warn', () => {});
  t.after(() => { for (const call of warn.mock.calls) assert.match(String(call.arguments[0]), /unknown format "uri" ignored/); });
  const basic = JSON.parse(fs.readFileSync(BASIC_CATALOG, 'utf8'));
  const result = createCatalogValidator()(basic);
  assert.deepEqual(result.metaErrors, []);
  const actual = { referenceErrors: result.referenceErrors, structuralErrors: validateCatalogStructuralRules(basic).errors };
  assert.deepStrictEqual(actual, committed(golden('basic-catalog.local-rules.json'), actual));
  assert.throws(() => validateV1Export(basic), /A2UI v1\.0 catalog validation failed/);
});

// ---- Material UI 9.5.0: six components, three real Storybook 10.6.7 builds of one project (test/fixtures/PROVENANCE.md).
// The builds differ in the docgen engine and in whether the stories import Material UI directly or through
// pass-through files. Only react-docgen-typescript over pass-through files gives Storybook any properties to list.

test('Characterization Material UI: the report entry of all six components under the default policy', () => {
  const actual = reportComponents('fail', MUI);
  assert.deepEqual(names(actual), ['Alert', 'Button', 'Chip', 'Switch', 'Typography', 'TextField']);
  assert.deepEqual(actual.map((entry) => entry.status), Array(6).fill('blocked'));
  assert.deepEqual(blockingCodes(actual), { UNSUPPORTED_PROP_TYPE: 48, MANIFEST_ENTRY_INVALID: 1, PROJECTED_CONTENT_UNMAPPED: 15, UNMAPPED_EVENT: 8, A2UI_RESERVED_NAME: 2 });
  assertSameEntries(actual, committed(golden('mui-rdt-pass.report.fail.json'), actual));
});

test('Characterization Material UI: --unmapped-events omit changes the report entry of these components only, and none exports', () => {
  const fail = reportComponents('fail', MUI);
  const omit = reportComponents('omit', MUI);
  assert.deepEqual(names(omit), names(fail));
  assert.deepEqual(omit.map((entry) => entry.status), Array(6).fill('blocked'));
  assert.deepEqual(blockingCodes(omit), { UNSUPPORTED_PROP_TYPE: 48, MANIFEST_ENTRY_INVALID: 1, PROJECTED_CONTENT_UNMAPPED: 15, A2UI_RESERVED_NAME: 2 });
  const changed = omit.filter((entry, index) => !isDeepStrictEqual(entry, fail[index]));
  assertSameEntries(changed, committed(golden('mui-rdt-pass.report.omit-changes.json'), changed));
});

test('Characterization Material UI: stories that import the library directly give a manifest without docgen, and the export stops', () => {
  // Storybook reports an error for each of the six components because their files are in node_modules. The exporter
  // then finds no entry with docgen, does not recognize the manifest and stops. Its message does not name that cause.
  const manifest = JSON.parse(fs.readFileSync(path.join(MUI_DIRECT, 'manifests/components.json'), 'utf8'));
  const entries = Object.values(manifest.components);
  assert.equal(entries.length, 6);
  for (const entry of entries) {
    assert.equal(entry.error.name, 'react-docgen-typescript found no component docs');
    assert.ok(!entry.reactDocgen && !entry.reactDocgenTypescript);
  }
  assert.throws(() => reportComponents('fail', MUI_DIRECT), /Unsupported components manifest format .*\(v=0, meta\.docgen=react-docgen-typescript\)/);
});

test('Characterization Material UI: react-docgen over the pass-through files finds six components and no properties', () => {
  // The same pass-through files that give react-docgen-typescript 156 properties give react-docgen none.
  for (const policy of ['fail', 'omit']) {
    const actual = reportComponents(policy, MUI_REACT_DOCGEN);
    assert.equal(actual.length, 6);
    for (const entry of actual) {
      assert.equal(entry.status, 'blocked');
      assert.deepEqual(entry.blocking.map((issue) => issue.code), ['NO_EXPORTABLE_PROPS'], entry.name);
    }
  }
});

// ---- Supported-subset mode (opt-in) on the real fixtures. The tests above run without it and pin the default.

test('Characterization Material UI, supported-subset mode: 42 optional unsupported properties and 8 reserved names are omitted, and no component exports', () => {
  const actual = reportComponents('fail', MUI, true);
  assert.deepEqual(actual.map((entry) => entry.status), Array(6).fill('blocked'));
  // 48 unsupported types without the mode. 42 are left out for their type, and the other 6 are the optional "component"
  // property of each component, left out for its name like the optional "id" of Switch and TextField (C2).
  // Content, events and the one metadata error are untouched.
  assert.deepEqual(blockingCodes(actual), { MANIFEST_ENTRY_INVALID: 1, PROJECTED_CONTENT_UNMAPPED: 15, UNMAPPED_EVENT: 8 });
  const reserved = actual.flatMap((entry) => entry.omittedKnown.filter((item) => item.kind === 'reserved-name').map((item) => `${entry.name}.${item.name}`));
  assert.deepEqual(reserved, ['Alert.component', 'Button.component', 'Chip.component', 'Switch.id', 'Switch.component', 'Typography.component', 'TextField.id', 'TextField.component']);
  // 156 source properties, each once. "omitted" is the 42, the 8 and the "style" attribute of each component.
  // Before C2 this was 76, 48 and 32: the 8 reserved names moved from blocked to omitted.
  assert.deepEqual(dispositions(actual), { supported: 76, omitted: 56, blocked: 24 });
  assertSameEntries(actual, committed(golden('mui-rdt-pass.report.subset.json'), actual));
});

test('Characterization Material UI, supported-subset mode with --unmapped-events omit: content and one default still block all six', () => {
  const actual = reportComponents('omit', MUI, true);
  assert.deepEqual(actual.map((entry) => entry.status), Array(6).fill('blocked'));
  assert.deepEqual(blockingCodes(actual), { MANIFEST_ENTRY_INVALID: 1, PROJECTED_CONTENT_UNMAPPED: 15 });
  assert.deepEqual(dispositions(actual), { supported: 76, omitted: 64, blocked: 16 });
  // What still blocks each component, by property.
  assert.deepEqual(Object.fromEntries(actual.map((entry) => [entry.name, entry.sourceProperties.filter((item) => item.disposition === 'blocked').map((item) => item.name)])), {
    Alert: ['action', 'icon', 'children'],
    Button: ['children', 'endIcon', 'loadingIndicator', 'startIcon'],
    Chip: ['children', 'label'],
    Switch: ['checkedIcon', 'icon'],
    Typography: ['children'],
    TextField: ['variant', 'children', 'helperText', 'label'],
  });
});

// ---- Mappings (C2) on the real Material UI build: test/fixtures/mui.mappings.json maps the text content of three
// components and leaves five optional properties out, each with a reason. Nothing in src/ knows about Material UI.

const MUI_MAPPINGS = path.join(here, 'fixtures/mui.mappings.json');
const MUI_ID = 'https://example.org/catalogs/material-ui/1';
const muiMapped = (extra = {}) => exportCatalog({ builds: [MUI], catalogId: MUI_ID, unmappedEvents: 'omit', supportedSubset: true, mappings: MUI_MAPPINGS, ...extra });

test('Characterization Material UI with mappings: exactly Typography, Button and Chip export, and the catalog is the committed golden file', () => {
  const { ok, report, catalog } = muiMapped();
  assert.equal(ok, true);
  const actual = JSON.parse(JSON.stringify(report.components));
  assert.deepEqual(Object.fromEntries(actual.map((entry) => [entry.name, entry.status])),
    { Alert: 'blocked', Button: 'exported', Chip: 'exported', Switch: 'blocked', Typography: 'exported', TextField: 'blocked' });
  assert.deepEqual(Object.keys(catalog.components), ['Button', 'Chip', 'Typography']);
  assert.equal(report.validation.valid, true);
  assert.equal(validateV1Export(catalog).valid, true);
  // The three that stay blocked need more than text: element content, and for TextField a default docgen repeats.
  assert.deepEqual(Object.fromEntries(actual.filter((entry) => entry.status === 'blocked').map((entry) => [entry.name, entry.blocking.map((issue) => `${issue.code} ${issue.subject}`)])), {
    Alert: ['PROJECTED_CONTENT_UNMAPPED action', 'PROJECTED_CONTENT_UNMAPPED icon', 'PROJECTED_CONTENT_UNMAPPED children'],
    Switch: ['PROJECTED_CONTENT_UNMAPPED checkedIcon', 'PROJECTED_CONTENT_UNMAPPED icon'],
    TextField: ['MANIFEST_ENTRY_INVALID variant', 'PROJECTED_CONTENT_UNMAPPED children', 'PROJECTED_CONTENT_UNMAPPED helperText', 'PROJECTED_CONTENT_UNMAPPED label'],
  });
  // Every one of the 156 source properties has exactly one of the four dispositions. Against the run without
  // mappings (76, 64 omitted, 16 blocked): 3 blocked content properties are mapped and 4 are left out explicitly.
  assert.deepEqual(dispositions(actual), { supported: 76, mapped: 3, omitted: 68, blocked: 9 });
  assert.deepEqual(actual.flatMap((entry) => entry.sourceProperties.filter((item) => item.disposition === 'mapped').map((item) => `${entry.name}.${item.name} ${item.mapping} ${item.sourceType}`)),
    ['Button.children text ReactNode', 'Chip.label text ReactNode', 'Typography.children text ReactNode']);
  assert.deepEqual(actual.flatMap((entry) => entry.omittedKnown.filter((item) => item.kind === 'mapping').map((item) => `${entry.name}.${item.name}`)),
    ['Button.endIcon', 'Button.loadingIndicator', 'Button.startIcon', 'Chip.children']);
  for (const entry of actual) {
    assert.equal(entry.sourceProperties.length, new Set(entry.sourceProperties.map((item) => item.name)).size, entry.name);
    for (const item of entry.sourceProperties) assert.ok(['supported', 'mapped', 'omitted', 'blocked'].includes(item.disposition), `${entry.name}.${item.name}`);
    if (entry.status !== 'exported') continue;
    // The report and the catalog list the same properties: supported and mapped ones, nothing omitted.
    const exported = entry.sourceProperties.filter((item) => ['supported', 'mapped'].includes(item.disposition)).map((item) => item.name);
    assert.deepEqual(exported, entry.properties, entry.name);
    assert.deepEqual(Object.keys(catalog.components[entry.name].properties).filter((name) => name !== 'component').sort(), [...exported].sort(), entry.name);
  }
  assert.deepEqual(report.policy, { unmappedEvents: 'omit', supportedSubset: true,
    mappings: { version: 1, file: 'mui.mappings.json', sha256: createHash('sha256').update(fs.readFileSync(MUI_MAPPINGS)).digest('hex') } });
  assertSameEntries(actual, committed(golden('mui-rdt-pass.report.mapped.json'), actual));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(catalog)), committed(golden('mui.catalog.json'), catalog));
});

test('Characterization Material UI with mappings: the catalog accepts real component instances and rejects what it does not declare', () => {
  const { catalog } = muiMapped();
  const valid = createComponentInstanceValidator(catalog);
  const accepts = (instance) => assert.equal(valid(instance).valid, true, JSON.stringify(instance));
  const rejects = (instance) => assert.equal(valid(instance).valid, false, JSON.stringify(instance));
  // Text content: a literal string or an A2UI v1.0 data binding, under the source property's own name.
  accepts({ component: 'Typography', variant: 'h4', children: 'Quarterly report' });
  accepts({ component: 'Typography', children: { '@path': '/report/title' }, noWrap: true });
  accepts({ component: 'Typography' });                                             // children is optional in the source
  accepts({ component: 'Button', variant: 'contained', color: 'primary', children: 'Save' });
  accepts({ component: 'Button', children: { '@path': '/actions/primary/label' }, disabled: { '@path': '/form/invalid' } });
  accepts({ component: 'Chip', label: 'Draft', color: 'warning', size: 'small' });
  accepts({ component: 'Chip', label: { '@path': '/status' } });
  // Not text.
  rejects({ component: 'Typography', children: 5 });
  rejects({ component: 'Typography', children: ['a', 'b'] });
  rejects({ component: 'Typography', children: { path: '/report/title' } });        // not the v1.0 binding form
  rejects({ component: 'Chip', label: { component: 'Typography', children: 'x' } }); // an inline component is not text
  // Not declared: omitted properties, a value outside an enum, an unknown component.
  rejects({ component: 'Typography', children: 'x', sx: { mt: 2 } });
  rejects({ component: 'Typography', children: 'x', id: 'title' });                 // "id" is the envelope's, not a property
  rejects({ component: 'Button', children: 'Save', startIcon: 'save' });
  rejects({ component: 'Button', children: 'Save', onClick: 'submit' });
  rejects({ component: 'Chip', label: 'Draft', children: 'Draft' });
  rejects({ component: 'Chip', label: 'Draft', color: 'purple' });
  rejects({ component: 'Typography', variant: 'h7', children: 'x' });
  rejects({ component: 'Alert', children: 'x' });
  rejects({ children: 'x' });
});

test('Characterization Material UI with mappings: the CLI writes the golden catalog, and one mappings file serves a smaller selection', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mui-mapped-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = (out, ...args) => spawnSync(process.execPath, [CLI, 'export', '--storybook', MUI, '--catalog-id', MUI_ID, '--unmapped-events', 'omit', '--supported-subset',
    '--mappings', MUI_MAPPINGS, '--out', path.join(directory, out), ...args], { encoding: 'utf8' });
  const all = cli('all');
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /OK +Typography \[react\] properties: align, children, gutterBottom, noWrap, variant, className/);
  assert.match(all.stdout, /source properties: 5 supported, 1 mapped, 6 omitted, 0 blocked/);
  assert.equal(fs.readFileSync(path.join(directory, 'all/catalog.json'), 'utf8'), fs.readFileSync(golden('mui.catalog.json'), 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'all/export-report.json'), 'utf8'));
  assert.equal(report.result, 'exported');
  assert.ok(!JSON.stringify(report).includes(here), 'no absolute path in export-report.json');
  // The same file with only Typography selected: the Button and Chip entries are checked and unused.
  const one = cli('one', '--components', 'Typography');
  assert.equal(one.status, 0, one.stderr);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(directory, 'one/catalog.json'), 'utf8')).components), ['Typography']);
  // Selecting a component that is still blocked is all-or-nothing, as without mappings.
  const blocked = cli('blocked', '--components', 'Typography,Alert');
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.equal(fs.existsSync(path.join(directory, 'blocked')), false);
});

test('Characterization react-uswds, supported-subset mode: Card and SearchButton export as well; every unsupported property left is required', () => {
  const exported = (entries) => names(entries.filter((entry) => entry.status === 'exported')).sort();
  const fail = reportComponents('fail', USWDS, true);
  assert.deepEqual(exported(fail), ['Card', 'Collection', 'GovBanner', 'SearchButton']);
  assert.deepEqual(exported(reportComponents('omit', USWDS, true)), ['Card', 'Collection', 'GovBanner', 'NavDropDownButton', 'Pagination', 'SearchButton']);
  // 55 unsupported types without the mode, 14 with it.
  const unsupported = fail.flatMap((entry) => entry.blocking).filter((issue) => issue.code === 'UNSUPPORTED_PROP_TYPE');
  assert.equal(unsupported.length, 14);
  for (const issue of unsupported) assert.match(issue.message, /does not omit it: the source metadata marks it required\.$/);
  assert.deepEqual(Object.fromEntries(fail.filter((entry) => ['Card', 'SearchButton'].includes(entry.name)).map((entry) => [entry.name, entry.omittedKnown.map((item) => item.name)])),
    { Card: ['containerProps', 'gridLayout'], SearchButton: ['i18n'] });
});
