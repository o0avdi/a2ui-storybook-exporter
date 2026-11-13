#!/usr/bin/env node
// CLI: Storybook build directory (index.json + manifests/components.json) -> validated A2UI v1.0 catalog.json
import fs from 'node:fs';
import path from 'node:path';
import { exportCatalog } from '../src/export.mjs';

const USAGE = `Usage:
  storybook-a2ui inspect --storybook <build-dir> [--storybook <build-dir> ...] [--unmapped-events fail|omit]
                       [--supported-subset [--mappings <file>]]
  storybook-a2ui export  --storybook <build-dir> [...] --catalog-id <https-uri> --out <new-dir>
                       [--components A,B] [--unmapped-events fail|omit] [--supported-subset [--mappings <file>]]
                       [--title <t>] [--description <d>]

  <build-dir>        a "storybook build" output folder (index.json and manifests/components.json), Storybook >= 10.6.
                     The manifest needs features.componentsManifest: true in .storybook/main.ts.
  --catalog-id       a stable https URI that you own for this catalog (required for export)
  --out              a new or empty directory; catalog.json and export-report.json are written there
  --unmapped-events  fail (default): a component with events/callbacks is blocked.
                     omit: export its properties; each event is recorded as not exported in export-report.json
                     and in the component description. No mapping is ever invented.
  --supported-subset off by default. With it, a property whose type is not supported is left out of the
                     component, not blocking it, but only when the metadata says required: false. So is a
                     property named "id" or "component", whatever its type: A2UI uses both names itself. A required
                     property, or one whose requiredness is not stated, still blocks. Projected content, events
                     and metadata errors are never left out by this option alone. Each property left
                     out is named in the component description, and export-report.json lists every source
                     property once (sourceProperties) with its type and what was decided for it.
  --mappings <file>  only with --supported-subset. A reviewed JSON file (docs/MAPPINGS.md) that, per component and
                     property, either exports content as text ({ "map": "text" }, only where the metadata types the
                     content as accepting a string) or leaves an optional property out ({ "map": "omit", "reason":
                     "..." }). Every entry is checked against the metadata; an entry that does not fit stops the run.
                     An omission never hides a metadata error, and may name an event only with --unmapped-events omit.
                     The file may also cover components of the build that --components does not select.
  Without --components every exportable component is exported and the rest are reported as blocked.

  -h, --help         show this help (also: storybook-a2ui <command> --help)
  -v, --version      show the version`;

function parse(argv) {
  const options = { builds: [] };
  const args = [...argv];
  options.command = args.shift();
  if (args.includes('-h') || args.includes('--help')) options.help = true;
  const value = (flag) => { const v = args.shift(); if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value.`); return v; };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--storybook') options.builds.push(value(flag));
    else if (flag === '--out') options.out = value(flag);
    else if (flag === '--catalog-id') options.catalogId = value(flag);
    else if (flag === '--components') options.components = value(flag).split(',').map((s) => s.trim()).filter(Boolean);
    else if (flag === '--unmapped-events') options.unmappedEvents = value(flag);
    else if (flag === '--supported-subset') options.supportedSubset = true;
    else if (flag === '--mappings') options.mappings = value(flag);
    else if (flag === '--title') options.title = value(flag);
    else if (flag === '--description') options.description = value(flag);
    else if (flag === '-h' || flag === '--help') continue;
    else throw new Error(`Unknown option ${flag}. Run "storybook-a2ui --help" for usage.`);
  }
  return options;
}

function print(report) {
  for (const build of report.builds) console.log(`build ${build.directory}: ${build.adapter} (manifest v${build.manifestVersion}, ${build.docgen ?? 'docgen unspecified'})`);
  console.log(`\nNote: ${report.notice}`);
  for (const c of report.components) {
    console.log(`\n${c.status === 'exported' ? 'OK     ' : 'BLOCKED'} ${c.name} [${c.framework}]${c.properties.length ? ` properties: ${c.properties.join(', ')}` : ''}`);
    if (c.sourceProperties) {
      const count = (disposition) => c.sourceProperties.filter((item) => item.disposition === disposition).length;
      console.log(`   source properties: ${count('supported')} supported, ${report.policy.mappings ? `${count('mapped')} mapped, ` : ''}${count('omitted')} omitted, ${count('blocked')} blocked`);
      for (const item of c.sourceProperties.filter((property) => property.disposition === 'mapped')) console.log(`   mapped to ${item.mapping}: ${item.name}`);
    }
    for (const item of c.omittedKnown) console.log(`   not exported (${item.kind}): ${item.name}`);
    for (const warning of c.warnings) console.log(`   WARNING ${warning.code}: ${warning.message}`);
    for (const issue of c.blocking) console.log(`   ${issue.code}: ${issue.message}`);
  }
}

// Exit by setting process.exitCode, never process.exit(): exiting immediately can cut off output that is still
// waiting to be written to a pipe (for example `storybook-a2ui inspect ... | head`).
function main() {
  const options = parse(process.argv.slice(2));
  if (['-v', '--version'].includes(options.command)) {
    console.log(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
    return 0;
  }
  if (!options.command || options.help || ['-h', '--help', 'help'].includes(options.command)) { console.log(USAGE); return 0; }
  if (!['inspect', 'export'].includes(options.command))
    throw new Error(`Unknown command "${options.command}". Commands: inspect, export. Run "storybook-a2ui --help" for usage.`);
  if (options.command === 'export' && !options.out) throw new Error('export needs --out <new-dir>.');
  if (options.command === 'export' && !options.catalogId) throw new Error('export needs --catalog-id <https-uri>: a stable URI that you own, for example https://example.org/catalogs/my-library/1.');
  const result = exportCatalog({ ...options, out: options.command === 'export' ? path.resolve(options.out) : undefined,
    catalogId: options.catalogId ?? 'https://example.org/catalogs/inspect/1' });
  print(result.report);
  if (options.command === 'export') {
    console.log(result.ok ? `\nWrote ${path.resolve(options.out)}/catalog.json (official A2UI v1.0 validation: PASS) and export-report.json`
      : '\nNothing written: no catalog could be produced under the current policy.');
  }
  return result.ok || options.command === 'inspect' ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 2;
}
