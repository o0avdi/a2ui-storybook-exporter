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
//     content: [{ name, typeText, acceptsText, description }],             // projected content (no A2UI mapping)
//     omitted: [{ kind, name, reason }],                                   // reported, never silent
//     blocking: [{ code, subject, message }],                              // reasons this component cannot export
//     source:  [{ name, type, required, blocking }],                       // every property the metadata lists, once
//   }
//
// `source` is what the metadata says, before any decision: `type` is the original type text (null when the metadata
// gives none), `required` is true, false or null (the metadata does not say), and `blocking` holds the blockers the
// adapter raised for that one property (the same objects as in the contract's `blocking`). Only supported-subset
// mode reads it. `acceptsText` on a content entry is true only when the source type admits a plain string; it is what
// allows a reviewed mapping to export that content as text.
//
// A contract is read-only here: `evaluate` returns its decisions and the list of fields to export, and never changes
// the contract it was given.

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

export const isReservedProperty = (name) => Object.hasOwn(RESERVED_PROPERTIES, name);

export function blocker(code, subject, message) {
  return { code, subject, message };
}

/**
 * Apply the export policy.
 *  - Unsupported property types, projected content and an empty property surface block: exporting
 *    around them would narrow the contract without anyone choosing to. The exceptions are chosen explicitly, with
 *    supportedSubset: true (see decideSourceProperties below), and the result then lists every source property once.
 *  - Events/callbacks have no reviewed A2UI mapping. They block by default; with unmappedEvents: 'omit' the
 *    component exports its properties and every event is recorded in the report and in the component
 *    description, never dropped quietly.
 * `mappings` is the checked mapping of this one component (property name to { map, reason }), read only in
 * supported-subset mode. The result's `fields` are the properties to export: the contract's own, unless that mode
 * left some out or mapped content to text.
 */
export function evaluate(contract, { unmappedEvents = 'fail', supportedSubset = false, mappings } = {}) {
  if (mappings && !supportedSubset) throw new Error('Internal error: mappings are read only in supported-subset mode.');
  const blocking = [...contract.blocking];
  const omitted = [...contract.omitted];
  // Which blocking issues are about one source property, by property name. Only supported-subset mode reads this.
  const byProperty = new Map();
  const blockProperty = (code, name, message) => {
    const issue = blocker(code, name, message);
    blocking.push(issue);
    byProperty.set(name, [...(byProperty.get(name) ?? []), issue]);
  };
  // What supported-subset mode decides: `taken` holds the names it takes out of the contract's fields, content and
  // events (left out, or mapped), `mapped` the content it turns into text fields. Both stay empty without the mode.
  const taken = new Set();
  const mapped = [];
  if (supportedSubset) decideSourceProperties(contract, mappings, { unmappedEvents, blocking, omitted, byProperty, taken, mapped });
  const remaining = (list) => (taken.size ? list.filter((item) => !taken.has(item.name)) : list);
  const content = remaining(contract.content);
  const events = remaining(contract.events);
  const fields = taken.size ? inSourceOrder(contract, [...remaining(contract.fields), ...mapped.map((item) => item.field)]) : contract.fields;
  for (const item of content)
    blockProperty(BLOCKING.content, item.name,
      `${item.name} (${item.typeText || 'projected content'}) is projected content; there is no reviewed A2UI content mapping.`);
  for (const event of events) {
    if (unmappedEvents === 'omit')
      omitted.push({ kind: 'event', name: event.name, reason: `No reviewed A2UI event mapping (${event.payload || 'no payload type'}); not exported.` });
    else
      blockProperty(BLOCKING.event, event.name,
        `${event.name} (${event.payload || 'no payload type'}) is an event with no reviewed A2UI mapping. Use --unmapped-events omit to export the properties only, with this event recorded as not exported.`);
  }
  for (const field of fields)
    if (isReservedProperty(field.name))
      blockProperty(BLOCKING.reservedName, field.name,
        `Property "${field.name}" cannot be exported: ${RESERVED_PROPERTIES[field.name]}, so A2UI v1.0 does not allow it as a component property. This exporter does not rename or drop properties.` +
        (supportedSubset ? ` Supported-subset mode does not omit it: ${whyReservedKept(contract.source.find((property) => property.name === field.name))}.` : ''));
  for (const field of fields)
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
  if (!fields.length && !blocking.some((issue) => issue.code === BLOCKING.noProps))
    blocking.push(blocker(BLOCKING.noProps, contract.name, 'No supported properties were found, so there is nothing to put in the catalog.'));
  const result = { exportable: blocking.length === 0, blocking, omitted, fields, mapped };
  if (!supportedSubset) return result;
  return { ...result, sourceProperties: accountForSource(contract, { fields, content, events, omitted, byProperty, mapped }) };
}

// ---- Supported-subset mode (opt-in). It leaves a property out for one of three stated reasons, or maps content to
// text when a reviewed mapping says so. Everything else blocks exactly as without it.

/**
 * Why a property may not be left out, or null when it may.
 * Only `required: false` in the metadata counts as optional. A missing or non-boolean value is unknown, not optional.
 */
