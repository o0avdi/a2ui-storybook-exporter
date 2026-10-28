export const catalogIdRequirements = 'Must be an absolute HTTP(S) URI with a path such as https://example.org/catalogs/1, without fragments or whitespace. URNs and other non-HTTP(S) schemes are unsupported because relative schema references cannot resolve against opaque IDs.';

/** Component names must be UAX #31 identifiers (A2UI v1.0). */
export const isValidComponentName = (name) => typeof name === 'string' && /^[\p{XID_Start}_][\p{XID_Continue}]*$/u.test(name);

/**
 * Validate catalog identifier according to A2UI v1.0 and JSON Schema Draft 2020-12 canonical URI rules.
 * Requires a non-empty string, no whitespace, no URI fragments, and an HTTP(S) base for relative schema references.
 */
export function isValidCatalogId(id) {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed || trimmed !== id) return false;
  if (/\s/.test(id)) return false;
  if (id.includes('#')) return false;
  try {
    const url = new URL(id);
    return ['https:', 'http:'].includes(url.protocol) && /^https?:\/\/[^/?#]+\//i.test(id);
  } catch {
    return false;
  }
}

/**
 * Generate usage instructions for the exported components. No component is treated specially by name:
 * a component gets a line only if the caller supplies reviewed instructions for it
 * (`options.reviewedPolicies[name].instructions` or `options.componentInstructions[name]`).
 */
export function generateInstructions(componentNames = [], options = {}) {
  const lines = ['## Layout & Usage Guidelines\n'];
  let step = 1;

  lines.push(
    `${step++}. Surface Hierarchy: Top-level components must be placed within 'Surface' container roots. Component envelopes supply unique instance IDs via 'id'.`,
  );

  for (const name of componentNames) {
    const customInst =
      options.reviewedPolicies?.[name]?.instructions ??
      options.componentInstructions?.[name];
    if (customInst) {
      lines.push(`${step++}. ${customInst}`);
    }
  }

  // Functions: only mention if catalog defines active functions
  const functionCount = options.functions ? Object.keys(options.functions).length : 0;
  if (functionCount > 0) {
    lines.push(`${step++}. Functions: Active catalog functions are invoked using @call envelopes.`);
  }

  return lines.join('\n');
}

const emittedNullTypes = (property) => [property.type, ...(property.oneOf ?? []).map((option) => option.type)].flat();
// Whether the generated schema itself accepts null (not merely whether the source type mentioned null).
const propertyAdmitsNull = (property) => emittedNullTypes(property).includes('null') || Boolean(property.enum?.includes(null)) ||
  Boolean(property.oneOf?.some((option) => option.enum?.includes(null)));

/**
 * Format one field. A null default is source semantics: it is emitted only when the generated property admits
 * null, and is otherwise a blocking error instead of being dropped or contradicting the type.
 */
export function formatFieldPropertyV1(field, componentName, options = {}) {
  const property = formatFieldPropertyInner(field, componentName, options);
  // Explicitly reviewed schemas are hand-authored and returned verbatim, exactly as before.
  const reviewed = options.reviewedPropertySchemas?.[componentName]?.[field.name] ?? field.reviewedSchema;
  if (reviewed || property?.default !== null || propertyAdmitsNull(property)) return property;
  const errorMessage = `NULL_DEFAULT_NOT_ALLOWED: '${componentName}.${field.name}' declares a null default but the generated property does not admit null. Declare the type as nullable in source (for example string | null) or remove the null default; the exporter will not drop or reinterpret it.`;
  if (options.diagnostics && Array.isArray(options.diagnostics)) {
    options.diagnostics.push({ code: 'NULL_DEFAULT_NOT_ALLOWED', severity: 'error', blocking: true, component: componentName, field: field.name, message: errorMessage });
    return null;
  }
  throw new Error(errorMessage);
}

/**
 * Format a single component field into an A2UI v1.0 compliant JSON Schema property.
 * Strictly preserves supported scalar types, unions, enums, and nullability where backed by source evidence.
 * Disallows silent type widening of unrecognized types (objects, callbacks, React nodes, functions, unknown generics)
 * into DynamicValue without explicit reviewed schema mappings.
 */
