import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as XLSX from '@e965/xlsx';

const root = resolve(import.meta.dirname, '..');
const testBase = resolve(root, '.vscode-test');
await mkdir(testBase, { recursive: true });
const testRoot = await mkdtemp(resolve(testBase, 'r'));
const workspace = resolve(testRoot, 'workspace');
const userData = resolve(testRoot, 'u');
const extensions = resolve(testRoot, 'extensions');

await Promise.all([
  mkdir(workspace, { recursive: true }),
  mkdir(userData, { recursive: true }),
  mkdir(extensions, { recursive: true }),
  mkdir(resolve(userData, 'User'), { recursive: true }),
]);
await Promise.all([
  copyFile(resolve(root, 'tests/fixtures/sample.csv'), resolve(workspace, 'first.csv')),
  copyFile(resolve(root, 'tests/fixtures/sample.csv'), resolve(workspace, 'second.csv')),
  writeFile(
    resolve(userData, 'User/settings.json'),
    JSON.stringify({
      'update.mode': 'none',
      'chat.disableAIFeatures': true,
      'workbench.startupEditor': 'none',
    }),
  ),
]);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.aoa_to_sheet([
    ['id', 'name'],
    [1, 'Alice'],
  ]),
  'Data',
);
await writeFile(
  resolve(workspace, 'direct.xlsx'),
  XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
);

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
