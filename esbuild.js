import { build, context } from 'esbuild';
import { mkdirSync, existsSync } from 'fs';

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
  outdir: 'dist',
  target: 'node18',
  platform: 'node',
  minify: production,
  sourcemap: !production,
  external: [
    'vscode',
    '@duckdb/node-api',
    '@duckdb/node-bindings',
    '@duckdb/node-bindings-darwin-arm64',
    '@duckdb/node-bindings-darwin-x64',
    '@duckdb/node-bindings-linux-x64',
    '@duckdb/node-bindings-linux-x64-musl',
    '@duckdb/node-bindings-linux-arm64',
    '@duckdb/node-bindings-linux-arm64-musl',
    '@duckdb/node-bindings-win32-x64',
    '@duckdb/node-bindings-win32-arm64',
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

  if (watch) {
    await Promise.all([buildExtension(), buildWebview()]);
  } else {
    await buildExtension();
    await buildWebview();
  }
}

main();