function formatFieldPropertyInner(field, componentName, options = {}) {
  // Check for explicit reviewed property schema override
  const reviewedSchema =
    options.reviewedPropertySchemas?.[componentName]?.[field.name] ??
    field.reviewedSchema;
  if (reviewedSchema) {
    return reviewedSchema;
  }

  // Contract hardening: Reject missing, empty, or untyped schema (Task 2 & 10)
  if (
    !field ||
    typeof field !== 'object' ||
    !field.schema ||
    typeof field.schema !== 'object' ||
    (!field.schema.type &&
      !field.schema.$ref &&
      !field.schema.enum &&
      !field.schema.anyOf &&
      !field.schema.oneOf)
  ) {
    const errorMessage = `Unsupported property type for '${componentName}.${field?.name ?? 'unknown'}' (unspecified/unknown). Missing or unspecified source type; JavaScript/untyped properties require reviewed schema mappings; generator will not fabricate types.`;
    if (options.diagnostics && Array.isArray(options.diagnostics)) {
      options.diagnostics.push({
        code: 'UNSPECIFIED_SOURCE_TYPE',
        severity: 'error',
        blocking: true,
        component: componentName,
        field: field?.name,
        message: errorMessage,
      });
      return null;
    }
    throw new Error(errorMessage);
  }

  const schema = { ...field.schema };
  const description = schema.description ?? field.description;
  // A declared null default is source semantics, not an absent default (`??` would drop it).
  const defaultValue = schema.default !== undefined ? schema.default : field.default;

  // Reject unconstrained source types (any, unknown)
  if (schema.type === 'any' || schema.type === 'unknown') {
    const errorMessage = `Unsupported property type for '${componentName}.${field.name}' (${JSON.stringify(schema.type)}). Unconstrained source type '${schema.type}'; JavaScript/untyped properties require reviewed schema mappings; generator will not fabricate types.`;
    if (options.diagnostics && Array.isArray(options.diagnostics)) {
      options.diagnostics.push({
        code: 'UNCONSTRAINED_SOURCE_TYPE',
        severity: 'error',
        blocking: true,
        component: componentName,
        field: field.name,
        message: errorMessage,
      });
      return null;
    }
    throw new Error(errorMessage);
  }

  // 1. Union scalar types like number | string
  const isNumberStringUnion =
    (Array.isArray(schema.type) &&
      schema.type.includes('number') &&
      schema.type.includes('string')) ||
    (Array.isArray(schema.anyOf) &&
      schema.anyOf.some((s) => s.type === 'number') &&
      schema.anyOf.some((s) => s.type === 'string')) ||
    (Array.isArray(schema.oneOf) &&
      schema.oneOf.some((s) => s.type === 'number') &&
      schema.oneOf.some((s) => s.type === 'string'));

  const isNullableUnion =
    isNumberStringUnion &&
    ((Array.isArray(schema.type) && schema.type.includes('null')) ||
      schema.nullable === true ||
      (Array.isArray(schema.anyOf) && schema.anyOf.some((s) => s.type === 'null')) ||
      (Array.isArray(schema.oneOf) && schema.oneOf.some((s) => s.type === 'null')));

  if (isNumberStringUnion) {
    const defaultUnionDesc =
      'Dynamic value supporting literal numbers, strings, @path bindings, or function calls.';

    const unionOneOf = [{ type: 'number' }, { type: 'string' }];
    if (isNullableUnion) {
      unionOneOf.push({ type: 'null' });
    }
    unionOneOf.push(
      { $ref: 'common_types.json#/$defs/DataBinding' },
      { $ref: 'common_types.json#/$defs/FunctionCall' },
    );

    const prop = {
      description: description ?? defaultUnionDesc,
      oneOf: unionOneOf,
    };
    if (defaultValue !== undefined) prop.default = defaultValue;
    return prop;
  }

  // 2. String enums with fixed allowed values (e.g. format, appearance, state)
  if (schema.enum && Array.isArray(schema.enum)) {
    if (schema.enum.length === 0) {
      const errorMessage = `Empty enum definition for '${componentName}.${field.name}'. An enum must specify at least one allowed value.`;
      if (options.diagnostics && Array.isArray(options.diagnostics)) {
        options.diagnostics.push({
          code: 'EMPTY_ENUM',
          severity: 'error',
          blocking: true,
          component: componentName,
          field: field.name,
          message: errorMessage,
        });
        return null;
      }
      throw new Error(errorMessage);
    }

    const hasNull = schema.enum.includes(null) || schema.nullable === true;
    const stringValues = schema.enum.filter((v) => typeof v === 'string');
    const hasUnsupportedValues = schema.enum.some(
      (v) => typeof v !== 'string' && v !== null,
    );

    if (hasUnsupportedValues) {
      const errorMessage = `Unsupported non-string enum values for '${componentName}.${field.name}'. A2UI v1.0 only supports string enums.`;
      if (options.diagnostics && Array.isArray(options.diagnostics)) {
        options.diagnostics.push({
          code: 'UNSUPPORTED_ENUM_TYPE',
          severity: 'error',
          blocking: true,
          component: componentName,
          field: field.name,
          message: errorMessage,
        });
        return null;
      }
      throw new Error(errorMessage);
    }

    if (hasNull) {
      const prop = {
        oneOf: [
          { type: 'string', enum: [...stringValues].sort() },
          { type: 'null' },
        ],
      };
      if (description) prop.description = description;
      if (defaultValue !== undefined) prop.default = defaultValue;
      return prop;
    }

    const prop = {
      type: 'string',
      enum: [...stringValues].sort(),
    };
    if (description) prop.description = description;
    if (defaultValue !== undefined) prop.default = defaultValue;
    return prop;
  }

  // 3. Nullable supported scalars (backed by source evidence e.g. string | null, number | null, boolean | null)
  const isNullableString =
    (Array.isArray(schema.type) && schema.type.includes('string') && schema.type.includes('null')) ||
    (schema.type === 'string' && schema.nullable === true) ||
    (Array.isArray(schema.anyOf) &&
      schema.anyOf.some((s) => s.type === 'string') &&
      schema.anyOf.some((s) => s.type === 'null')) ||
    (Array.isArray(schema.oneOf) &&
      schema.oneOf.some((s) => s.type === 'string') &&
      schema.oneOf.some((s) => s.type === 'null'));

  if (isNullableString) {
    const prop = {
      oneOf: [
        { type: 'string' },
        { type: 'null' },
        { $ref: 'common_types.json#/$defs/DataBinding' },
        { $ref: 'common_types.json#/$defs/FunctionCall' },
      ],
    };
    if (description) prop.description = description;
    if (defaultValue !== undefined) prop.default = defaultValue;
    return prop;
  }

  const isNullableNumber =
    (Array.isArray(schema.type) &&
      (schema.type.includes('number') || schema.type.includes('integer')) &&
      schema.type.includes('null')) ||
    ((schema.type === 'number' || schema.type === 'integer') && schema.nullable === true) ||
    (Array.isArray(schema.anyOf) &&
      schema.anyOf.some((s) => s.type === 'number' || s.type === 'integer') &&
      schema.anyOf.some((s) => s.type === 'null')) ||
    (Array.isArray(schema.oneOf) &&
      schema.oneOf.some((s) => s.type === 'number' || s.type === 'integer') &&
      schema.oneOf.some((s) => s.type === 'null'));

  if (isNullableNumber) {
    const prop = {
      oneOf: [
        { type: 'number' },
        { type: 'null' },
        { $ref: 'common_types.json#/$defs/DataBinding' },
        { $ref: 'common_types.json#/$defs/FunctionCall' },
      ],
    };
    if (description) prop.description = description;
    if (defaultValue !== undefined) prop.default = defaultValue;
    return prop;
  }

  const isNullableBoolean =
    (Array.isArray(schema.type) && schema.type.includes('boolean') && schema.type.includes('null')) ||
    (schema.type === 'boolean' && schema.nullable === true) ||
    (Array.isArray(schema.anyOf) &&
      schema.anyOf.some((s) => s.type === 'boolean') &&
      schema.anyOf.some((s) => s.type === 'null')) ||
    (Array.isArray(schema.oneOf) &&
      schema.oneOf.some((s) => s.type === 'boolean') &&
      schema.oneOf.some((s) => s.type === 'null'));

  if (isNullableBoolean) {
    const prop = {
      oneOf: [
        { type: 'boolean' },
        { type: 'null' },
        { $ref: 'common_types.json#/$defs/DataBinding' },
        { $ref: 'common_types.json#/$defs/FunctionCall' },
      ],
    };
    if (description) prop.description = description;
    if (defaultValue !== undefined) prop.default = defaultValue;
    return prop;
  }

  // 4. String scalars -> common_types.json#/$defs/DynamicString
  if (schema.type === 'string') {
    const prop = {
      $ref: 'common_types.json#/$defs/DynamicString',
    };
    if (description) prop.description = description;
    if (defaultValue !== undefined) prop.default = defaultValue;
    return prop;
  }

  // 5. Boolean scalars -> common_types.json#/$defs/DynamicBoolean
  if (schema.type === 'boolean') {
    const prop = {
      $ref: 'common_types.json#/$defs/DynamicBoolean',
    };
    if (description) prop.description = description;
    if (defaultValue !== undefined) prop.default = defaultValue;
    return prop;
  }

  // 6. Numeric scalars -> common_types.json#/$defs/DynamicNumber
  if (schema.type === 'number' || schema.type === 'integer') {
    const prop = {
      $ref: 'common_types.json#/$defs/DynamicNumber',
    };
    if (description) prop.description = description;
    if (defaultValue !== undefined) prop.default = defaultValue;
    return prop;
  }

  // 7. String list (array of strings) -> common_types.json#/$defs/DynamicStringList
  if (schema.type === 'array' && schema.items?.type === 'string') {
    const prop = {
      $ref: 'common_types.json#/$defs/DynamicStringList',
    };
    if (description) prop.description = description;
    if (defaultValue !== undefined) prop.default = defaultValue;
    return prop;
  }

  // 8. Unsupported types: reject silent type widening into DynamicValue
  const typeSummary = schema.type ? JSON.stringify(schema.type) : (schema.$ref ?? 'unspecified/unknown');
  const errorMessage = `Unsupported property type for '${componentName}.${field.name}' (${typeSummary}). A2UI v1.0 exporter does not permit widening unrecognized types (arbitrary objects, callbacks, React nodes, functions, unknown generics) into DynamicValue without an explicit reviewed schema.`;

  if (options.diagnostics && Array.isArray(options.diagnostics)) {
    options.diagnostics.push({
      code: 'UNSUPPORTED_PROPERTY_TYPE',
      severity: 'error',
      blocking: true,
      component: componentName,
      field: field.name,
      message: errorMessage,
    });
    return null;
  }

  throw new Error(errorMessage);
}

