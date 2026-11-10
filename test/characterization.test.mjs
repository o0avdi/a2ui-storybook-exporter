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
const BASIC_CATALOG = path.join(here, '../spec/v1_0/basic_catalog.json');
const golden = (name) => path.join(here, 'golden', name);
const names = (entries) => entries.map((entry) => entry.name);

// The committed snapshot. With UPDATE_SNAPSHOTS=1 the file is first rewritten from `value`.
function committed(file, value) {
  if (process.env.UPDATE_SNAPSHOTS === '1') fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// The per-component part of the report, as export-report.json would hold it (hence the JSON round trip).
function reportComponents(unmappedEvents) {
  const { report } = exportCatalog({ builds: [USWDS], catalogId: 'https://example.org/catalogs/characterization/1', unmappedEvents });
  return JSON.parse(JSON.stringify(report.components));
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
