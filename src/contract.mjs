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
//   }

export const BLOCKING = {
  unsupportedType: 'UNSUPPORTED_PROP_TYPE',
  content: 'PROJECTED_CONTENT_UNMAPPED',
  noProps: 'NO_EXPORTABLE_PROPS',
  event: 'UNMAPPED_EVENT',
  manifest: 'MANIFEST_ENTRY_INVALID',
  index: 'INDEX_MISMATCH',
  default: 'UNSUPPORTED_DEFAULT',
};

export function blocker(code, subject, message) {
  return { code, subject, message };
}

/**
 * Apply the export policy.
 *  - Unsupported property types, projected content and an empty property surface always block: exporting
 *    around them would narrow the contract without anyone choosing to.
 *  - Events/callbacks have no reviewed A2UI mapping. They block by default; with unmappedEvents: 'omit' the
 *    component exports its properties and every event is recorded in the report and in the component
 *    description, never dropped quietly.
 */
export function evaluate(contract, { unmappedEvents = 'fail' } = {}) {
  const blocking = [...contract.blocking];
  const omitted = [...contract.omitted];
  for (const content of contract.content)
    blocking.push(blocker(BLOCKING.content, content.name,
      `${content.name} (${content.typeText || 'projected content'}) is projected content; there is no reviewed A2UI content mapping.`));
  for (const event of contract.events) {
    if (unmappedEvents === 'omit')
      omitted.push({ kind: 'event', name: event.name, reason: `No reviewed A2UI event mapping (${event.payload || 'no payload type'}); not exported.` });
    else
      blocking.push(blocker(BLOCKING.event, event.name,
        `${event.name} (${event.payload || 'no payload type'}) is an event with no reviewed A2UI mapping. Use --unmapped-events omit to export the properties only, with this event recorded as not exported.`));
  }
  if (!contract.fields.length && !blocking.some((issue) => issue.code === BLOCKING.noProps))
    blocking.push(blocker(BLOCKING.noProps, contract.name, 'No supported properties were found, so there is nothing to put in the catalog.'));
  return { exportable: blocking.length === 0, blocking, omitted };
}

// Storybook metadata may not list everything a component accepts (for example props inherited from an HTML
// element type), and this exporter cannot see what the metadata leaves out.
export const SCOPE_NOTE = 'Properties listed by Storybook metadata only; inherited HTML/DOM attributes and handlers are not part of this schema.';

/** What the report may claim about the source contract. Conversion of the exposed metadata is not verification. */
export function contractStatus(omitted) {
  return {
    basis: 'storybook-manifest',
    sourceContractVerified: false,
    inheritedAttributes: omitted.some((item) => item.kind === 'dom-attribute') ? 'present' : 'unknown',
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
