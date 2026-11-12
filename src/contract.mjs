// Normalized component contract shared by every framework adapter.
//
// An adapter turns one framework's Storybook manifest entry into this shape and nothing else; it never decides
// what is exportable. `evaluate` applies one policy to every framework, and `toGeneratorComponent` hands the
// result to the existing, proven A2UI v1.0 generator.
//
//   contract = {
//     id, name, framework, adapter, description, descriptionOrigin, storyIds,
//     fields:  [{ name, schema, required, binding, descriptionOrigin }],   // supported properties
//     events:  [{ name, payload, description }],                           // outputs / callbacks (no A2UI mapping)
//     content: [{ name, typeText }],                                       // projected content (no A2UI mapping)
//     omitted: [{ kind, name, reason }],                                   // reported, never silent
//     blocking: [{ code, subject, message }],                              // reasons this component cannot export
//     source:  [{ name, type, required, blocking }],                       // every property the metadata lists, once
//   }
//
// `source` is what the metadata says, before any decision: `type` is the original type text (null when the metadata
// gives none), `required` is true, false or null (the metadata does not say), and `blocking` holds the blockers the
// adapter raised for that one property (the same objects as in the contract's `blocking`). Only supported-subset
// mode reads it.

import { componentNameProblem, isValidComponentName, propertyNameProblem } from './a2ui/catalog.mjs';

export const BLOCKING = {
  unsupportedType: 'UNSUPPORTED_PROP_TYPE',
  content: 'PROJECTED_CONTENT_UNMAPPED',
  noProps: 'NO_EXPORTABLE_PROPS',
  event: 'UNMAPPED_EVENT',
  manifest: 'MANIFEST_ENTRY_INVALID',
  index: 'INDEX_MISMATCH',
  default: 'UNSUPPORTED_DEFAULT',
  reservedName: 'A2UI_RESERVED_NAME',
  unsafeName: 'UNSAFE_NAME',
};

// Names A2UI v1.0 keeps for itself. The pinned structural validator rejects a catalog that uses them, which used to
// abort a whole multi-component export; checking here blocks only the component that cannot be represented.
const RESERVED_PROPERTIES = {
  id: "'id' belongs to the A2UI wire envelope",
  component: "'component' is the A2UI component discriminator",
};

export function blocker(code, subject, message) {
  return { code, subject, message };
}

/**
 * Apply the export policy.
 *  - Unsupported property types, projected content and an empty property surface block: exporting
 *    around them would narrow the contract without anyone choosing to. The one exception is chosen explicitly:
 *    with supportedSubset: true, a property with an unsupported type that the source marks optional is recorded
 *    as omitted (see omitOptionalUnsupported below), and the result lists every source property once.
 *  - Events/callbacks have no reviewed A2UI mapping. They block by default; with unmappedEvents: 'omit' the
 *    component exports its properties and every event is recorded in the report and in the component
 *    description, never dropped quietly.
 */
