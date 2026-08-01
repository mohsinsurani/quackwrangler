import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { familySync, MUSL } from 'detect-libc';

const command = process.argv[2];
if (command !== 'package' && command !== 'publish') {
  throw new Error('Usage: node scripts/vsce-platform.mjs <package|publish> [vsce options]');
}

const platformKey = `${process.platform}-${process.arch}`;
const targets = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'linux-arm64': familySync() === MUSL ? 'alpine-arm64' : 'linux-arm64',
  'linux-x64': familySync() === MUSL ? 'alpine-x64' : 'linux-x64',
  'win32-arm64': 'win32-arm64',
  'win32-x64': 'win32-x64',
};

const target = targets[platformKey];
if (!target) {
  throw new Error(`QuackWrangler does not currently package ${platformKey}`);
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const forwardedArgs = process.argv.slice(3);
const args = [command, '--target', target];

if (command === 'package' && !forwardedArgs.some((arg) => arg === '--out' || arg === '-o')) {
  args.push('--out', `${manifest.name}-${target}-${manifest.version}.vsix`);
}

args.push(...forwardedArgs);
console.log(`Running vsce ${command} for ${target}`);

const executable = process.platform === 'win32' ? 'vsce.cmd' : 'vsce';
const result = spawnSync(executable, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
