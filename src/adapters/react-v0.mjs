// React adapter: Storybook Components Manifest v0 (inline `reactDocgen` / `reactDocgenTypescript`).
//
// The property-by-property type classification is the existing, tested `react-manifest.mjs`; this file only
// maps its result into the shared contract and decides nothing about exportability.
import { normalizeReactManifest } from '../a2ui/react-manifest.mjs';
import { BLOCKING, blocker } from '../contract.mjs';

export const REACT_V0 = 'react-v0';

export function detectReactV0(manifest) {
  return manifest.v === 0 && Object.values(manifest.components).some((entry) => entry && (entry.reactDocgen || entry.reactDocgenTypescript));
}

export function readReactV0({ manifest }) {
  const result = normalizeReactManifest(manifest);
  return [...result.components, ...result.errors].map((component) => {
    const blocking = [];
    const omitted = [];
    for (const property of component.unsupportedProperties) {
      if (property.category === 'unsupported_dom')
        omitted.push({ kind: 'dom-attribute', name: property.name, reason: property.reason });
      else
        blocking.push(blocker(BLOCKING.unsupportedType, property.name,
          `${property.name}: ${property.reason}`));
    }
    for (const diagnostic of component.diagnostics.filter((item) => item.severity === 'error'))
      blocking.push(blocker(BLOCKING.manifest, diagnostic.property ?? component.name, diagnostic.message));
    return {
      id: component.id,
      name: component.name,
      framework: 'react',
      adapter: REACT_V0,
      description: component.description,
      descriptionOrigin: component.descriptionOrigin,
      storyIds: component.storyIds,
      fields: component.fields,
      events: component.callbacks.map((callback) => ({ name: callback.name, payload: callback.typeText, description: callback.description })),
      content: Object.entries(component.content).map(([name, value]) => ({ name, typeText: value.typeText })),
      omitted,
      blocking,
    };
  });
}
