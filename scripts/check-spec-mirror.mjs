#!/usr/bin/env node
// CI guard for the Ruby→TS spec mirror (see scripts/ruby-spec-map.json):
//  1. every *_spec.rb under the Ruby gem's spec dir is registered
//  2. every registered mirror target exists and contains tests
//  3. "not-ported" entries carry a reason
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(root, 'scripts/ruby-spec-map.json'), 'utf8'));
const rubySpecDir = join(root, registry.rubySpecDir);

function listRubySpecs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRubySpecs(full));
    else if (entry.name.endsWith('_spec.rb')) out.push(relative(rubySpecDir, full));
  }
  return out.sort();
}

const errors = [];
const rubySpecs = listRubySpecs(rubySpecDir);
const registered = new Set(Object.keys(registry.entries));

for (const rubySpec of rubySpecs) {
  if (!registered.has(rubySpec)) {
    errors.push(`${rubySpec}: not registered in ruby-spec-map.json`);
  }
}
for (const [rubySpec, entry] of Object.entries(registry.entries)) {
  if (!registered.has(rubySpec)) continue;
  if (!rubySpecs.includes(rubySpec)) {
    errors.push(`${rubySpec}: registered but no such Ruby spec file`);
    continue;
  }
  if (entry.status === 'not-ported') {
    if (!entry.note || entry.note.length < 10) {
      errors.push(`${rubySpec}: not-ported entries need a reason`);
    }
    continue;
  }
  if (!entry.ts) {
    errors.push(`${rubySpec}: mirrored/partial entries need a ts target`);
    continue;
  }
  const tsPath = join(root, entry.ts);
  if (!existsSync(tsPath)) {
    errors.push(`${rubySpec}: mirror target ${entry.ts} does not exist`);
    continue;
  }
  const content = readFileSync(tsPath, 'utf8');
  const hasTests = /\b(it|test)\s*\(/.test(content);
  if (!hasTests) {
    errors.push(`${rubySpec}: mirror target ${entry.ts} contains no tests`);
  }
  if (!content.includes(rubySpec.replace(/^fontist\//, '')) && !content.includes(rubySpec)) {
    errors.push(`${rubySpec}: mirror target ${entry.ts} lacks a header reference to the Ruby spec`);
  }
}

if (errors.length > 0) {
  console.error(`spec mirror check failed (${errors.length} problems):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`spec mirror OK: ${rubySpecs.length} Ruby spec files mapped`);
