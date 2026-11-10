// Reads the two official artifacts of a Storybook build directory: index.json and manifests/components.json.
// Nothing here loads Storybook configuration or executes story code.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function readJson(file, label) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (error) { throw new Error(`Cannot read ${label} (${file}): ${error.message}`); }
  try { return { value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) }; }
  catch (error) { throw new Error(`${label} is not valid JSON (${file}): ${error.message}`); }
}

// Storybook writes manifests/components.json only when this feature flag is on (Storybook >= 10.6).
export const MANIFEST_HELP = `Storybook only writes the components manifest when its feature flag is enabled. In .storybook/main.ts add:

  features: { componentsManifest: true },
  typescript: { reactDocgen: 'react-docgen' },   // React projects

then run "storybook build" again (Storybook >= 10.6 is required).`;

/** Storybook index v5: the set of story ids per component id prefix is checked against the manifest. */
export function readIndex(buildDir) {
  if (!fs.existsSync(buildDir) || !fs.statSync(buildDir).isDirectory())
    throw new Error(`Storybook build directory not found: ${buildDir}. Pass the output folder of "storybook build" (usually ./storybook-static).`);
  if (!fs.existsSync(path.join(buildDir, 'index.json')))
    throw new Error(`${buildDir} has no index.json, so it does not look like a "storybook build" output folder. Pass the folder that "storybook build" wrote (usually ./storybook-static).`);
  const { value, sha256: hash } = readJson(path.join(buildDir, 'index.json'), 'Storybook index');
  if (!record(value) || value.v !== 5 || !record(value.entries))
    throw new Error(`Unsupported Storybook index in ${buildDir}: expected index.json with "v": 5 and "entries".`);
  const storyIds = new Set();
  const filesById = new Map();
  for (const [key, entry] of Object.entries(value.entries)) {
    if (!record(entry) || entry.id !== key) throw new Error(`Malformed Storybook index entry ${key}.`);
    if (entry.type !== 'story') continue;
    storyIds.add(entry.id);
    const componentId = entry.id.split('--')[0];
    if (!filesById.has(componentId)) filesById.set(componentId, new Set());
    filesById.get(componentId).add(entry.importPath);
  }
  // Storybook derives a component id from the story title. Two story files with one title share an id, and the
  // manifest then describes only one of them.
  const ambiguousIds = new Map([...filesById].filter(([, files]) => files.size > 1).map(([id, files]) => [id, [...files].sort()]));
  return { storyIds, ambiguousIds, sha256: hash };
}

export function readManifest(buildDir) {
  const file = path.join(buildDir, 'manifests', 'components.json');
  if (!fs.existsSync(file))
    throw new Error(`No components manifest found (expected ${file}).\n\n${MANIFEST_HELP}`);
  const { value, sha256: hash } = readJson(file, 'Components manifest');
  if (!record(value) || !record(value.components))
    throw new Error(`Unsupported components manifest in ${buildDir}: expected an object with "components".`);
  return { manifest: value, file, sha256: hash };
}

/** Resolve a manifest-relative `$ref` ("../services/x.json#/a/b") to JSON, refusing paths outside the build. */
export function resolveRef(buildDir, manifestFile, ref) {
  if (typeof ref !== 'string' || !ref.includes('#')) throw new Error(`Unsupported manifest reference ${JSON.stringify(ref)}.`);
  const [relative, pointer] = ref.split('#');
  const target = path.resolve(path.dirname(manifestFile), relative);
  const root = path.resolve(buildDir) + path.sep;
  if (!target.startsWith(root)) throw new Error(`Manifest reference escapes the Storybook build directory: ${ref}`);
  // The check above is lexical; a symbolic link inside the build can still lead outside it. Compare real paths and
  // read from the resolved one so the file that was checked is the file that is read.
  let real;
  try { real = fs.realpathSync(target); } catch (error) { throw new Error(`Cannot read Manifest reference ${relative} (${target}): ${error.message}`); }
  if (!real.startsWith(fs.realpathSync(buildDir) + path.sep))
    throw new Error(`Manifest reference escapes the Storybook build directory through a symbolic link: ${ref}`);
  let node = readJson(real, `Manifest reference ${relative}`).value;
  for (const part of pointer.split('/').filter(Boolean)) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!record(node) || !Object.hasOwn(node, key)) throw new Error(`Manifest reference ${ref} does not resolve (missing "${key}").`);
    node = node[key];
  }
  return node;
}