/**
 * Determine action property description from explicit reviewed policies or event metadata.
 * `origin` tells metadata reporting whether the text is reviewed or a generator fallback.
 */
export function actionDescriptionSource(componentName, eventName, options = {}) {
  const policy = options.reviewedPolicies?.[componentName];

  if (policy?.eventDescriptions?.[eventName]) {
    return { text: policy.eventDescriptions[eventName], origin: 'reviewed-policy' };
  }
  return { text: `Interaction handler dispatched for ${eventName} event.`, origin: 'generator-fallback' };
}

function getActionDescription(componentName, eventName, options = {}) {
  return actionDescriptionSource(componentName, eventName, options).text;
}

/** Generator-created component text used when extraction supplies none; reported as synthetic. */
export function defaultComponentDescription(c) {
  return c.framework
    ? `${c.name} component definition exported from ${c.framework}.`
    : `${c.name} component definition.`;
}

/**
 * Determine required properties for a component adhering to A2UI v1.0 specifications.
 * Enforces genuine requiredness from extracted source contracts and explicit reviewed policies.
 * A JSON Schema default does NOT make a property optional.
 */
export function getRequiredProperties(component, options = {}) {
  // 1. Explicit required list on component or metadata
  if (Array.isArray(component.required)) {
    return ['component', ...component.required.filter((p) => p !== 'component')];
  }
  if (Array.isArray(component.requiredProperties)) {
    return ['component', ...component.requiredProperties.filter((p) => p !== 'component')];
  }

  // 2. Explicit reviewed policy from options or default reviewed policies
  const policy =
    options.reviewedPolicies?.[component.name] ??
    component.policy;

  if (policy && Array.isArray(policy.required)) {
    return ['component', ...policy.required.filter((p) => p !== 'component')];
  }

  // 3. Extracted source requiredness: all fields where required === true
  // Note: A JSON Schema default does NOT make a property optional.
  const requiredFields = (component.fields ?? [])
    .filter((f) => f.required === true)
    .map((f) => f.name);

  // If policy or component designates required event actions
  const requiredEvents = policy?.requiredEvents ?? component.requiredEvents ?? [];
  const eventActionNames = requiredEvents
    .map((evt) => component.events?.[evt] ?? evt)
    .filter(Boolean);

  const combined = new Set(['component', ...requiredFields, ...eventActionNames]);
  return [...combined];
}