function whyNotOmitted(property) {
  if (property.required === true) return 'the source metadata marks it required';
  if (property.required !== false) return 'the source metadata does not say whether it is required';
  return null;
}

/**
 * Why a mapping may not leave a property out, or null when it may. An explicit omission is a choice about an optional
 * property. It is never a way around an error in the source metadata (an invalid or unverified default, for example),
 * nor around --unmapped-events fail: an event may be named only when the run omits events anyway.
 */
export function whyMappingCannotOmit(contract, property, unmappedEvents) {
  const required = whyNotOmitted(property);
  if (required) return `${required}.`;
  const error = property.blocking.find((issue) => issue.code !== BLOCKING.unsupportedType);
  if (error) return `its source metadata has an error, which a mapping must not hide (${error.code}: ${error.message})`;
  if (unmappedEvents !== 'omit' && contract.events.some((event) => event.name === property.name))
    return 'it is an event, and events block under --unmapped-events fail. Pass --unmapped-events omit (unmappedEvents: "omit") to leave events out.';
  return null;
}

/** A new list of fields in the order the source lists them, so a text field sits where its source property is. */
function inSourceOrder(contract, fields) {
  const order = new Map(contract.source.map((property, index) => [property.name, index]));
  return fields.sort((a, b) => order.get(a.name) - order.get(b.name));
}

/** Why a property with a name A2UI reserves is still an exported field, and so blocks. */
const whyReservedKept = (property) => (property && whyNotOmitted(property)) ?? 'its metadata has an error, which is never left out automatically';

const onlyUnsupportedType = (property) => property.blocking.every((issue) => issue.code === BLOCKING.unsupportedType);

/**
 * One pass over the source properties, in source order. The first rule that applies decides:
 *  1. Mapping "omit" (explicit): the property is left out with the reason the mappings file gives. The mapping was
 *     checked beforehand (whyMappingCannotOmit): the source marks the property optional, its metadata has no error,
 *     and an event is named only when the run omits events.
 *  2. Mapping "text" (explicit): content the source types as accepting a string becomes a string field under the
 *     same name, with the source requiredness. A2UI then accepts a string where the source accepts more.
 *  3. Reserved name: an optional property named "id" or "component" is left out, whatever its type, because A2UI uses
 *     both names itself. Required, unknown requiredness or a metadata error on it still blocks.
 *  4. Unsupported type: a property whose only problem is its type, and which the source marks optional, is left out.
 *     One that stays blocked says why in its message.
 * Content and events without a mapping, unsupported defaults and metadata errors are not touched.
 * `taken` receives every name rules 1 to 3 decide, `byProperty` the blockers that remain for each property.
 */