export function evaluate(contract, { unmappedEvents = 'fail', supportedSubset = false } = {}) {
  const blocking = [...contract.blocking];
  const omitted = [...contract.omitted];
  // Which blocking issues are about one source property, by property name. Only supported-subset mode reads this.
  const byProperty = new Map();
  const blockProperty = (code, name, message) => {
    const issue = blocker(code, name, message);
    blocking.push(issue);
    byProperty.set(name, [...(byProperty.get(name) ?? []), issue]);
  };
  if (supportedSubset) omitOptionalUnsupported(contract, blocking, omitted, byProperty);
  for (const content of contract.content)
    blockProperty(BLOCKING.content, content.name,
      `${content.name} (${content.typeText || 'projected content'}) is projected content; there is no reviewed A2UI content mapping.`);
  for (const event of contract.events) {
    if (unmappedEvents === 'omit')
      omitted.push({ kind: 'event', name: event.name, reason: `No reviewed A2UI event mapping (${event.payload || 'no payload type'}); not exported.` });
    else
      blockProperty(BLOCKING.event, event.name,
        `${event.name} (${event.payload || 'no payload type'}) is an event with no reviewed A2UI mapping. Use --unmapped-events omit to export the properties only, with this event recorded as not exported.`);
  }
  for (const field of contract.fields)
    if (Object.hasOwn(RESERVED_PROPERTIES, field.name))
      blockProperty(BLOCKING.reservedName, field.name,
        `Property "${field.name}" cannot be exported: ${RESERVED_PROPERTIES[field.name]}, so A2UI v1.0 does not allow it as a component property. This exporter does not rename or drop properties.`);
  for (const field of contract.fields)
    if (propertyNameProblem(field.name))
      blockProperty(BLOCKING.unsafeName, field.name,
        `Property "${field.name}" cannot be exported: ${propertyNameProblem(field.name)}. This exporter does not rename or drop properties.`);
  if (componentNameProblem(contract.name))
    blocking.push(blocker(BLOCKING.unsafeName, contract.name,
      `Component name "${contract.name}" cannot be exported: ${componentNameProblem(contract.name)}. This exporter does not rename components.`));
  if (contract.name === 'Surface')
    blocking.push(blocker(BLOCKING.reservedName, contract.name, 'The component name "Surface" is reserved by A2UI v1.0.'));
  else if (!isValidComponentName(contract.name))
    blocking.push(blocker(BLOCKING.reservedName, contract.name, `"${contract.name}" is not a valid A2UI component name (it must be an identifier: letters, digits and underscores, not starting with a digit).`));
  if (!contract.fields.length && !blocking.some((issue) => issue.code === BLOCKING.noProps))
    blocking.push(blocker(BLOCKING.noProps, contract.name, 'No supported properties were found, so there is nothing to put in the catalog.'));
  if (!supportedSubset) return { exportable: blocking.length === 0, blocking, omitted };
  return { exportable: blocking.length === 0, blocking, omitted, sourceProperties: accountForSource(contract, omitted, byProperty) };
}

// ---- Supported-subset mode (opt-in). It has one omission rule, and everything else blocks exactly as without it.

/**
 * Why a property with an unsupported type may not be left out, or null when it may.
 * Only `required: false` in the metadata counts as optional. A missing or non-boolean value is unknown, not optional.
 * A name A2UI reserves is not left out either: the catalog has its own "id" and "component", so dropping the source
 * property of that name needs a reviewed rule about what a renderer does with it.
 */
function whyNotOmitted(property) {
  if (property.required === true) return 'the source metadata marks it required';
  if (property.required !== false) return 'the source metadata does not say whether it is required';
  if (Object.hasOwn(RESERVED_PROPERTIES, property.name)) return `"${property.name}" is a name A2UI reserves, and leaving out a reserved name needs its own reviewed rule`;
  return null;
}

/**
 * The omission rule: a property whose only problem is an unsupported type, and which the source marks optional,
 * moves from `blocking` to `omitted`. A property with an unsupported type that stays blocked says why in its message.
 * Content, events, reserved names, unsupported defaults and metadata errors are not touched.
 * `byProperty` receives the blockers that remain for each property.
 */
function omitOptionalUnsupported(contract, blocking, omitted, byProperty) {
  const replace = (issue, ...replacement) => {
    const at = blocking.indexOf(issue);
    if (at >= 0) blocking.splice(at, 1, ...replacement);
  };
  for (const property of contract.source) {
    if (!property.blocking.length) continue;
    const onlyUnsupported = property.blocking.every((issue) => issue.code === BLOCKING.unsupportedType);
    const why = onlyUnsupported ? whyNotOmitted(property) : null;
    if (onlyUnsupported && !why) {
      for (const issue of property.blocking) replace(issue);
      omitted.push({ kind: 'property', name: property.name,
        reason: `${property.blocking.map((issue) => issue.message).join(' ')} The source metadata marks it optional (required: false), so supported-subset mode leaves it out of the A2UI component.` });
      continue;
    }
    byProperty.set(property.name, property.blocking.map((issue) => {
      if (!why) return issue;
      const explained = { ...issue, message: `${issue.message} Supported-subset mode does not omit it: ${why}.` };
      replace(issue, explained);
      return explained;
    }));
  }
}

