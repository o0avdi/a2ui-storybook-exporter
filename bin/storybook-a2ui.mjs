#!/usr/bin/env node
// CLI: Storybook build directory (index.json + manifests/components.json) -> validated A2UI v1.0 catalog.json
import path from 'node:path';
import { exportCatalog } from '../src/export.mjs';

const USAGE = `Usage:
  storybook-a2ui inspect --storybook <build-dir> [--storybook <build-dir> ...] [--unmapped-events fail|omit]
  storybook-a2ui export  --storybook <build-dir> [...] --catalog-id <https-uri> --out <new-dir>
                       [--components A,B] [--unmapped-events fail|omit] [--title <t>] [--description <d>]

  <build-dir>        a "storybook build" output folder (index.json and manifests/components.json), Storybook >= 10.6
  --unmapped-events  fail (default): a component with events/callbacks is blocked.
                     omit: export its properties; each event is recorded as not exported in export-report.json
                     and in the component description. No mapping is ever invented.
  Without --components every exportable component is exported and the rest are reported as blocked.`;

function parse(argv) {
  const options = { builds: [] };
  const args = [...argv];
  options.command = args.shift();
  const value = (flag) => { const v = args.shift(); if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value.`); return v; };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--storybook') options.builds.push(value(flag));
    else if (flag === '--out') options.out = value(flag);
    else if (flag === '--catalog-id') options.catalogId = value(flag);
    else if (flag === '--components') options.components = value(flag).split(',').map((s) => s.trim()).filter(Boolean);
    else if (flag === '--unmapped-events') options.unmappedEvents = value(flag);
    else if (flag === '--title') options.title = value(flag);
    else if (flag === '--description') options.description = value(flag);
    else throw new Error(`Unknown option ${flag}.`);
  }
  return options;
}

function print(report) {
  for (const build of report.builds) console.log(`build ${build.directory}: ${build.adapter} (manifest v${build.manifestVersion}, ${build.docgen ?? 'docgen unspecified'})`);
  console.log(`\nNote: ${report.notice}`);
  for (const c of report.components) {
    console.log(`\n${c.status === 'exported' ? 'OK     ' : 'BLOCKED'} ${c.name} [${c.framework}]${c.properties.length ? ` properties: ${c.properties.join(', ')}` : ''}`);
    for (const item of c.omittedKnown) console.log(`   not exported (${item.kind}): ${item.name}`);
    for (const warning of c.warnings) console.log(`   WARNING ${warning.code}: ${warning.message}`);
    for (const issue of c.blocking) console.log(`   ${issue.code}: ${issue.message}`);
  }
}

try {
  const options = parse(process.argv.slice(2));
  if (!['inspect', 'export'].includes(options.command)) { console.log(USAGE); process.exit(options.command ? 2 : 0); }
  if (options.command === 'export' && !options.out) throw new Error('export needs --out <new-dir>.');
  const result = exportCatalog({ ...options, out: options.command === 'export' ? path.resolve(options.out) : undefined,
    catalogId: options.catalogId ?? 'https://example.org/catalogs/inspect/1' });
  print(result.report);
  if (options.command === 'export') {
    console.log(result.ok ? `\nWrote ${path.resolve(options.out)}/catalog.json (official A2UI v1.0 validation: PASS) and export-report.json`
      : '\nNothing written: no catalog could be produced under the current policy.');
  }
  process.exit(result.ok || options.command === 'inspect' ? 0 : 1);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(2);
}