function decideSourceProperties(contract, mappings, { unmappedEvents, blocking, omitted, byProperty, taken, mapped }) {
  const replace = (issue, ...replacement) => {
    const at = blocking.indexOf(issue);
    if (at >= 0) blocking.splice(at, 1, ...replacement);
  };
  // Leave a property out: its own blockers go, and so does an omission the adapter already recorded under its name.
  const leaveOut = (property, kind, reason) => {
    for (const issue of property.blocking) replace(issue);
    const recorded = omitted.findIndex((item) => item.name === property.name);
    if (recorded >= 0) omitted.splice(recorded, 1);
    taken.add(property.name);
    omitted.push({ kind, name: property.name, reason });
  };
  const content = new Map(contract.content.map((item) => [item.name, item]));
  for (const property of contract.source) {
    const mapping = mappings?.get(property.name);
    if (mapping?.map === 'omit') {
      if (whyMappingCannotOmit(contract, property, unmappedEvents))
        throw new Error(`Internal error: ${contract.name}.${property.name} was omitted by a mapping that the checks do not allow.`);
      leaveOut(property, 'mapping', `Left out by the mappings file: ${mapping.reason}`);
      continue;
    }
    if (mapping?.map === 'text') {
      const source = content.get(property.name);
      if (source?.acceptsText !== true) throw new Error(`Internal error: ${contract.name}.${property.name} was mapped to text without source content that accepts a string.`);
      const description = `${source.description ? `${source.description} ` : ''}Text only. The source type is ${source.typeText}; this catalog accepts a string.`;
      taken.add(property.name);
      mapped.push({ name: property.name, map: 'text', sourceType: source.typeText,
        field: { name: property.name, schema: { type: 'string', description }, required: property.required, binding: true } });
      if (property.blocking.length) byProperty.set(property.name, [...property.blocking]);
      continue;
    }
    if (isReservedProperty(property.name) && property.required === false && onlyUnsupportedType(property)) {
      leaveOut(property, 'reserved-name',
        `Property "${property.name}" is not exported: ${RESERVED_PROPERTIES[property.name]}, so A2UI v1.0 does not allow it as a component property. ` +
        'The source metadata marks it optional (required: false), so supported-subset mode leaves it out of the A2UI component. ' +
        `A renderer must never pass the A2UI "${property.name}" of an instance to the source component as this property.`);
      continue;
    }
    if (!property.blocking.length) continue;
    const why = onlyUnsupportedType(property) ? whyNotOmitted(property) : null;
    if (onlyUnsupportedType(property) && !why) {
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
 * policy decided for it. "blocked" wins over "mapped", which wins over "omitted", which wins over "supported", so no
 * property is counted twice.
 *   supported: the property can be represented directly in A2UI.
 *   mapped:    a reviewed mapping represents it as another A2UI type (today: content as text); `mapping` names it.
 *   omitted:   the property is deliberately left out.
 *   blocked:   the property prevents export.
 * "supported" is about the property; "exported" is the status of a component that was written to the catalog. One
 * blocked property, or a problem with the component itself, blocks the whole component, supported properties included.
 */
function accountForSource(contract, { fields, content, events, omitted, byProperty, mapped }) {
  const names = new Set(contract.source.map((property) => property.name));
  const exported = new Set(fields.map((field) => field.name));
  const decided = [...exported, ...events.map((event) => event.name), ...content.map((item) => item.name),
    ...omitted.map((item) => item.name), ...byProperty.keys()];
  const unlisted = decided.find((name) => !names.has(name));
  if (names.size !== contract.source.length || unlisted !== undefined)
    throw new Error(`Internal error: the source properties of ${contract.name} are not listed exactly once${unlisted !== undefined ? ` ("${unlisted}" is missing)` : ''}.`);
  return contract.source.map((property) => {
    const entry = { name: property.name, sourceType: property.type,
      requiredness: property.required === true ? 'required' : property.required === false ? 'optional' : 'unknown' };
    const issues = byProperty.get(property.name);
    if (issues) return { ...entry, disposition: 'blocked', reason: issues.map((issue) => `${issue.code}: ${issue.message}`).join(' ') };
    const mapping = mapped.find((item) => item.name === property.name);
    if (mapping) return { ...entry, disposition: 'mapped', mapping: mapping.map,
      reason: `Mapped to text by the mappings file: the source type ${mapping.sourceType} accepts a string, and the A2UI property accepts only a string (DynamicString), which is narrower than the source.` };
    const omission = omitted.find((item) => item.name === property.name);
    if (omission) return { ...entry, disposition: 'omitted', reason: omission.reason };
    if (exported.has(property.name)) return { ...entry, disposition: 'supported' };
    throw new Error(`Internal error: source property "${property.name}" of ${contract.name} was neither supported, mapped, omitted nor blocked.`);
  });
}

// Storybook metadata may not list everything a component accepts (for example props inherited from an HTML
// element type), and this exporter cannot see what the metadata leaves out.
const SCOPE_PROPERTIES = 'Properties listed by Storybook metadata only; inherited HTML/DOM attributes and handlers are not part of this schema. ';
export const SCOPE_NOTE = SCOPE_PROPERTIES + 'Projected content (for example React children) may be missing from Storybook metadata and is not described here.';
// The second sentence when a mapping exports content as text: the general one would then contradict the schema.
const SCOPE_NOTE_TEXT = SCOPE_PROPERTIES + 'Projected content is described only by the text properties named above; other content the source accepts is not part of this schema.';

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

/**
 * Shape accepted by the existing makeCatalogV1. Omissions and mappings are stated in the description so consumers see
 * them. `fields` and `mapped` come from `evaluate`; without supported-subset mode they are the contract's own fields
 * and an empty list.
 */
export function toGeneratorComponent(contract, omitted, fields = contract.fields, mapped = []) {
  const notes = [];
  const events = list(omitted, 'event');
  if (events.length) notes.push(`Events not exported (no reviewed A2UI mapping): ${events.join(', ')}.`);
  const dom = list(omitted, 'dom-attribute');
  if (dom.length) notes.push(`Inherited DOM attributes not exported: ${dom.join(', ')}.`);
  const properties = list(omitted, 'property');
  if (properties.length) notes.push(`Narrower interface than the source component: these optional properties have types this exporter does not represent in A2UI and are not exported: ${properties.join(', ')}.`);
  const reserved = list(omitted, 'reserved-name');
  if (reserved.length) notes.push(`Optional source properties with a name A2UI reserves are not exported: ${reserved.join(', ')}. The A2UI "component" and "id" of an instance are never passed to the source component as these properties.`);
  const explicit = list(omitted, 'mapping');
  if (explicit.length) notes.push(`Left out by an explicit mapping: ${explicit.join(', ')}.`);
  if (mapped.length) notes.push(`Text only, where the source accepts more (explicit mapping): ${mapped.map((item) => `${item.name} (source type ${item.sourceType})`).join(', ')}.`);
  notes.push(mapped.length ? SCOPE_NOTE_TEXT : SCOPE_NOTE);
  const base = contract.description || `${contract.name} component definition exported from ${contract.framework}.`;
  return {
    name: contract.name,
    description: `${base} ${notes.join(' ')}`,
    descriptionOrigin: contract.descriptionOrigin,
    fields,
    required: fields.filter((field) => field.required === true).map((field) => field.name),
    events: {},
    callbacks: [],
    content: {},
    framework: contract.framework,
    warnings: [],
  };
}