/**
 * One entry per source property, in source order: what the metadata says (type, requiredness) and the one thing the
 * policy decided for it. "blocked" wins over "omitted", which wins over "supported", so no property is counted twice.
 *   supported: the property can be represented directly in A2UI.
 *   omitted:   the property is deliberately left out.
 *   blocked:   the property prevents export.
 *   mapped:    reserved for explicit reviewed mappings to another A2UI type; no property gets it yet.
 * "supported" is about the property; "exported" is the status of a component that was written to the catalog. One
 * blocked property, or a problem with the component itself, blocks the whole component, supported properties included.
 */
function accountForSource(contract, omitted, byProperty) {
  const names = new Set(contract.source.map((property) => property.name));
  const fields = new Set(contract.fields.map((field) => field.name));
  const decided = [...fields, ...contract.events.map((event) => event.name), ...contract.content.map((content) => content.name),
    ...omitted.map((item) => item.name), ...byProperty.keys()];
  const unlisted = decided.find((name) => !names.has(name));
  if (names.size !== contract.source.length || unlisted !== undefined)
    throw new Error(`Internal error: the source properties of ${contract.name} are not listed exactly once${unlisted !== undefined ? ` ("${unlisted}" is missing)` : ''}.`);
  return contract.source.map((property) => {
    const entry = { name: property.name, sourceType: property.type,
      requiredness: property.required === true ? 'required' : property.required === false ? 'optional' : 'unknown' };
    const issues = byProperty.get(property.name);
    if (issues) return { ...entry, disposition: 'blocked', reason: issues.map((issue) => `${issue.code}: ${issue.message}`).join(' ') };
    const omission = omitted.find((item) => item.name === property.name);
    if (omission) return { ...entry, disposition: 'omitted', reason: omission.reason };
    if (fields.has(property.name)) return { ...entry, disposition: 'supported' };
    throw new Error(`Internal error: source property "${property.name}" of ${contract.name} was neither supported, omitted nor blocked.`);
  });
}

// Storybook metadata may not list everything a component accepts (for example props inherited from an HTML
// element type), and this exporter cannot see what the metadata leaves out.
export const SCOPE_NOTE = 'Properties listed by Storybook metadata only; inherited HTML/DOM attributes and handlers are not part of this schema. ' +
  'Projected content (for example React children) may be missing from Storybook metadata and is not described here.';

/**
 * What the report may claim about the source contract. Conversion of the exposed metadata is not verification.
 * "present" only where the metadata itself shows it (a listed DOM attribute, a listed children/content property);
 * otherwise "unknown", because absence from Storybook metadata is not evidence of absence.
 */
export function contractStatus(omitted, content = []) {
  return {
    basis: 'storybook-manifest',
    sourceContractVerified: false,
    inheritedAttributes: omitted.some((item) => item.kind === 'dom-attribute') ? 'present' : 'unknown',
    projectedContent: content.length ? 'present' : 'unknown',
  };
}

const list = (omitted, kind) => omitted.filter((item) => item.kind === kind).map((item) => item.name);

/** Shape accepted by the existing makeCatalogV1. Omissions are stated in the description so consumers see them. */
export function toGeneratorComponent(contract, omitted) {
  const notes = [];
  const events = list(omitted, 'event');
  if (events.length) notes.push(`Events not exported (no reviewed A2UI mapping): ${events.join(', ')}.`);
  const dom = list(omitted, 'dom-attribute');
  if (dom.length) notes.push(`Inherited DOM attributes not exported: ${dom.join(', ')}.`);
  const properties = list(omitted, 'property');
  if (properties.length) notes.push(`Narrower interface than the source component: these optional properties have types this exporter does not represent in A2UI and are not exported: ${properties.join(', ')}.`);
  notes.push(SCOPE_NOTE);
  const base = contract.description || `${contract.name} component definition exported from ${contract.framework}.`;
  return {
    name: contract.name,
    description: `${base} ${notes.join(' ')}`,
    descriptionOrigin: contract.descriptionOrigin,
    fields: contract.fields,
    required: contract.fields.filter((field) => field.required === true).map((field) => field.name),
    events: {},
    callbacks: [],
    content: {},
    framework: contract.framework,
    warnings: [],
  };
}