/**
 * Deep sort object keys to ensure deterministic serialization.
 */
export function sortDeterministic(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortDeterministic);
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortDeterministic(value[key]);
  }
  return sorted;
}

/**
 * Generate a strict A2UI v1.0 Catalog Definition from component metadata.
 */
export function makeCatalogV1(components, options = {}) {
  if (!components || !components.length) {
    throw new Error('makeCatalogV1: At least one supported component definition is required.');
  }

  const catalogId = options.catalogId;
  if (!isValidCatalogId(catalogId)) {
    throw new Error(
      `makeCatalogV1: Invalid catalogId '${catalogId}'. ${catalogIdRequirements}`,
    );
  }

  const allReact = components.every((c) => c.framework === 'react');

  const defaultTitle = options.projectName
    ? `${options.projectName} A2UI Catalog`
    : allReact
      ? 'React A2UI Catalog'
      : 'A2UI Component Catalog';

  const defaultDescription = options.projectDescription
    ? options.projectDescription
    : allReact
      ? 'Standardized components exported from React Storybook.'
      : 'Standardized A2UI v1.0 component catalog.';

  const title = options.title ?? defaultTitle;
  const description = options.description ?? defaultDescription;

  const componentSchemas = {};
  const componentNames = [];
  const seenComponentNames = new Set();

  for (const c of components) {
    if (!c.name || typeof c.name !== 'string') {
      throw new Error(`makeCatalogV1: Component missing valid name.`);
    }

    if (seenComponentNames.has(c.name)) {
      throw new Error(
        `makeCatalogV1: Duplicate component name '${c.name}' detected in catalog candidates.`,
      );
    }
    seenComponentNames.add(c.name);

    if (c.name === 'Surface') {
      throw new Error(`makeCatalogV1: Component name 'Surface' is reserved by the A2UI specification.`);
    }

    if (!isValidComponentName(c.name)) {
      throw new Error(`makeCatalogV1: Component name '${c.name}' violates UAX #31 identifier syntax.`);
    }

    componentNames.push(c.name);

    // Build component properties
    const properties = {
      component: { const: c.name },
    };

    // Add fields
    for (const f of c.fields ?? []) {
      if (!f || typeof f !== 'object' || !f.name || typeof f.name !== 'string') {
        throw new Error(
          `makeCatalogV1: Component '${c.name}' contains an unnamed or malformed field definition.`,
        );
      }

      const prop = formatFieldPropertyV1(f, c.name, options);
      if (prop !== null) {
        properties[f.name] = prop;
      } else {
        if (f.required === true) {
          throw new Error(
            `makeCatalogV1: Required field '${c.name}.${f.name}' cannot be omitted from catalog output despite unsupported type.`,
          );
        }
      }
    }

    // Add action properties from registered events
    if (c.events && typeof c.events === 'object') {
      for (const [eventName, propName] of Object.entries(c.events)) {
        if (!properties[propName]) {
          properties[propName] = {
            $ref: 'common_types.json#/$defs/Action',
            description: getActionDescription(c.name, eventName, options),
          };
        }
      }
    }

    // Determine required list
    const required = getRequiredProperties(c, options);

    // CRITICAL: Ensure every required property actually exists in generated properties
    for (const reqProp of required) {
      if (!(reqProp in properties)) {
        const errorMsg = `makeCatalogV1: Required property '${reqProp}' on component '${c.name}' is not defined in component properties.`;
        if (options.diagnostics && Array.isArray(options.diagnostics)) {
          options.diagnostics.push({
            code: 'MISSING_REQUIRED_PROPERTY_DEFINITION',
            severity: 'error',
            blocking: true,
            component: c.name,
            property: reqProp,
            message: errorMsg,
          });
        }
        throw new Error(errorMsg);
      }
    }

    const schema = {
      type: 'object',
      description: c.description ?? defaultComponentDescription(c),
      properties,
      required,
      additionalProperties: false,
    };

    if (Array.isArray(c.allowedParents) && c.allowedParents.length) {
      schema.allowedParents = [...new Set(c.allowedParents)].sort();
    }
    if (Array.isArray(c.allowedChildren) && c.allowedChildren.length) {
      schema.allowedChildren = [...new Set(c.allowedChildren)].sort();
    }

    componentSchemas[c.name] = schema;
  }

  const instructions =
    options.instructions ??
    generateInstructions(componentNames, {
      ...options,
      functions: options.functions ?? {},
    });

  // Synthesize root $defs strictly containing ONLY anyComponent and anyFunction
  const hasFunctions = Boolean(options.functions && Object.keys(options.functions).length > 0);
  const defs = {
    anyComponent: {
      oneOf: componentNames.sort().map((name) => ({
        $ref: `#/components/${name}`,
      })),
      discriminator: {
        propertyName: 'component',
      },
    },
    anyFunction: hasFunctions
      ? {
          oneOf: Object.keys(options.functions)
            .sort()
            .map((fnName) => ({
              $ref: `#/functions/${fnName}`,
            })),
        }
      : false,
  };

  const catalog = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: catalogId,
    protocolVersion: '1.0',
    title,
    description,
    catalogId,
    instructions,
    components: componentSchemas,
    functions: options.functions ?? {},
    $defs: defs,
  };

  return sortDeterministic(catalog);
}
