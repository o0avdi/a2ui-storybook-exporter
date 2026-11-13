// Orchestration: Storybook build directories -> adapters -> shared contracts -> policy -> existing generator ->
// official A2UI v1.0 validation -> catalog.json plus export-report.json.
import fs from 'node:fs';
import path from 'node:path';
import { makeCatalogV1, isValidCatalogId, catalogIdRequirements } from './a2ui/catalog.mjs';
import { validateV1Export } from './a2ui/validate.mjs';
import { BLOCKING, blocker, contractStatus, evaluate, toGeneratorComponent } from './contract.mjs';
import { checkMappings, readMappings } from './mappings.mjs';
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

// Added to the report's notice in supported-subset mode, so the report explains its own extra list.
const SUBSET_NOTICE = ' Supported-subset mode is on: a property with an unsupported type is left out, not blocking, only when the ' +
  'source metadata says required: false. "sourceProperties" lists every property the metadata exposes exactly once, with ' +
  'its original type, its requiredness and one disposition: "supported" (it can be represented directly in A2UI), ' +
  '"mapped" (an explicit text mapping in a mappings file exports it as an A2UI text property, a narrower type than the source ' +
  'accepts; it occurs only when a mappings file is given), "omitted" (it is deliberately left out) or "blocked" (it prevents export). ' +
  'A disposition describes the property. A component is written to the catalog only when its status is "exported"; ' +
  'a supported or mapped property of a blocked component is not in the catalog. ' +
  'An optional source property named "id" or "component" is left out as well, because A2UI uses both names itself: ' +
  '"component" in the catalog is only the A2UI discriminator, and the "id" of an instance is the A2UI component id. ' +
  'Neither is ever a value for the source property of that name.';

// Added after it when a mappings file is given.
const MAPPINGS_NOTICE = ' Mappings are on ("policy.mappings" identifies the configuration by SHA-256): each entry was checked ' +
  'against the source metadata. A "mapped" property is content that the source types as accepting a string; it is exported as an ' +
  'A2UI text property (DynamicString) under the same name, and its entry says "mapping": "text". An omission of kind ' +
  '"mapping" is an optional property left out on purpose, with the reason the mappings file gives.';

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
 * @param {boolean}  [options.supportedSubset] opt-in: omit optional properties with an unsupported type; list every source property
 * @param {string|object} [options.mappings] opt-in, needs supportedSubset: a mappings file path or its parsed content (src/mappings.mjs)
 * @param {string}   [options.out]         when given, files are written only if the export succeeds
 */
export function exportCatalog(options) {
  const { builds, catalogId, components: selection, unmappedEvents = 'fail', supportedSubset = false, mappings: mappingsInput, title, description, out } = options;
  if (!builds?.length) throw new Error('At least one Storybook build directory is required (--storybook <dir>).');
  if (!['fail', 'omit'].includes(unmappedEvents)) throw new Error('--unmapped-events must be "fail" or "omit".');
  if (typeof supportedSubset !== 'boolean') throw new Error('supportedSubset must be true or false.');
  if (mappingsInput !== undefined && !supportedSubset)
    throw new Error('Mappings need supported-subset mode: pass --supported-subset (supportedSubset: true) together with --mappings.');
  if (!isValidCatalogId(catalogId)) throw new Error(`Invalid --catalog-id. ${catalogIdRequirements}`);
  const mappings = mappingsInput === undefined ? undefined : readMappings(mappingsInput);

  const reads = builds.map(readBuild);
  let contracts = reads.flatMap((read) => read.contracts);
  const names = contracts.map((contract) => contract.name);
  for (const name of new Set(names.filter((name, i) => names.indexOf(name) !== i)))
    throw new Error(`Component name collision across builds: ${name}. Export the builds separately.`);
  // Before the selection: one mappings file may cover more components than this export selects, but none it cannot find.
  if (mappings) checkMappings(mappings, contracts, { unmappedEvents });

  if (selection?.length) {
    const unknown = selection.filter((wanted) => !contracts.some((c) => c.name === wanted || c.id === wanted));
    if (unknown.length) throw new Error(`Unknown component(s): ${unknown.join(', ')}. Available: ${names.join(', ')}.`);
    contracts = contracts.filter((c) => selection.includes(c.name) || selection.includes(c.id));
  }

  const evaluated = contracts.map((contract) => ({ contract,
    ...evaluate(contract, { unmappedEvents, supportedSubset, mappings: mappings?.components.get(contract.name) }) }));
  const exportable = evaluated.filter((item) => item.exportable);
  const report = {
    generator: 'storybook-a2ui', protocolVersion: '1.0', catalogId,
    policy: { unmappedEvents, ...(supportedSubset ? { supportedSubset: true } : {}),
      ...(mappings ? { mappings: { version: mappings.version, file: mappings.file, sha256: mappings.sha256 } } : {}) },
    notice: 'Conversion covers the properties Storybook exposes. The source component contract is not verified: ' +
      'anything the metadata does not list, such as inherited HTML/DOM attributes or projected content like React children, ' +
      'is not visible to this exporter. ' +
      '"omittedKnown" lists only omissions the exporter could see; an empty list is not proof that nothing was left out.' +
      (supportedSubset ? SUBSET_NOTICE : '') + (mappings ? MAPPINGS_NOTICE : ''),
    builds: reads.map((read) => read.build),
    components: evaluated.map(({ contract, exportable: ok, blocking, omitted, fields, sourceProperties }) => ({
      name: contract.name, id: contract.id, framework: contract.framework, adapter: contract.adapter,
      status: ok ? 'exported' : 'blocked',
      properties: ok ? fields.map((field) => field.name) : [],
      ...(supportedSubset ? { sourceProperties } : {}),
      contract: contractStatus(omitted, contract.content),
      omittedKnown: omitted, blocking, warnings: contract.warnings,
    })),
    result: 'failed',
  };

  // An explicit selection is all-or-nothing, like the main exporter. Without one, exportable components are
  // exported and the rest are listed as blocked with their diagnostics.
  const failed = selection?.length ? evaluated.length > exportable.length : exportable.length === 0;
  if (failed) return { ok: false, report, catalog: undefined };

  const catalog = makeCatalogV1(exportable.map(({ contract, omitted, fields, mapped }) => toGeneratorComponent(contract, omitted, fields, mapped)), {
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
