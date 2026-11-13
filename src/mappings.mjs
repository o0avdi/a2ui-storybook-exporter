// Mappings: a small reviewed file that says, for named properties of named components, either
//   { "map": "text" }                    export this content as an A2UI text property (DynamicString), or
//   { "map": "omit", "reason": "..." }   leave this optional property out, for the stated reason.
//
//   { "version": 1, "components": { "<Component>": { "<property>": { "map": ... } } } }
//
// Nothing here is specific to a framework or a library. A mapping only chooses between things the source metadata
// already allows: `checkMappings` refuses an entry the normalized contracts do not back, so a mapping cannot give a
// property a type the source does not accept, leave out a property the source requires, hide an error in the source
// metadata, or leave out an event while the run is told to fail on events.
//
// The file is external input. Its names are data: every lookup uses own keys or a Map, never the prototype chain.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sortDeterministic } from './a2ui/catalog.mjs';
import { isReservedProperty, whyMappingCannotOmit } from './contract.mjs';
import { readJson } from './storybook-build.mjs';

export const MAPPINGS_VERSION = 1;
const VERBS = ['text', 'omit'];
// A reason shorter than this is a placeholder ("n/a", "todo"), not a reason a reviewer can check.
const MIN_REASON_LENGTH = 10;

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);
const fail = (message) => { throw new Error(`Invalid mappings: ${message}`); };
const quoted = (values) => values.map((value) => `"${value}"`).join(' and ');

function onlyKeys(object, allowed, where) {
  for (const key of Object.keys(object))
    if (!allowed.includes(key)) fail(`${where}unknown key ${JSON.stringify(key)}; allowed: ${quoted(allowed)}.`);
}

/** The structure of the file, before any Storybook build is involved. Returns component name -> property name -> entry. */
function parse(value) {
  if (!record(value)) fail('expected an object with "version" and "components".');
  onlyKeys(value, ['version', 'components'], '');
  if (own(value, 'version') !== MAPPINGS_VERSION) fail(`"version" must be ${MAPPINGS_VERSION} (found ${JSON.stringify(own(value, 'version'))}).`);
  if (!record(own(value, 'components'))) fail('"components" must be an object keyed by component name.');
  const components = new Map();
  for (const [name, properties] of Object.entries(value.components)) {
    if (!record(properties)) fail(`components.${name} must be an object keyed by property name.`);
    const entries = new Map();
    for (const [property, entry] of Object.entries(properties)) {
      const where = `${name}.${property}`;
      if (!record(entry)) fail(`${where} must be an object such as { "map": "text" }.`);
      onlyKeys(entry, ['map', 'reason'], `${where} has an `);
      const map = own(entry, 'map');
      if (!VERBS.includes(map)) fail(`${where} has "map": ${JSON.stringify(map)}; supported: ${quoted(VERBS)}.`);
      const reason = own(entry, 'reason');
      if (map === 'omit') {
        if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH)
          fail(`${where} needs a "reason" of at least ${MIN_REASON_LENGTH} characters that says why the property is left out.`);
        entries.set(property, { map, reason: reason.trim() });
      } else {
        if (reason !== undefined) fail(`${where}: "reason" belongs to "map": "omit" only.`);
        entries.set(property, { map });
      }
    }
    components.set(name, entries);
  }
  return components;
}

/**
 * Read mappings from a file path or from an already parsed object, and check their structure.
 * The SHA-256 identifies the configuration in the report: of the file's bytes, or for an object of its JSON with
 * sorted keys and no whitespace. Only the file's base name is kept, never its directory.
 */
export function readMappings(input) {
  if (typeof input === 'string') {
    const { value, sha256 } = readJson(input, 'Mappings file');
    return { version: MAPPINGS_VERSION, file: path.basename(input), sha256, components: parse(value) };
  }
  const components = parse(input);
  const sha256 = createHash('sha256').update(JSON.stringify(sortDeterministic(input))).digest('hex');
  return { version: MAPPINGS_VERSION, file: null, sha256, components };
}

/**
 * Check every entry against the normalized contracts of the builds (all of them, selected for export or not), so
 * one file can serve any selection and still cannot name something the metadata does not list. `unmappedEvents` is
 * the event policy of the run: an entry may leave an event out only under "omit".
 */
export function checkMappings(mappings, contracts, { unmappedEvents } = {}) {
  const byName = new Map(contracts.map((contract) => [contract.name, contract]));
  for (const [name, entries] of mappings.components) {
    const contract = byName.get(name);
    if (!contract) fail(`component ${JSON.stringify(name)} is not in the Storybook build(s). Components: ${[...byName.keys()].join(', ')}.`);
    const source = new Map(contract.source.map((property) => [property.name, property]));
    const content = new Map(contract.content.map((item) => [item.name, item]));
    for (const [property, entry] of entries) {
      const where = `${name}.${property}`;
      const listed = source.get(property);
      if (!listed) fail(`${where} is not a property the Storybook metadata lists. Listed: ${[...source.keys()].join(', ') || 'none'}.`);
      if (entry.map === 'omit') {
        const why = whyMappingCannotOmit(contract, listed, unmappedEvents);
        if (why) fail(`${where} cannot be omitted: ${why}`);
      } else {
        if (isReservedProperty(property)) fail(`${where} cannot be mapped to text: "${property}" is a name A2UI reserves, so it cannot be a component property.`);
        if (content.get(property)?.acceptsText !== true)
          fail(`${where} cannot be mapped to text: the source metadata does not show that it accepts string content (source type: ${listed.type ?? 'not given'}). ` +
            '"text" is for projected content whose type admits a plain string, such as a React ReactNode.');
      }
    }
  }
}
