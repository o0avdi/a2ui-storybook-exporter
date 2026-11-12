// Copies the two files the exporter reads from a Storybook build (index.json and manifests/components.json) into a
// fixture directory, with one change: the absolute path of this project directory is replaced by ".".
//
//   /home/me/work/mui-harness/passthrough/Button.tsx   ->   ./passthrough/Button.tsx
//
// The replacement is made on the file text, so every other byte stays as Storybook wrote it. No property name, type,
// default, description or requiredness is touched. The sha256 of each file is printed before and after, for
// test/fixtures/PROVENANCE.md.
//
// Usage (from this directory, after a build):   node normalize-paths.mjs out-rdt-pass <fixture-directory>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [build, destination] = process.argv.slice(2);
if (!build || !destination) throw new Error('Usage: node normalize-paths.mjs <build-directory> <fixture-directory>');

// Storybook may record the directory as typed or with symbolic links resolved (/tmp and /private/tmp on macOS).
const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [...new Set([fs.realpathSync(here), here])];
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

for (const file of ['index.json', 'manifests/components.json']) {
  const original = fs.readFileSync(path.join(build, file), 'utf8');
  let normalized = original;
  for (const root of roots) normalized = normalized.replaceAll(`${root}/`, './');
  for (const root of roots)
    if (normalized.includes(root)) throw new Error(`${file} still contains ${root} after normalization; nothing was written for it.`);
  const replaced = roots.reduce((count, root) => count + original.split(`${root}/`).length - 1, 0);
  fs.mkdirSync(path.dirname(path.join(destination, file)), { recursive: true });
  fs.writeFileSync(path.join(destination, file), normalized);
  console.log(`${file}\n  original   sha256 ${sha256(original)}\n  normalized sha256 ${sha256(normalized)}\n  absolute paths replaced: ${replaced}`);
}
