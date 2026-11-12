// Angular adapter: Storybook Components Manifest v1 as written by @storybook/angular-vite 10.6.5
// (`meta.docgen: "angular-component-meta"`). Each component references its docgen and story files by relative
// `$ref`; the docgen holds `argTypes` split into `inputs` and `outputs` by `table.category`.
//
// Verified against real build output only (see fixtures/PROVENANCE.md). Anything not seen in that output is
// reported as a blocking diagnostic instead of being interpreted.
import { BLOCKING, blocker } from '../contract.mjs';
import { resolveRef } from '../storybook-build.mjs';

export const ANGULAR_V1 = 'angular-vite-v1';

export function detectAngularV1(manifest) {
  return manifest.v === 1 && manifest.meta?.docgen === 'angular-component-meta';
}

const SCALARS = new Set(['boolean', 'string', 'number']);

// Defaults arrive as `table.defaultValue.summary`. Only shapes seen in real output are accepted:
// booleans, numbers and members of the property's own enum. A plain string default has no verified encoding
// (quoted or not), so it is refused rather than guessed.
function readDefault(summary, schema) {
  if (schema.enum) return schema.enum.includes(summary) ? { value: summary } : { error: `default ${JSON.stringify(summary)} is not one of the declared values` };
  if (schema.type === 'boolean') {
    if (typeof summary === 'boolean') return { value: summary };
    if (summary === 'true' || summary === 'false') return { value: summary === 'true' };
  }
  if (schema.type === 'number') {
    const value = typeof summary === 'number' ? summary : typeof summary === 'string' && summary.trim() !== '' ? Number(summary) : NaN;
    if (Number.isFinite(value)) return { value };
  }
  return { error: `default ${JSON.stringify(summary)} for a ${schema.type} input has no verified encoding in Storybook Angular output` };
}

function readInput(name, argType) {
  const type = argType.type ?? {};
  const required = type.required === true;
  let schema;
  if (SCALARS.has(type.name)) schema = { type: type.name };
  else if (type.name === 'enum' && Array.isArray(type.value) && type.value.length && type.value.every((value) => typeof value === 'string'))
    schema = { type: 'string', enum: [...type.value].sort() };
  else
    return { blocker: blocker(BLOCKING.unsupportedType, name,
      `${name}: unsupported type "${type.name}"${argType.table?.type?.summary ? ` (${argType.table.type.summary})` : ''}; only boolean, string, number and string literal unions are supported.`) };
  if (argType.description) schema.description = argType.description;
  const summary = argType.table?.defaultValue?.summary;
  if (summary !== undefined) {
    const parsed = readDefault(summary, schema);
    if (parsed.error) return { blocker: blocker(BLOCKING.default, name, `${name}: ${parsed.error}.`) };
    schema.default = parsed.value;
  }
  return { field: { name, schema, required, binding: !schema.enum, ...(argType.description ? { descriptionOrigin: 'storybook-angular-docgen' } : {}) } };
}

export function readAngularV1({ buildDir, manifestFile, manifest }) {
  return Object.entries(manifest.components).map(([key, entry]) => {
    const id = entry.id ?? key;
    const contract = {
      id, name: entry.name ?? id, framework: 'angular', adapter: ANGULAR_V1,
      description: entry.description ?? '', descriptionOrigin: entry.description ? 'storybook-angular-docgen' : 'generator-fallback',
      storyIds: [], fields: [], events: [], content: [], omitted: [], blocking: [], source: [],
    };
    try {
      const docgen = resolveRef(buildDir, manifestFile, entry.docgen?.$ref);
      if (entry.stories?.$ref) contract.storyIds = Object.keys(resolveRef(buildDir, manifestFile, entry.stories.$ref).stories ?? {});
      for (const [name, argType] of Object.entries(docgen.argTypes ?? {})) {
        const category = argType.table?.category;
        // The argType as the metadata describes it. An optional input has no "required" key in real output, so its
        // requiredness is null (not stated) unless the key holds a boolean.
        const property = { name, type: argType.table?.type?.summary ?? argType.type?.name ?? null,
          required: typeof argType.type?.required === 'boolean' ? argType.type.required : null, blocking: [] };
        contract.source.push(property);
        // A blocker about this argType goes into the component's list and into the property's own list.
        const block = (issue) => { contract.blocking.push(issue); property.blocking.push(issue); };
        if (category === 'inputs') {
          const input = readInput(name, argType);
          if (input.blocker) block(input.blocker); else contract.fields.push(input.field);
        } else if (category === 'outputs') {
          contract.events.push({ name, payload: argType.table?.type?.summary, description: argType.description });
        } else {
          block(blocker(BLOCKING.manifest, name, `${name}: unrecognized argType category ${JSON.stringify(category)}.`));
        }
      }
    } catch (error) {
      contract.blocking.push(blocker(BLOCKING.manifest, id, error.message));
    }
    return contract;
  });
}
