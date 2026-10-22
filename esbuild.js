import { build, context } from 'esbuild';
import { mkdirSync, existsSync, unlinkSync } from 'fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const webviewConfig = {
  entryPoints: ['webview-ui/src/main.tsx'],
  bundle: true,
  format: 'esm',
  outdir: 'dist/webview',
  target: 'es2022',
  minify: production,
  sourcemap: !production,
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'css',
  },
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
};

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  outfile: 'dist/extension.cjs',
  target: 'node18',
  platform: 'node',
  minify: production,
  sourcemap: !production,
  external: [
    // VS Code API — provided at runtime by the extension host.
    'vscode',
    // Native DuckDB binary addons — must stay as separate files because esbuild
    // cannot inline .node native modules. @duckdb/node-api JS layer IS bundled
    // so the VSIX no longer ships ~190 individual JS files from that package.
    '*.node',
    // detect-libc is a separate runtime package used by the DuckDB binding
    // loader to detect musl vs glibc at startup; keep it external so its
    // subprocess and filesystem probes work correctly in the extension host.
    'detect-libc',
  ],
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
};

async function buildWebview() {
  try {
    if (watch) {
      const ctx = await context(webviewConfig);
      await ctx.watch();
      console.log('[webview] Watching for changes...');
    } else {
      await build(webviewConfig);
      console.log('[webview] Build complete');
    }
  } catch (err) {
    console.error('[webview] Build failed:', err);
    process.exit(1);
  }
}

async function buildExtension() {
  try {
    if (watch) {
      const ctx = await context(extensionConfig);
      await ctx.watch();
      console.log('[extension] Watching for changes...');
    } else {
      await build(extensionConfig);
      console.log('[extension] Build complete');
    }
  } catch (err) {
    console.error('[extension] Build failed:', err);
    process.exit(1);
  }
}

async function main() {
  if (!existsSync('dist')) {
    mkdirSync('dist', { recursive: true });
  }

  for (const staleBundle of [
    'dist/extension.js',
    'dist/extension.js.map',
  ]) {
    if (existsSync(staleBundle)) {
      unlinkSync(staleBundle);
    }
  }

  if (watch) {
    await Promise.all([buildExtension(), buildWebview()]);
  } else {
    await buildExtension();
    await buildWebview();
  }
}

main();
