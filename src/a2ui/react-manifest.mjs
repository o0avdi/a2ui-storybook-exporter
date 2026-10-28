import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Storybook Components Manifest reader and normalizer for A2UI v1.0.
 *
 * Implements an input adapter that reads official Storybook Components Manifests
 * (manifests/components.json, schema version v: 0) and converts supported prop
 * information into normalized component metadata suitable for makeCatalogV1.
 */

export const SUPPORTED_MANIFEST_VERSION = 0;

/**
 * Normalize file paths to use forward slashes.
 */
function normalizePath(value) {
  if (typeof value !== 'string') return '';
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Safely parse a docgen defaultValue string expression into a primitive JavaScript value.
 * Distinguishes verified source defaults from absent defaults.
 *
 * Docgen defaultValue objects:
 * - RDT: { value: "false" } or { value: "medium" } or { value: "\"medium\"" }
 * - RD:  { value: "false", computed: false } or { value: "\"medium\"", computed: false }
 */
export function parseDocgenDefault(defaultValue) {
  if (defaultValue?.computed === true) return undefined;
  if (!defaultValue || defaultValue.value === undefined || defaultValue.value === null) {
    return undefined;
  }
  const raw = String(defaultValue.value).trim();
  if (raw === '' || raw === 'undefined') return undefined;
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Quoted string literal e.g. "\"medium\"" or "'medium'"
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try { return JSON.parse(raw); } catch { return undefined; }
  }
  if (/^'[^'\\\r\n]*'$/.test(raw)) {
    return raw.slice(1, -1);
  }

  // Integer or float literal e.g. "123", "-4.5"
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    const number = Number(raw);
    return Number.isFinite(number) ? number : undefined;
  }

  // Unquoted enum or identifier literal (common in RDT output e.g. value: "medium")
  if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(raw)) {
    return raw;
  }

  // Complex expressions (function calls, object literals, JSX) are not verified scalar defaults
  return undefined;
}

/**
 * Inspect a prop definition and classify its category and supported A2UI schema.
 * Handles both react-docgen-typescript (RDT) and react-docgen (RD) structures.
 */
