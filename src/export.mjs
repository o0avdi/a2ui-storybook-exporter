// Orchestration: Storybook build directories -> adapters -> shared contracts -> policy -> existing generator ->
// official A2UI v1.0 validation -> catalog.json plus export-report.json.
import fs from 'node:fs';
import path from 'node:path';
import { makeCatalogV1, isValidCatalogId, catalogIdRequirements } from './a2ui/catalog.mjs';
import { validateV1Export } from './a2ui/validate.mjs';
import { BLOCKING, blocker, contractStatus, evaluate, toGeneratorComponent } from './contract.mjs';
import { readIndex, readManifest } from './storybook-build.mjs';
import { detectReactV0, readReactV0, REACT_V0 } from './adapters/react-v0.mjs';
import { detectAngularV1, readAngularV1, ANGULAR_V1 } from './adapters/angular-vite-v1.mjs';

const ADAPTERS = [
  { id: REACT_V0, detect: detectReactV0, read: readReactV0 },
  { id: ANGULAR_V1, detect: detectAngularV1, read: readAngularV1 },
];

const INSTRUCTIONS = 'Use only the components and properties declared in this catalog. ' +
  'Properties, types, defaults and requiredness come from Storybook component metadata, not from story args. ' +
  'Events and projected content without a reviewed A2UI mapping are not part of a component schema; ' +
  'where a component description lists them as not exported, the developer owns that behavior. ' +
  'Bindings use the A2UI v1.0 @path form. This export contains catalog JSON only.';

function readBuild(buildDir) {
  const dir = path.resolve(buildDir);
  const index = readIndex(dir);
  const { manifest, file, sha256 } = readManifest(dir);
  const adapter = ADAPTERS.find((candidate) => candidate.detect(manifest));
  if (!adapter)
    throw new Error(`Unsupported components manifest format in ${buildDir} (v=${manifest.v}, meta.docgen=${manifest.meta?.docgen}). ` +
      'Supported: React manifest v0 (inline reactDocgen) and Angular-Vite manifest v1 (angular-component-meta).');
  const contracts = adapter.read({ buildDir: dir, manifestFile: file, manifest });
  for (const contract of contracts) {
    const missing = contract.storyIds.filter((id) => !index.storyIds.has(id));
    if (missing.length)
      contract.blocking.push(blocker(BLOCKING.index, contract.name, `Manifest stories not found in the Storybook index: ${missing.join(', ')}.`));
    contract.warnings = index.ambiguousIds.has(contract.id) ? [{ code: 'AMBIGUOUS_COMPONENT_ID', subject: contract.id,
      message: `Component id "${contract.id}" is shared by stories from ${index.ambiguousIds.get(contract.id).length} files ` +
        `(${index.ambiguousIds.get(contract.id).join(', ')}). The manifest describes ${contract.name} only; ` +
        'documentation links for this id may point at another file. Give each story file a unique title to remove the ambiguity.' }] : [];
    if (!contract.storyIds.length)
      contract.blocking.push(blocker(BLOCKING.index, contract.name, 'The manifest lists no stories for this component.'));
  }
  return { contracts, build: { directory: path.basename(dir), adapter: adapter.id, manifestVersion: manifest.v,
    docgen: manifest.meta?.docgen ?? null, indexSha256: index.sha256, manifestSha256: sha256 } };
}

/**
 * @param {object} options
 * @param {string[]} options.builds        Storybook build directories (each with index.json and manifests/components.json)
 * @param {string}   options.catalogId     absolute http(s) URI
 * @param {string[]} [options.components]  names or ids; omit to take every exportable component
 * @param {'fail'|'omit'} [options.unmappedEvents]
 * @param {string}   [options.out]         when given, files are written only if the export succeeds
 */
export function exportCatalog(options) {
  const { builds, catalogId, components: selection, unmappedEvents = 'fail', title, description, out } = options;
  if (!builds?.length) throw new Error('At least one Storybook build directory is required (--storybook <dir>).');
  if (!['fail', 'omit'].includes(unmappedEvents)) throw new Error('--unmapped-events must be "fail" or "omit".');
  if (!isValidCatalogId(catalogId)) throw new Error(`Invalid --catalog-id. ${catalogIdRequirements}`);

  const reads = builds.map(readBuild);
  let contracts = reads.flatMap((read) => read.contracts);
  const names = contracts.map((contract) => contract.name);
  for (const name of new Set(names.filter((name, i) => names.indexOf(name) !== i)))
    throw new Error(`Component name collision across builds: ${name}. Export the builds separately.`);

  if (selection?.length) {
    const unknown = selection.filter((wanted) => !contracts.some((c) => c.name === wanted || c.id === wanted));
    if (unknown.length) throw new Error(`Unknown component(s): ${unknown.join(', ')}. Available: ${names.join(', ')}.`);
    contracts = contracts.filter((c) => selection.includes(c.name) || selection.includes(c.id));
  }

  const evaluated = contracts.map((contract) => ({ contract, ...evaluate(contract, { unmappedEvents }) }));
  const exportable = evaluated.filter((item) => item.exportable);
  const report = {
    generator: 'storybook-a2ui', protocolVersion: '1.0', catalogId,
    policy: { unmappedEvents },
    notice: 'Conversion covers the properties Storybook exposes. The source component contract is not verified: ' +
      'anything the metadata does not list, such as inherited HTML/DOM attributes, is not visible to this exporter. ' +
      '"omittedKnown" lists only omissions the exporter could see; an empty list is not proof that nothing was left out.',
    builds: reads.map((read) => read.build),
    components: evaluated.map(({ contract, exportable: ok, blocking, omitted }) => ({
      name: contract.name, id: contract.id, framework: contract.framework, adapter: contract.adapter,
      status: ok ? 'exported' : 'blocked',
      properties: ok ? contract.fields.map((field) => field.name) : [],
      contract: contractStatus(omitted),
      omittedKnown: omitted, blocking, warnings: contract.warnings,
    })),
    result: 'failed',
  };

  // An explicit selection is all-or-nothing, like the main exporter. Without one, exportable components are
  // exported and the rest are listed as blocked with their diagnostics.
  const failed = selection?.length ? evaluated.length > exportable.length : exportable.length === 0;
  if (failed) return { ok: false, report, catalog: undefined };

  const catalog = makeCatalogV1(exportable.map(({ contract, omitted }) => toGeneratorComponent(contract, omitted)), {
    catalogId, instructions: INSTRUCTIONS,
    ...(title ? { title } : {}), ...(description ? { description } : {}),
  });
  report.validation = { validator: 'official A2UI v1.0 (pinned in spec/v1_0)', valid: validateV1Export(catalog).valid };
  report.result = 'exported';

  if (out) {
    fs.mkdirSync(out, { recursive: true });
    if (fs.readdirSync(out).length) throw new Error(`Output directory is not empty: ${out}`);
    fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'export-report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return { ok: true, report, catalog };
}
