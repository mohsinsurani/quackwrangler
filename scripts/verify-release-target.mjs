import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expectedVersion = process.env.EXPECTED_VERSION;
const binding = process.env.DUCKDB_BINDING;

if (!expectedVersion || manifest.version !== expectedVersion) {
  throw new Error(`Expected package version ${expectedVersion ?? '<missing>'}, found ${manifest.version}`);
}
if (!binding) throw new Error('DUCKDB_BINDING is required');

const require = createRequire(import.meta.url);
const packageName = `@duckdb/node-bindings-${binding}`;
require.resolve(`${packageName}/package.json`);
console.log(`Verified ${manifest.name} ${manifest.version} with ${packageName}`);
