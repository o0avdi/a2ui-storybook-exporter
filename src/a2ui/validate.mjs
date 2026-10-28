import Ajv2020 from 'ajv/dist/2020.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sortDeterministic, isValidCatalogId } from './catalog.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const specDir = path.resolve(__dirname, '../../spec/v1_0');

/**
 * Load the pinned official A2UI v1.0 specification schemas.
 */
export function loadOfficialSchemas(directory = specDir) {
  const catalogDefPath = path.join(directory, 'catalog_definition.json');
  const commonTypesPath = path.join(directory, 'common_types.json');

  if (!fs.existsSync(catalogDefPath)) {
    throw new Error(`Official catalog_definition.json not found in ${directory}`);
  }
  if (!fs.existsSync(commonTypesPath)) {
    throw new Error(`Official common_types.json not found in ${directory}`);
  }

  const catalogDefinition = JSON.parse(fs.readFileSync(catalogDefPath, 'utf8'));
  const commonTypes = JSON.parse(fs.readFileSync(commonTypesPath, 'utf8'));

  return { catalogDefinition, commonTypes };
}

/**
 * Recursively find and validate all $ref occurrences in an object.
 */
function collectRefs(obj, currentPath = '', refs = []) {
  if (!obj || typeof obj !== 'object') return refs;
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => collectRefs(item, `${currentPath}[${index}]`, refs));
    return refs;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref' && typeof value === 'string') {
      refs.push({ path: currentPath, ref: value });
    } else {
      collectRefs(value, currentPath ? `${currentPath}.${key}` : key, refs);
    }
  }
  return refs;
}

/**
 * Validate catalog reference integrity, including internal schema pointers and external common_types.json references.
 * Ensures a catalog is never reported as passing if component-level references or constraints are invalid.
 */