export function classifyProperty(name, propDef, options = {}) {
  const isRDT = Boolean(propDef.type);
  const isRD = Boolean(propDef.tsType);
  const rawType = propDef.type?.name ?? propDef.tsType?.raw ?? propDef.tsType?.name ?? '';
  const rawTypeLower = rawType.toLowerCase();

  // 1. Projected content / slot / ReactNode detection (must run before callback detection
  // to avoid false positives on types like ChildrenOrFunction<T>)
  const isContentName = ['children', 'render', 'slot'].includes(name);
  const isReactNodeType =
    ['node', 'element'].includes(rawType) ||
    rawType === 'ReactNode' ||
    rawType === 'ReactElement' ||
    rawType === 'JSX.Element' ||
    rawType === 'React.ReactNode' ||
    rawType === 'React.ReactElement' ||
    rawType.startsWith('ChildrenOrFunction') ||
    (isRD && propDef.tsType?.name === 'ReactNode');

  if (isContentName || isReactNodeType) {
    return {
      category: 'content',
      rawType,
      reason: 'Projected content or ReactNode slot; modeled via content projection, not scalar data fields.',
    };
  }

  // 2. Inherited DOM / HTML forwarded attributes (form*, aria-*, ref, key, style)
  const isDomAttribute =
    ['ref', 'key', 'style', 'form', 'formAction', 'formEncType', 'formMethod', 'formNoValidate', 'formTarget'].includes(name) ||
    name.startsWith('aria-') ||
    name.startsWith('data-');

  if (isDomAttribute) {
    return {
      category: 'unsupported_dom',
      rawType,
      reason: `Inherited DOM/HTML forwarded attribute '${name}'.`,
    };
  }

  // 3. Callback detection
  // Matches React event convention (onClick, onPress, onFocus) or function/signature type text
  const isCallbackName = /^on[A-Z]/.test(name);
  const isCallbackSignature =
    ['func', 'function'].includes(rawTypeLower) ||
    rawType.startsWith('((') ||
    rawType.includes('=>') ||
    /\bFunction\b/.test(rawType) ||
    /\bEventHandler\b/.test(rawType) ||
    /\bCallback\b/.test(rawType) ||
    (isRD && propDef.tsType?.name === 'signature' && propDef.tsType?.type === 'function');

  if (isCallbackName || isCallbackSignature) {
    return {
      category: 'callback',
      rawType,
      reason: 'Callback or event handler type; excluded from component data properties in A2UI v1.',
    };
  }

  // 4. Supported Boolean Scalar
  if (
    rawTypeLower === 'boolean' ||
    rawTypeLower === 'bool' ||
    (isRD && propDef.tsType?.name === 'boolean')
  ) {
    return {
      category: 'scalar',
      rawType,
      schema: { type: 'boolean' },
    };
  }

  // 5. Supported String Scalar
  if (
    rawTypeLower === 'string' ||
    (isRD && propDef.tsType?.name === 'string')
  ) {
    return {
      category: 'scalar',
      rawType,
      schema: { type: 'string' },
    };
  }

  // 6. Supported Number Scalar
  if (
    rawTypeLower === 'number' ||
    (isRD && propDef.tsType?.name === 'number')
  ) {
    return {
      category: 'scalar',
      rawType,
      schema: { type: 'number' },
    };
  }

  // 7. String Enum (RDT and RD)
  // RDT enum with explicit values array
  if (isRDT && propDef.type?.name === 'enum' && Array.isArray(propDef.type.value)) {
    // Both docgen engines use type.value for PropTypes/TS enums. Numeric enum
    // expressions are strings too; never silently turn them into string enums.
    const rawValues = propDef.type.value.map((v) => {
      if (v.computed || typeof v.value !== 'string' || !/^["']/.test(v.value)) return undefined;
      return parseDocgenDefault({ value: v.value });
    });
    // If all values are non-empty strings
    if (rawValues.length > 0 && rawValues.every((v) => typeof v === 'string' && v.length > 0)) {
      return {
        category: 'enum',
        rawType: propDef.type.raw ?? rawType,
        schema: { type: 'string', enum: [...rawValues].sort() },
      };
    }
  }

  // RD union with literal elements
  if (isRD && propDef.tsType?.name === 'union' && Array.isArray(propDef.tsType.elements)) {
    const isAllStringLiterals = propDef.tsType.elements.every(
      (el) => el.name === 'literal' && typeof el.value === 'string' && /^["']/.test(el.value) &&
        typeof parseDocgenDefault({ value: el.value }) === 'string',
    );
    if (isAllStringLiterals && propDef.tsType.elements.length > 0) {
      const values = propDef.tsType.elements.map((el) => parseDocgenDefault({ value: el.value }));
      return {
        category: 'enum',
        rawType,
        schema: { type: 'string', enum: [...values].sort() },
      };
    }
  }

  // Union literal string parsing (e.g. "\"small\" | \"medium\" | \"large\"" in RDT)
  if (rawType.includes('|') && !rawType.includes('null') && !rawType.includes('undefined')) {
    const parts = rawType.split('|').map((p) => p.trim());
    const isQuotedUnion = parts.every((p) => /^["']/.test(p) && typeof parseDocgenDefault({ value: p }) === 'string');
    if (isQuotedUnion && parts.length > 0) {
      const values = parts.map((p) => parseDocgenDefault({ value: p }));
      return {
        category: 'enum',
        rawType,
        schema: { type: 'string', enum: [...values].sort() },
      };
    }
  }

  // 8. Number | String Union
  if (rawType.includes('|')) {
    const parts = rawType.split('|').map((p) => p.trim().toLowerCase());
    if (parts.length === 2 && parts.includes('number') && parts.includes('string')) {
      return {
        category: 'union',
        rawType,
        schema: { type: ['number', 'string'] },
      };
    }
  }

  // 9. Complex / Nullable Unions (e.g. CVA variants containing null: "default" | ... | null)
  if (rawType.includes('|')) {
    return {
      category: 'complex_union',
      rawType,
      reason: `Union type '${rawType}' contains null or non-scalar types requiring explicit reviewed mapping.`,
    };
  }

  // 10. Arbitrary complex or unsupported types
  return {
    category: 'unsupported_type',
    rawType,
    reason: `Unsupported type '${rawType}'; A2UI v1 does not widen unrecognized types without explicit reviewed schema.`,
  };
}

/**
 * Read and version-gate an official Storybook Components Manifest.
 *
 * @param {string|object} manifestOrPath - Path to manifest file or parsed manifest object
 * @param {object} [options]
 * @returns {object} Validated manifest with provenance
 */
export function readReactComponentsManifest(manifestOrPath, options = {}) {
  let manifest;
  let filePath = null;
  let sha256 = null;

  if (typeof manifestOrPath === 'string') {
    filePath = path.resolve(manifestOrPath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Storybook Components Manifest not found at: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    sha256 = createHash('sha256').update(content).digest('hex');
    try {
      manifest = JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to parse Storybook Components Manifest JSON at ${filePath}: ${err.message}`);
    }
  } else if (manifestOrPath && typeof manifestOrPath === 'object') {
    manifest = manifestOrPath;
  } else {
    throw new Error('readReactComponentsManifest: Expected file path or manifest object.');
  }

  // Version gate: Storybook 10.6.0 manifests specify { "v": 0 }
  if (manifest.v !== SUPPORTED_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported Storybook Components Manifest version: ${manifest.v}. Only version ${SUPPORTED_MANIFEST_VERSION} is currently verified and supported.`,
    );
  }

  if (!manifest.components || typeof manifest.components !== 'object' || Array.isArray(manifest.components)) {
    throw new Error(
      `Invalid Storybook Components Manifest: missing or malformed 'components' dictionary.`,
    );
  }

  return {
    v: manifest.v,
    meta: manifest.meta ?? {},
    components: manifest.components,
    provenance: {
      manifestVersion: manifest.v,
      docgenEngine: manifest.meta?.docgen ?? 'unknown',
      durationMs: manifest.meta?.durationMs ?? null,
      filePath: filePath ? normalizePath(filePath) : null,
      sha256,
    },
  };
}

/**
 * Normalize a single component entry from the manifest into a shared component metadata structure.
 *
 * @param {object} entry - Raw component entry from manifest.components
 * @param {object} [options]
 * @returns {object} Normalized component metadata with diagnostics and readiness
 */
export function normalizeReactComponentManifest(entry, options = {}) {
  const id = entry.id ?? 'unknown-component';
  const rawName = entry.name ?? 'Component';
  const storyPath = normalizePath(entry.path ?? '');
  const diagnostics = [];

  // Check for official manifest error conditions
  if (entry.error) {
    const errorName = entry.error.name ?? 'UnknownError';
    const errorMessage = entry.error.message ?? '';

    if (errorName === 'No component found' || errorMessage.includes('Specify meta.component')) {
      diagnostics.push({
        code: 'MISSING_META_COMPONENT',
        severity: 'error',
        property: null,
        message: `Storybook could not detect the component for '${id}' (${storyPath}). Specify 'meta.component' in the CSF default export.`,
      });
    } else if (
      errorName === 'react-docgen-typescript found no component docs' ||
      errorMessage.includes('did not return any component docs')
    ) {
      diagnostics.push({
        code: 'INCOMPLETE_TS_MEMBERSHIP',
        severity: 'error',
        property: null,
        message: `react-docgen-typescript did not return component docs for '${id}' (${storyPath}). Ensure the component source file is included in tsconfig.json 'include'.`,
      });
    } else {
      diagnostics.push({
        code: 'MANIFEST_DOCGEN_ERROR',
        severity: 'error',
        property: null,
        message: `Manifest extraction error for '${id}': ${errorMessage || errorName}`,
      });
    }

    return {
      id,
      name: rawName,
      framework: 'react',
      storyPath,
      source: null,
      exportName: null,
      displayName: rawName,
      description: entry.description ?? '',
      storyIds: (entry.stories ?? []).map((s) => s.id),
      fields: [],
      callbacks: [],
      content: {},
      rawProperties: {},
      unsupportedProperties: [],
      examples: (entry.stories ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        snippet: s.snippet,
        description: s.description,
      })),
      diagnostics,
      readiness: {
        status: 'error',
        v1Convertible: false,
        totalRawProps: 0,
        supportedFieldsCount: 0,
        callbacksCount: 0,
        unsupportedPropsCount: 0,
      },
      provenance: {
        reader: 'react-manifest-adapter',
        docgenEngine: options.docgenEngine ?? 'unknown',
        error: entry.error,
      },
    };
  }

  // Resolve docgen metadata: supports reactDocgenTypescript and reactDocgen
  const docgen = entry.reactDocgenTypescript ?? entry.reactDocgen;
  if (!docgen) {
    diagnostics.push({
      code: 'MISSING_DOCGEN_DATA',
      severity: 'error',
      property: null,
      message: `Component entry '${id}' contains neither 'reactDocgenTypescript' nor 'reactDocgen' metadata.`,
    });
    return {
      id,
      name: rawName,
      framework: 'react',
      storyPath,
      source: null,
      fields: [],
      callbacks: [],
      content: {},
      rawProperties: {},
      unsupportedProperties: [],
      diagnostics,
      readiness: {
        status: 'error',
        v1Convertible: false,
        totalRawProps: 0,
        supportedFieldsCount: 0,
        callbacksCount: 0,
        unsupportedPropsCount: 0,
      },
    };
  }

  const displayName = docgen.displayName ?? rawName;
  const exportName = docgen.exportName ?? displayName;
  const sourceFile = normalizePath(docgen.filePath ?? docgen.definedInFile ?? '');
  const description =
    docgen.description || entry.description || `${displayName} component exported from React Storybook.`;
  const descriptionOrigin = docgen.description ? 'docgen' : entry.description ? 'storybook-manifest' : 'generator-fallback';

  const rawProps = docgen.props ?? {};
  const fields = [];
  const callbacks = [];
  const content = {};
  const unsupportedProperties = [];
  const rawProperties = {};

  for (const [propName, propDef] of Object.entries(rawProps)) {
    const rawType = propDef.type?.name ?? propDef.tsType?.raw ?? propDef.tsType?.name ?? 'unknown';
    const parsedDefault = parseDocgenDefault(propDef.defaultValue);
    const hasSourceDefault = parsedDefault !== undefined;
    const required = typeof propDef.required === 'boolean' ? propDef.required : null;
    const propDescription = propDef.description ? propDef.description.trim() : undefined;

    const classification = classifyProperty(propName, propDef, options);
    if (['scalar', 'enum', 'union'].includes(classification.category) && propDef.defaultValue != null) {
      const rawDefault = String(propDef.defaultValue.value).trim();
      const identifierFromReactDocgen = Boolean(entry.reactDocgen) && /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(rawDefault) &&
        !['true', 'false', 'null', 'undefined'].includes(rawDefault);
      if ((parsedDefault === undefined && rawDefault !== 'undefined') || identifierFromReactDocgen) diagnostics.push({
        code: 'UNVERIFIED_SOURCE_DEFAULT', severity: 'error', property: propName,
        message: `${propName}: docgen source default '${rawDefault}' is not a verified scalar literal. Add a reviewed lossless default conversion before export.`,
      });
      if (hasSourceDefault && !identifierFromReactDocgen) {
        const types = Array.isArray(classification.schema.type) ? classification.schema.type : [classification.schema.type];
        if (!types.includes(typeof parsedDefault) || (classification.schema.enum && !classification.schema.enum.includes(parsedDefault)))
          diagnostics.push({ code: 'SOURCE_DEFAULT_TYPE_MISMATCH', severity: 'error', property: propName,
            message: `${propName}: source default does not match the declared docgen type/enum.` });
      }
    }

    rawProperties[propName] = {
      name: propName,
      rawType,
      structuredType: propDef.type ?? propDef.tsType ?? null,
      required,
      hasSourceDefault,
      sourceDefault: parsedDefault,
      rawDefaultValue: propDef.defaultValue ?? null,
      description: propDescription ?? '',
      parent: propDef.parent ?? null,
      declarations: propDef.declarations ?? [],
      classification: classification.category,
    };

    switch (classification.category) {
      case 'scalar':
      case 'enum':
      case 'union': {
        const fieldSchema = { ...classification.schema };
        if (propDescription) fieldSchema.description = propDescription;
        if (hasSourceDefault) fieldSchema.default = parsedDefault;

        const field = {
          name: propName,
          schema: fieldSchema,
          required,
          binding: true,
          ...(propDescription ? { descriptionOrigin: 'docgen' } : {}),
        };
        if (propDescription) field.description = propDescription;
        if (hasSourceDefault) field.default = parsedDefault;

        fields.push(field);
        break;
      }

      case 'callback': {
        callbacks.push({
          name: propName,
          typeText: rawType,
          description: propDescription,
        });
        diagnostics.push({
          code: 'CALLBACK_PROP',
          severity: 'info',
          property: propName,
          message: `Property '${propName}' is a callback (${rawType}). Storybook callbacks are excluded from serialized component data fields.`,
        });
        break;
      }

      case 'content': {
        content[propName] = {
          type: 'projected',
          typeText: rawType,
          description: propDescription,
        };
        diagnostics.push({
          code: 'PROJECTED_CONTENT_PROP',
          severity: 'info',
          property: propName,
          message: `Property '${propName}' is projected content (${rawType}). Modeled via content projection/slots, not primitive data properties.`,
        });
        break;
      }

      case 'unsupported_dom': {
        unsupportedProperties.push({
          name: propName,
          rawType,
          category: 'unsupported_dom',
          reason: classification.reason,
        });
        diagnostics.push({
          code: 'UNSUPPORTED_DOM_PROP',
          severity: 'info',
          property: propName,
          message: `Property '${propName}' (${rawType}) is an inherited DOM attribute; excluded from v1 data fields.`,
        });
        break;
      }

      case 'complex_union': {
        unsupportedProperties.push({
          name: propName,
          rawType,
          category: 'complex_union',
          reason: classification.reason,
        });
        diagnostics.push({
          code: 'COMPLEX_UNION_PROP',
          severity: 'warning',
          property: propName,
          message: `Property '${propName}' has complex union '${rawType}'. Conservative handling: requires reviewed mapping before inclusion in v1 catalog.`,
        });
        break;
      }

      case 'unsupported_type':
      default: {
        unsupportedProperties.push({
          name: propName,
          rawType,
          category: 'unsupported_type',
          reason: classification.reason,
        });
        diagnostics.push({
          code: 'UNSUPPORTED_PROP_TYPE',
          severity: 'warning',
          property: propName,
          message: `Property '${propName}' has unsupported type '${rawType}'. Excluded from v1 data fields without reviewed schema.`,
        });
        break;
      }
    }
  }

  // Extract story examples demonstrating usage
  const examples = (entry.stories ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    snippet: s.snippet,
    description: s.description,
  }));

  const totalRawProps = Object.keys(rawProperties).length;
  const isV1Convertible = fields.length > 0 && diagnostics.every((d) => d.severity !== 'error');

  let status = 'ready';
  if (diagnostics.some((d) => d.severity === 'error')) {
    status = 'error';
  } else if (unsupportedProperties.length > 0) {
    status = 'partial';
  }

  return {
    id,
    name: displayName,
    framework: 'react',
    storyPath,
    source: sourceFile,
    exportName,
    displayName,
    description,
    descriptionOrigin,
    storyIds: (entry.stories ?? []).map((s) => s.id),
    importStatement: entry.import ?? null,
    fields,
    callbacks,
    content,
    rawProperties,
    unsupportedProperties,
    examples,
    diagnostics,
    provenance: {
      reader: 'react-manifest-adapter',
      manifestVersion: options.manifestVersion ?? SUPPORTED_MANIFEST_VERSION,
      docgenEngine: options.docgenEngine ?? (entry.reactDocgenTypescript ? 'react-docgen-typescript' : 'react-docgen'),
      sourceFile,
      manifestPath: options.manifestPath ?? null,
    },
    readiness: {
      status,
      v1Convertible: isV1Convertible,
      totalRawProps,
      supportedFieldsCount: fields.length,
      callbacksCount: callbacks.length,
      unsupportedPropsCount: unsupportedProperties.length,
    },
  };
}

/**
 * Read and normalize all components from an official Storybook Components Manifest.
 *
 * @param {string|object} manifestOrPath - Path to manifest file or parsed manifest object
 * @param {object} [options]
 * @returns {object} Result containing normalized components, errors, and manifest metadata
 */
export function normalizeReactManifest(manifestOrPath, options = {}) {
  const parsed = readReactComponentsManifest(manifestOrPath, options);
  const docgenEngine = parsed.meta?.docgen ?? 'react-docgen-typescript';

  const components = [];
  const errors = [];
  const allDiagnostics = [];

  for (const [entryId, entry] of Object.entries(parsed.components)) {
    const normalized = normalizeReactComponentManifest(
      { ...entry, id: entry.id ?? entryId },
      {
        ...options,
        docgenEngine,
        manifestVersion: parsed.v,
        manifestPath: parsed.provenance?.filePath,
      },
    );

    allDiagnostics.push(...normalized.diagnostics);

    if (normalized.readiness.status === 'error') {
      errors.push(normalized);
    } else {
      components.push(normalized);
    }
  }

  return {
    manifestVersion: parsed.v,
    docgenEngine,
    durationMs: parsed.meta?.durationMs ?? null,
    components,
    errors,
    diagnostics: allDiagnostics,
    provenance: parsed.provenance,
  };
}
