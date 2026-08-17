import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const testRoot = resolve(root, '.vscode-test');
const workspace = resolve(testRoot, 'workspace');
const userData = resolve(testRoot, 'user-data');
const extensions = resolve(testRoot, 'extensions');

await rm(testRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(workspace, { recursive: true }),
  mkdir(userData, { recursive: true }),
  mkdir(extensions, { recursive: true }),
]);
await Promise.all([
  copyFile(resolve(root, 'tests/fixtures/sample.csv'), resolve(workspace, 'first.csv')),
  copyFile(resolve(root, 'tests/fixtures/sample.csv'), resolve(workspace, 'second.csv')),
]);

const args = [
  `--user-data-dir=${userData}`,
  `--extensions-dir=${extensions}`,
  '--disable-extensions',
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${resolve(root, 'tests/vscode/suite/index.cjs')}`,
  workspace,
];

const executable =
  process.platform === 'darwin'
    ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
    : 'code';
const child = spawn(executable, args, { cwd: root, stdio: 'inherit' });
child.once('error', (error) => {
  console.error(`Could not start VS Code extension tests: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`VS Code extension tests stopped with ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
