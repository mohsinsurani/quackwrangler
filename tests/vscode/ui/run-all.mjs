// Runs the real-VS Code interaction suite across themes (and optional narrow widths).
// Usage: npm run test:ui            -> all four default themes
//        npm run test:ui -- "Default Dark Modern" 700   -> one theme at a window width
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const suite = resolve(import.meta.dirname, 'interaction-suite.cjs');
const args = process.argv.slice(2);
const matrix = args.length
  ? [[args[0], args[1]]]
  : [
      ['Default Dark Modern'],
      ['Default Light Modern'],
      ['Default High Contrast'],
      ['Default High Contrast Light'],
      ['Default Dark Modern', '700'],
    ];

let failed = 0;
for (const [theme, width] of matrix) {
  let out = '';
  // VS Code sometimes opens the CSV as plain text under automation; retry the launch only.
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = spawnSync('node', [suite, theme, ...(width ? [width] : [])], { encoding: 'utf8' });
    out = r.stdout + r.stderr;
    // Retry only launch problems (VS Code closing early, or opening the CSV as plain text).
    const launchProblem = /suite setup\s+—/.test(out) || out.includes('webview did not render');
    if (!launchProblem) {
      if (r.status !== 0) failed++;
      break;
    }
    if (attempt === 6) failed++;
  }
  process.stdout.write(out);
}
process.exit(failed ? 1 : 0);