export function validateCatalogReferences(catalog, commonTypes) {
  const errors = [];

  if (!catalog || typeof catalog !== 'object') {
    return { valid: false, errors: ['Catalog must be a non-null object.'] };
  }

  // 1. Validate $defs.anyComponent alignment with components
  const anyComponent = catalog.$defs?.anyComponent;
  if (!anyComponent) {
    errors.push("Missing '$defs.anyComponent'.");
  } else {
    if (!anyComponent.discriminator || anyComponent.discriminator.propertyName !== 'component') {
      errors.push("Discriminator on '$defs.anyComponent' must declare propertyName 'component'.");
    }
    const componentNames = Object.keys(catalog.components ?? {});
    const oneOfRefs = (anyComponent.oneOf ?? []).map((o) => o.$ref);

    for (const name of componentNames) {
      const expectedRef = `#/components/${name}`;
      if (!oneOfRefs.includes(expectedRef)) {
        errors.push(`Component '${name}' defined in catalog.components is missing from $defs.anyComponent.oneOf.`);
      }
    }

    const seenOneOfRefs = new Set();
    for (const ref of oneOfRefs) {
      if (!ref || !ref.startsWith('#/components/')) {
        errors.push(`$defs.anyComponent.oneOf reference '${ref}' must target '#/components/<ComponentName>'.`);
      } else {
        if (seenOneOfRefs.has(ref)) {
          errors.push(`Duplicate component reference '${ref}' in $defs.anyComponent.oneOf.`);
        }
        seenOneOfRefs.add(ref);
        const targetName = ref.replace('#/components/', '');
        if (!catalog.components?.[targetName]) {
          errors.push(`$defs.anyComponent.oneOf references non-existent component '${targetName}'.`);
        }
      }
    }
  }

  // 1b. Validate $defs.anyFunction alignment with functions
  const anyFunction = catalog.$defs?.anyFunction;
  const functionNames = Object.keys(catalog.functions ?? {});
  if (functionNames.length > 0) {
    if (!anyFunction || typeof anyFunction !== 'object' || !Array.isArray(anyFunction.oneOf)) {
      errors.push("Catalog defines functions but '$defs.anyFunction' does not provide a valid 'oneOf' schema.");
    } else {
      const oneOfFnRefs = (anyFunction.oneOf ?? []).map((o) => o.$ref);
      for (const fnName of functionNames) {
        const expectedRef = `#/functions/${fnName}`;
        if (!oneOfFnRefs.includes(expectedRef)) {
          errors.push(`Function '${fnName}' defined in catalog.functions is missing from $defs.anyFunction.oneOf.`);
        }
      }
      const seenFnRefs = new Set();
      for (const ref of oneOfFnRefs) {
        if (!ref || !ref.startsWith('#/functions/')) {
          errors.push(`$defs.anyFunction.oneOf reference '${ref}' must target '#/functions/<FunctionName>'.`);
        } else {
          if (seenFnRefs.has(ref)) {
            errors.push(`Duplicate function reference '${ref}' in $defs.anyFunction.oneOf.`);
          }
          seenFnRefs.add(ref);
          const targetName = ref.replace('#/functions/', '');
          if (!catalog.functions?.[targetName]) {
            errors.push(`$defs.anyFunction.oneOf references non-existent function '${targetName}'.`);
          }
        }
      }
    }
  }

  // 2. Validate all $refs inside catalog.components
  const componentRefs = collectRefs(catalog.components, 'components');
  for (const { path: refPath, ref } of componentRefs) {
    if (ref.startsWith('common_types.json#/$defs/')) {
      const defName = ref.replace('common_types.json#/$defs/', '');
      if (!commonTypes.$defs || !(defName in commonTypes.$defs)) {
        errors.push(
          `Unresolved external reference '${ref}' at ${refPath}: '${defName}' is not defined in common_types.json.`,
        );
      }
    } else if (ref.startsWith('#/')) {
      // Internal reference
      const segments = ref.replace('#/', '').split('/');
      let current = catalog;
      let resolved = true;
      for (const seg of segments) {
        if (current && typeof current === 'object' && seg in current) {
          current = current[seg];
        } else {
          resolved = false;
          break;
        }
      }
      if (!resolved) {
        errors.push(`Unresolved internal reference '${ref}' at ${refPath}.`);
      }
    } else {
      errors.push(`Unsupported or malformed reference '${ref}' at ${refPath}.`);
    }
  }

  // 3. Validate individual component schema constraints
  if (catalog.components && typeof catalog.components === 'object') {
    for (const [name, comp] of Object.entries(catalog.components)) {
      if (comp.type !== 'object') {
        errors.push(`Component '${name}' schema type must be 'object'.`);
      }
      if (comp.additionalProperties !== false) {
        errors.push(`Component '${name}' must explicitly set 'additionalProperties: false'.`);
      }
      if (!Array.isArray(comp.required) || !comp.required.includes('component')) {
        errors.push(`Component '${name}' required list must include discriminator property 'component'.`);
      }
      if (comp.properties?.component?.const !== name) {
        errors.push(`Component '${name}' properties.component.const must equal '${name}'.`);
      }
      if (Array.isArray(comp.required)) {
        for (const reqProp of comp.required) {
          if (!comp.properties || !(reqProp in comp.properties)) {
            errors.push(
              `Component '${name}' required property '${reqProp}' does not exist in component properties.`,
            );
          }
        }
      }
    }
  }

  // 4. Verify Ajv compilation of anyComponent and component dereferencing
  try {
    const ajv = new Ajv2020({ strict: false, allErrors: true, discriminator: true });
    ajv.addSchema(commonTypes, 'common_types.json');
    if (catalog.$id) {
      const relativeCommonUrl = new URL('common_types.json', catalog.$id).href;
      if (relativeCommonUrl !== commonTypes.$id) {
        ajv.addSchema(commonTypes, relativeCommonUrl);
      }
      ajv.addSchema(catalog);
      ajv.addSchema({ ...catalog, $id: 'https://a2ui.org/specification/v1_0/catalog.json' });
      ajv.addSchema({ ...catalog, $id: 'catalog.json' });
      ajv.compile({ $ref: `${catalog.$id}#/$defs/anyComponent` });
    }
  } catch (err) {
    errors.push(`Ajv schema compilation / dereferencing failed: ${err.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create an Ajv2020 validator for A2UI v1.0 catalogs using official catalog_definition.json
 * combined with deep reference and constraint verification.
 */
export function createCatalogValidator(options = {}) {
  const { catalogDefinition, commonTypes } = loadOfficialSchemas(options.specDir);

  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
  });

  ajv.addSchema(commonTypes, 'common_types.json');

  const validate = ajv.compile(catalogDefinition);

  return function validateCatalogSchema(catalog) {
    const metaValid = validate(catalog);
    const metaErrors = validate.errors ? [...validate.errors] : [];

    // Also check deep reference and component-level constraints
    const refResult = validateCatalogReferences(catalog, commonTypes);
    const allErrors = [
      ...metaErrors,
      ...refResult.errors.map((msg) => ({
        instancePath: '',
        schemaPath: '#/components',
        keyword: 'reference',
        params: {},
        message: msg,
      })),
    ];

    return {
      valid: !!metaValid && refResult.valid,
      errors: allErrors,
      metaErrors,
      referenceErrors: refResult.errors,
    };
  };
}

/**
 * Validate specific A2UI v1.0 structural invariants.
 */
export function validateCatalogStructuralRules(catalog) {
  const errors = [];

  // 1. Root properties must strictly belong to the normative 10 fields
  const allowedRootProps = new Set([
    '$schema',
    '$id',
    'protocolVersion',
    '$defs',
    'title',
    'description',
    'catalogId',
    'instructions',
    'components',
    'functions',
  ]);

  for (const key of Object.keys(catalog)) {
    if (!allowedRootProps.has(key)) {
      errors.push(`Disallowed root property '${key}' violates catalog_definition additionalProperties: false.`);
    }
  }

  // 2. protocolVersion must be "1.0" or semantic version
  if (!catalog.protocolVersion) {
    errors.push(`Missing 'protocolVersion' at catalog root (defaults to legacy '0.9' if omitted).`);
  } else if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)/.test(catalog.protocolVersion)) {
    errors.push(`Invalid 'protocolVersion' format: '${catalog.protocolVersion}'.`);
  }

  // 3. $id must match catalogId
  if (!catalog.catalogId) {
    errors.push("Missing 'catalogId' at catalog root.");
  } else if (!isValidCatalogId(catalog.catalogId)) {
    errors.push(`Invalid 'catalogId': must be a valid non-empty URI without fragments or whitespace (found: '${catalog.catalogId}').`);
  }

  if (catalog.$id && catalog.catalogId && catalog.$id !== catalog.catalogId) {
    errors.push(`Root $id ('${catalog.$id}') does not match catalogId ('${catalog.catalogId}').`);
  }

  // 4. Strict $defs boundary: strictly ONLY anyComponent and anyFunction
  if (!catalog.$defs) {
    errors.push(`Missing mandatory root '$defs'.`);
  } else {
    const defKeys = Object.keys(catalog.$defs);
    const requiredDefs = ['anyComponent', 'anyFunction'];
    for (const req of requiredDefs) {
      if (!defKeys.includes(req)) {
        errors.push(`Root '$defs' missing required key '${req}'.`);
      }
    }
    for (const key of defKeys) {
      if (!requiredDefs.includes(key)) {
        errors.push(`Root '$defs' contains disallowed helper key '${key}'. In v1.0 only anyComponent and anyFunction are allowed.`);
      }
    }

    // Check discriminator on anyComponent
    if (catalog.$defs.anyComponent) {
      const anyComp = catalog.$defs.anyComponent;
      if (!anyComp.discriminator || anyComp.discriminator.propertyName !== 'component') {
        errors.push(`Root '$defs.anyComponent' must declare discriminator with propertyName 'component'.`);
      }
      if (!Array.isArray(anyComp.oneOf) || !anyComp.oneOf.length) {
        errors.push(`Root '$defs.anyComponent' must declare non-empty 'oneOf' array of component references.`);
      } else {
        const seen = new Set();
        for (const item of anyComp.oneOf) {
          if (item?.$ref) {
            if (seen.has(item.$ref)) {
              errors.push(`Root '$defs.anyComponent.oneOf' contains duplicate component reference '${item.$ref}'.`);
            }
            seen.add(item.$ref);
          }
        }
      }
    }
  }

  // 5. Component naming & discriminator checks
  if (catalog.components && typeof catalog.components === 'object') {
    for (const [name, comp] of Object.entries(catalog.components)) {
      if (name === 'Surface') {
        errors.push(`Component name 'Surface' is reserved by A2UI protocol specification.`);
      }
      if (!/^[\p{XID_Start}_][\p{XID_Continue}]*$/u.test(name)) {
        errors.push(`Component name '${name}' violates UAX #31 identifier syntax.`);
      }

      // Check discriminator const in component schema
      const compConst = comp.properties?.component?.const;
      if (compConst !== name) {
        errors.push(`Component '${name}' properties.component.const must match component key (found: '${compConst}').`);
      }

      // Ensure no component defines wire envelope property 'id'
      if (comp.properties?.id) {
        errors.push(`Component '${name}' defines envelope property 'id' in component properties. In v1.0, 'id' belongs strictly to wire protocol envelopes.`);
      }

      // Ensure no legacy allOf wrapping ComponentCommon
      if (Array.isArray(comp.allOf)) {
        for (const item of comp.allOf) {
          if (item.$ref && item.$ref.includes('ComponentCommon')) {
            errors.push(`Component '${name}' uses legacy allOf wrapping ComponentCommon.`);
          }
        }
      }

      // Check required properties exist in properties
      if (Array.isArray(comp.required)) {
        for (const reqProp of comp.required) {
          if (!comp.properties || !(reqProp in comp.properties)) {
            errors.push(
              `Component '${name}' required property '${reqProp}' does not exist in component properties.`,
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create an Ajv2020 validator for validating component instances against a catalog's anyComponent.
 */
export function createComponentInstanceValidator(catalog, options = {}) {
  const { commonTypes } = loadOfficialSchemas(options.specDir);

  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    discriminator: true,
  });

  // Register common_types.json under both canonical ID and relative name
  ajv.addSchema(commonTypes, 'common_types.json');
  ajv.addSchema(commonTypes, new URL('common_types.json', catalog.$id).href);

  // Register catalog under its canonical ID and standard relative alias
  ajv.addSchema(catalog);
  ajv.addSchema({ ...catalog, $id: 'https://a2ui.org/specification/v1_0/catalog.json' });
  ajv.addSchema({ ...catalog, $id: 'catalog.json' });

  const validate = ajv.compile({ $ref: `${catalog.$id}#/$defs/anyComponent` });

  return function validateComponentInstance(instance) {
    const valid = validate(instance);
    return {
      valid: !!valid,
      errors: validate.errors ? [...validate.errors] : [],
    };
  };
}

/**
 * Validate a generated catalog against the pinned official A2UI v1.0 schemas, including compilation of every
 * component schema. Throws when invalid.
 */
export function validateV1Export(catalog) {
  const schema = createCatalogValidator()(catalog);
  const structural = validateCatalogStructuralRules(catalog);
  if (!schema.valid || !structural.valid)
    throw new Error(`A2UI v1.0 catalog validation failed: ${JSON.stringify({ schema, structural }, null, 2)}`);
  createComponentInstanceValidator(catalog);
  return { valid: true, schema, structural, componentSchemasCompiled: true };
}
