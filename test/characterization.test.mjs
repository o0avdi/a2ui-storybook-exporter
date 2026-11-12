// Characterization tests. They pin what the exporter does TODAY, so that a later change shows up as a reviewed diff.
// They do not claim the pinned behavior is right: some of it is known to be wrong and is scheduled to change
// (tasks/plan.md). Whether an export is correct is tested in exporter.test.mjs.
//
// To change a snapshot on purpose:   UPDATE_SNAPSHOTS=1 node --test test/characterization.test.mjs
// then read the diff of test/golden/ and commit it together with the change that caused it. Never update unread.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { exportCatalog } from '../src/export.mjs';
import { createCatalogValidator, validateCatalogStructuralRules, validateV1Export } from '../src/a2ui/validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const USWDS = path.join(here, 'fixtures/react-uswds');
const MUI = path.join(here, 'fixtures/mui-rdt-pass');
const MUI_DIRECT = path.join(here, 'fixtures/mui-rdt-direct');
const MUI_REACT_DOCGEN = path.join(here, 'fixtures/mui-rd-pass');
const BASIC_CATALOG = path.join(here, '../spec/v1_0/basic_catalog.json');
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

test('Characterization Material UI, supported-subset mode: 42 optional unsupported properties are omitted and no component exports', () => {
  const actual = reportComponents('fail', MUI, true);
  assert.deepEqual(actual.map((entry) => entry.status), Array(6).fill('blocked'));
  // 48 unsupported types without the mode. The 6 that remain are the "component" property of each component:
  // optional, but a name A2UI reserves. Content, events, the reserved "id" and the one metadata error are untouched.
  assert.deepEqual(blockingCodes(actual), { UNSUPPORTED_PROP_TYPE: 6, MANIFEST_ENTRY_INVALID: 1, PROJECTED_CONTENT_UNMAPPED: 15, UNMAPPED_EVENT: 8, A2UI_RESERVED_NAME: 2 });
  assert.deepEqual(actual.flatMap((entry) => entry.blocking).filter((issue) => issue.code === 'UNSUPPORTED_PROP_TYPE').map((issue) => issue.subject), Array(6).fill('component'));
  // 156 source properties, each once. "omitted" is the 42 plus the "style" attribute of each component.
  assert.deepEqual(dispositions(actual), { supported: 76, omitted: 48, blocked: 32 });
  assertSameEntries(actual, committed(golden('mui-rdt-pass.report.subset.json'), actual));
});

test('Characterization Material UI, supported-subset mode with --unmapped-events omit: content, reserved names and one default still block all six', () => {
  const actual = reportComponents('omit', MUI, true);
  assert.deepEqual(actual.map((entry) => entry.status), Array(6).fill('blocked'));
  assert.deepEqual(blockingCodes(actual), { UNSUPPORTED_PROP_TYPE: 6, MANIFEST_ENTRY_INVALID: 1, PROJECTED_CONTENT_UNMAPPED: 15, A2UI_RESERVED_NAME: 2 });
  assert.deepEqual(dispositions(actual), { supported: 76, omitted: 56, blocked: 24 });
  // What still blocks each component, by property.
  assert.deepEqual(Object.fromEntries(actual.map((entry) => [entry.name, entry.sourceProperties.filter((item) => item.disposition === 'blocked').map((item) => item.name)])), {
    Alert: ['action', 'icon', 'children', 'component'],
    Button: ['children', 'endIcon', 'loadingIndicator', 'startIcon', 'component'],
    Chip: ['children', 'label', 'component'],
    Switch: ['checkedIcon', 'icon', 'id', 'component'],
    Typography: ['children', 'component'],
    TextField: ['variant', 'children', 'helperText', 'id', 'label', 'component'],
  });
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
