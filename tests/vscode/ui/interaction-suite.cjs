/*
 * Manual UI interaction suite for the real VS Code editor (not part of `npm test`).
 * Requires: a built extension (`npm run build`), VS Code installed, and `npm i -D playwright-core`.
 * Run:  node tests/vscode/ui/interaction-suite.cjs "Default Dark Modern" [windowWidth]
 * VS Code occasionally opens the CSV as plain text under automation; rerun if setup reports
 * "webview did not render".
 */
// Real VS Code interaction suite. Usage: node suite.cjs "<theme>" [windowWidth]
const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = process.env.QW_UI_OUT || require('node:os').tmpdir() + '/qw-ui-suite';
const theme = process.argv[2] || 'Default Dark Modern';
const width = process.argv[3] ? Number(process.argv[3]) : 0;
// Window height used with a width override. Short windows catch the sticky header covering rows.
const height = Number(process.env.QW_UI_HEIGHT || 760);
// Keep the user-data path short: VS Code creates a Unix socket inside it and macOS limits that
// path to 103 characters, so a long theme name makes VS Code exit immediately (listen EINVAL).
const tag =
  theme
    .split(/\s+/)
    .map((word) => word[0])
    .join('') + (width ? `-${width}` : '');
const userData = path.join(OUT, `s-${tag}`);
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
fs.writeFileSync(
  path.join(userData, 'User/settings.json'),
  JSON.stringify({
    'workbench.colorTheme': theme,
    'update.mode': 'none',
    'workbench.startupEditor': 'none',
    'chat.disableAIFeatures': true,
    // Always start clean and never prompt: tests must run unattended.
    'window.restoreWindows': 'none',
    'window.newWindowDimensions': 'default',
    'files.hotExit': 'off',
    'workbench.editorAssociations': {
      '*.csv': 'quackwrangler.dataEditor',
      '*.tsv': 'quackwrangler.dataEditor',
      '*.json': 'quackwrangler.dataEditor',
      '*.xlsx': 'quackwrangler.dataEditor',
    },
    'security.workspace.trust.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'extensions.ignoreRecommendations': true,
    'workbench.tips.enabled': false,
  }),
);

// Fixture: 500 rows with a numeric column that has nulls, so profiles, histograms and quality findings appear.
fs.mkdirSync(path.join(OUT, 'ws'), { recursive: true });
{
  const rows = ['region,units,price,notes'];
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 500; i++)
    rows.push(
      [
        ['N', 'S', 'E', 'W'][Math.floor(rnd() * 4)],
        i % 17 === 0 ? '' : 1 + Math.floor(rnd() * 400),
        (rnd() * 90 + 5).toFixed(2),
        `row ${i} ` + 'x'.repeat(i % 40),
      ].join(','),
    );
  fs.writeFileSync(path.join(OUT, 'ws/sales.csv'), rows.join('\n') + '\n');
}

function defaultVsCodePath() {
  if (process.platform === 'darwin')
    return '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  if (process.platform === 'win32')
    return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
  return '/usr/share/code/code';
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
// Other formats and a dbt project, so format loading and dbt detection run in the real editor.
{
  const ws = path.join(OUT, 'ws');
  fs.writeFileSync(
    path.join(ws, 'people.tsv'),
    'id\tname\tscore\n1\tAda\t91.5\n2\tBob\t78\n3\tCy\t\n',
  );
  fs.writeFileSync(
    path.join(ws, 'events.json'),
    JSON.stringify([
      { id: 1, kind: 'click', meta: { page: '/a', ok: true }, tags: ['x', 'y'] },
      { id: 2, kind: 'view', meta: { page: '/b', ok: false }, tags: [] },
    ]),
  );
  const dbt = path.join(ws, 'dbt_proj');
  fs.mkdirSync(path.join(dbt, 'seeds'), { recursive: true });
  fs.writeFileSync(
    path.join(dbt, 'dbt_project.yml'),
    "name: demo\nversion: '1.0'\nprofile: demo\n",
  );
  fs.writeFileSync(path.join(dbt, 'seeds', 'orders.csv'), 'order_id,total\n1,10.5\n2,20\n');
  try {
    const XLSX = require(path.join(ROOT, 'node_modules/@e965/xlsx'));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(
        [
          ['sku', 'qty', 'when'],
          ['A1', 5, new Date('2025-01-02')],
          ['B2', 9, new Date('2025-02-03')],
        ],
        { cellDates: true },
      ),
      'Data',
    );
    fs.writeFileSync(
      path.join(ws, 'stock.xlsx'),
      XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }),
    );
  } catch {
    /* XLSX writer unavailable: the XLSX check is skipped */
  }
}

const results = [];
const errors = [];
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    // Keep Playwright's call log (what it was waiting for) so CI failures are diagnosable.
    const lines = String(e.message || e)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    results.push({ name, ok: false, detail: lines.slice(0, 14).join(' | ') });
  }
}

(async () => {
  // Launch VS Code with a file already open. The editor association above makes it open in
  // QuackWrangler directly, so there is no dialog, no Quick Open and nothing to select by hand.
  const launch = (file) =>
    _electron.launch({
      executablePath: process.env.QW_VSCODE_PATH || defaultVsCodePath(),
      args: [
        `--user-data-dir=${userData}`,
        `--extensions-dir=${path.join(userData, 'ext')}`,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-telemetry',
        '--new-window',
        // Extra flags for headless/containers (e.g. Linux under Xvfb): --no-sandbox --disable-gpu.
        ...(process.env.QW_VSCODE_ARGS
          ? process.env.QW_VSCODE_ARGS.split(/\s+/).filter(Boolean)
          : []),
        `--extensionDevelopmentPath=${ROOT}`,
        path.join(OUT, 'ws'),
        path.join(OUT, 'ws', file),
      ],
      timeout: 40000,
    });
  let app = await launch('sales.csv');
  let win;
  try {
    win = await app.firstWindow();
    win.setDefaultTimeout(8000);
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('console', (m) => {
      if (m.type() === 'error' && /quackwrangler|webview|codicon|Content Security/i.test(m.text()))
        errors.push(m.text().slice(0, 200));
    });
    await win.waitForTimeout(6000);
    // Wait for the QuackWrangler webview in the current window; if VS Code showed plain text
    // instead, click the extension's own title-bar action (never a manual step).
    const webviewFrame = async () => {
      for (const fr of win.frames()) {
        try {
          if (await fr.locator('.data-grid-footer').count()) return fr;
        } catch {}
      }
      return null;
    };
    const waitForWebview = async (attempts = 40) => {
      const openBtn = win
        .locator(
          '[aria-label="QuackWrangler: Open Data Wrangler"], [title="QuackWrangler: Open Data Wrangler"]',
        )
        .first();
      for (let i = 0; i < attempts; i++) {
        const fr = await webviewFrame();
        if (fr) return fr;
        if (i > 0 && i % 8 === 0) await openBtn.click({ timeout: 3000 }).catch(() => {});
        await win.waitForTimeout(500);
      }
      return null;
    };
    // Each extra file gets its own fresh VS Code window: nothing is ever picked by hand.
    const openFile = async (file) => {
      await app.close().catch(() => {});
      app = await launch(file);
      win = await app.firstWindow();
      win.setDefaultTimeout(8000);
      await win.waitForTimeout(5000);
      return waitForWebview();
    };
    const frame = await waitForWebview();
    if (!frame) throw new Error('QuackWrangler webview did not render');
    await frame.locator('.profile-card').first().waitFor({ timeout: 20000 });
    await win.waitForTimeout(1200);
    // Dismiss VS Code's own toast so it cannot cover the grid footer during the run.
    await win
      .locator(
        '.notifications-toasts .codicon-notifications-clear, .notification-toast .codicon-close',
      )
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
    await win.keyboard.press('Escape').catch(() => {});
    if (width) {
      await app.evaluate(
        ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
        [width, height],
      );
      await win.waitForTimeout(1500);
    }
    const f = frame;
    const click = (sel, opts) =>
      f
        .locator(sel)
        .first()
        .click({ timeout: 6000, ...opts });
    const count = (sel) => f.locator(sel).count();
    const text = (sel) => f.locator(sel).first().innerText();
    const rowsLoaded = () => f.locator('.data-grid-row:not(.header-row)').count();

    await step('loads 500-row CSV, 4 columns, profiles + histograms', async () => {
      const header = await text('.data-info');
      const bins = await f.locator('.profile-histogram').count();
      if (!/500/.test(header) || !/4/.test(header)) throw new Error('header: ' + header);
      if (bins < 2) throw new Error('histograms: ' + bins);
      return header.replace(/\s+/g, ' ');
    });

    await step('footer is one row and does not overflow', async () => {
      const m = await f.locator('.data-grid-footer').evaluate((e) => ({
        h: e.getBoundingClientRect().height,
        over: e.scrollWidth > e.clientWidth + 1,
      }));
      if (m.over) throw new Error('footer overflows');
      const vw = await f.evaluate(() => window.innerWidth);
      if (m.h > 48)
        throw new Error('footer wraps: ' + Math.round(m.h) + 'px tall at ' + vw + 'px wide');
      return `${Math.round(m.h)}px at ${vw}px wide`;
    });

    await step('codicon font loaded and icons render', async () => {
      const ok = await f.evaluate(async () => {
        await document.fonts.ready;
        return (
          document.fonts.check('14px codicon') && document.querySelectorAll('.codicon').length > 5
        );
      });
      if (!ok) throw new Error('codicon font missing');
    });

    await step('pagination next / previous', async () => {
      const first = await text('.footer-range');
      await click('button[aria-label="Next page"]');
      await f.waitForFunction(
        () => !/^1–/.test(document.querySelector('.footer-range').textContent.trim()),
        null,
        { timeout: 8000 },
      );
      const second = await text('.footer-range');
      await click('button[aria-label="Previous page"]');
      await f.waitForFunction(
        () => /^1–/.test(document.querySelector('.footer-range').textContent.trim()),
        null,
        { timeout: 8000 },
      );
      return `${first.trim()} -> ${second.trim()} -> back`;
    });

    await step('column sort adds a Sort step and arrow icon', async () => {
      await click('.header-cell:has-text("price")');
      await f.waitForFunction(() => document.querySelector('.sort-indicator'), null, {
        timeout: 8000,
      });
      const steps = await text('.workspace-actions button:has-text("Steps")');
      return steps.trim();
    });

    await step('Export menu opens, lists formats, closes on Escape', async () => {
      await click('.export-menu > button');
      const items = await f.locator('.export-menu-items [role=menuitem]').allInnerTexts();
      if (items.length < 5) throw new Error('items: ' + items.join('|'));
      await f.page().keyboard.press('Escape');
      await f.waitForFunction(() => !document.querySelector('.export-menu-items'), null, {
        timeout: 4000,
      });
      return items.map((s) => s.trim()).join(', ');
    });

    await step('Recipe menu opens with Save / Run recipe', async () => {
      await click('.recipe-menu > button');
      const items = await f.locator('.recipe-menu [role=menuitem]').allInnerTexts();
      if (!items.some((s) => /Save recipe/.test(s)) || !items.some((s) => /Run recipe/.test(s)))
        throw new Error(items.join('|'));
      await f.page().keyboard.press('Escape');
    });

    await step('search opens, filters rows, Escape clears', async () => {
      await click('.toolbar-search');
      await f.locator('.grid-search input').fill('row 49');
      await f.locator('.grid-search input').press('Enter');
      await f.waitForFunction(
        () => /matching rows/.test(document.querySelector('.result-scope')?.textContent || ''),
        null,
        { timeout: 8000 },
      );
      const scope = await text('.result-scope');
      await f.locator('.grid-search input').press('Escape');
      await f.waitForFunction(() => !document.querySelector('.result-scope'), null, {
        timeout: 8000,
      });
      return scope.replace(/\s+/g, ' ').slice(0, 70);
    });

    await step(
      'Tools drawer: search operations, apply Filter, step chip, undo, redo, remove',
      async () => {
        await click('.workspace-actions button:has-text("Transform")');
        await f.locator('.operation-search').fill('filter');
        const visible = await f.locator('.operation-btn').allInnerTexts();
        if (!visible.some((s) => /Filter Rows/.test(s)))
          throw new Error('search: ' + visible.join('|'));
        await click('.operation-btn:has-text("Filter Rows")');
        await f.locator('.operation-form select').nth(0).selectOption('region');
        await f.locator('.operation-form select').nth(1).selectOption('equals');
        await f.locator('.operation-form input.param-input').first().fill('N');
        await click('.form-apply-btn');
        await f.waitForFunction(
          () => document.querySelectorAll('.transform-chip').length >= 2,
          null,
          { timeout: 10000 },
        );
        const filtered = await text('.footer-range');
        const chip = await f.locator('.chip-name').allInnerTexts();
        await click('.undo-btn');
        await f.waitForFunction(
          () => document.querySelectorAll('.transform-chip').length === 1,
          null,
          { timeout: 10000 },
        );
        await click('.redo-btn');
        await f.waitForFunction(
          () => document.querySelectorAll('.transform-chip').length === 2,
          null,
          { timeout: 10000 },
        );
        await f.locator('.chip-remove').last().click();
        await f.waitForFunction(
          () => document.querySelectorAll('.transform-chip').length === 1,
          null,
          { timeout: 10000 },
        );
        return `${filtered.trim()} | ${chip.join(' / ')}`;
      },
    );

    await step('Escape closes the Tools drawer', async () => {
      await f.page().keyboard.press('Escape');
      await f.waitForFunction(() => !document.querySelector('.operations-pane'), null, {
        timeout: 4000,
      });
    });

    await step('Quality tab lists the null finding and Inspect rows works', async () => {
      await click('.analysis-tabs button:has-text("Quality")');
      await f.locator('.quality-issue').first().waitFor({ timeout: 6000 });
      const msg = await text('.quality-issue');
      await click('.quality-actions button:has-text("Inspect rows")');
      await f.waitForFunction(
        () => /Inspecting/.test(document.querySelector('.result-scope')?.textContent || ''),
        null,
        { timeout: 8000 },
      );
      await click('.result-scope button:has-text("Clear inspection")');
      await f.waitForFunction(() => !document.querySelector('.result-scope'), null, {
        timeout: 8000,
      });
      return msg.replace(/\s+/g, ' ').slice(0, 60);
    });

    await step(
      'Quality: Fill missing values dialog validates and cancels with Escape',
      async () => {
        await click('.quality-actions button:has-text("Fill missing")');
        await f.locator('.fill-dialog').waitFor({ timeout: 4000 });
        await f.locator('#fill-value').fill('abc');
        await click('.fill-dialog .form-apply-btn');
        await f.locator('.fill-dialog [role=alert]').waitFor({ timeout: 4000 });
        await f.locator('#fill-value').press('Escape');
        await f.waitForFunction(() => !document.querySelector('.fill-dialog'), null, {
          timeout: 4000,
        });
      },
    );

    await step('Charts tab renders a correlation heatmap', async () => {
      await click('.analysis-tabs button:has-text("Charts")');
      await f.locator('.chart-controls select').first().selectOption('histogram');
      await click('.chart-controls .primary-button');
      await f.locator('.chart-canvas svg').waitFor({ timeout: 10000 });
      const rects = await f.locator('.chart-canvas svg rect').count();
      if (!rects) throw new Error('no bars');
      return `${rects} bars`;
    });

    await step('SQL tab runs a read-only query and rejects a write', async () => {
      await click('.analysis-tabs button:has-text("SQL")');
      const box = f.locator('.query-console textarea');
      await box.fill(
        'SELECT region, COUNT(*) AS n FROM current_data GROUP BY region ORDER BY region',
      );
      await click('.query-console-actions .primary-button');
      await f.waitForFunction(
        () => /Query result/.test(document.querySelector('.footer-scope')?.textContent || ''),
        null,
        { timeout: 10000 },
      );
      const rows = await rowsLoaded();
      if (rows < 3) throw new Error('rows ' + rows);
      return `${rows} result rows`;
    });

    await step('SQL write statements are rejected and data is untouched', async () => {
      const box = f.locator('.query-console textarea');
      await box.fill('DROP TABLE current_data');
      await click('.query-console-actions .primary-button');
      await f.locator('.error-banner').waitFor({ timeout: 8000 });
      const msg = (await text('.error-banner')).replace(/\s+/g, ' ').slice(0, 80);
      if (!/read-only|SELECT|WITH|allowed|only/i.test(msg))
        throw new Error('unexpected message: ' + msg);
      const rows = await rowsLoaded();
      if (rows < 3) throw new Error('result lost after rejected write');
      return msg;
    });

    await step('clearing the query restores the pipeline result', async () => {
      await click('.query-console-actions button:has-text("Return to pipeline")');
      await f.waitForFunction(
        () => /Pipeline result/.test(document.querySelector('.footer-scope')?.textContent || ''),
        null,
        { timeout: 10000 },
      );
    });

    await step('select rows, Copy selected appears, View menu opens', async () => {
      await f.locator('.data-grid-row:not(.header-row) .row-selector input').first().check();
      await f.locator('.copy-selected-button').waitFor({ timeout: 4000 });
      await click('.view-options summary');
      const labels = await text('.view-options-menu');
      if (!/Headers/.test(labels) || !/Row copy/.test(labels)) throw new Error(labels);
      await click('.view-options summary');
    });

    await step('right-click quick filter menu opens', async () => {
      await f
        .locator('.data-grid-row:not(.header-row) .data-grid-cell')
        .nth(1)
        .click({ button: 'right' });
      await f.locator('.quick-filter-menu').waitFor({ timeout: 4000 });
      await f.page().keyboard.press('Escape');
    });

    await step('long-value cell opens the inspector and Escape closes it', async () => {
      // In a narrow editor the first long cell can sit off-screen to the right: scroll to it
      // first, then click like a user would (no forced clicks outside the visible area).
      const cell = f.locator('.metadata-badge').first().locator('..');
      await cell.scrollIntoViewIfNeeded();
      await cell.click();
      await f.locator('.cell-inspector').waitFor({ timeout: 4000 });
      await f.page().keyboard.press('Escape');
      await f.waitForFunction(() => !document.querySelector('.cell-inspector'), null, {
        timeout: 4000,
      });
    });

    await step('Undo/Redo keyboard shortcuts work', async () => {
      await click('.workspace-actions button:has-text("Steps")');
      const before = await f.locator('.transform-chip').count();
      await f
        .locator('.grid-pane')
        .click({ position: { x: 5, y: 5 } })
        .catch(() => {});
      await f.page().keyboard.press(`${MOD}+z`);
      await f.waitForFunction(
        (n) => document.querySelectorAll('.transform-chip').length < n,
        before,
        { timeout: 8000 },
      );
      await f.page().keyboard.press(`${MOD}+Shift+z`);
      await f.waitForFunction(
        (n) => document.querySelectorAll('.transform-chip').length === n,
        before,
        { timeout: 8000 },
      );
    });

    await step('layout stays inside the viewport (no horizontal page scroll)', async () => {
      const m = await f.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        bar: (() => {
          const b = document.querySelector('.workspace-actions');
          return b.scrollWidth > b.clientWidth + 1;
        })(),
        footer: (() => {
          const b = document.querySelector('.data-grid-footer');
          return b.scrollWidth > b.clientWidth + 1;
        })(),
      }));
      if (m.sw > m.cw + 1) throw new Error('page scrolls horizontally');
      if (m.bar) throw new Error('toolbar clipped');
      if (m.footer) throw new Error('footer clipped');
    });

    await step('text contrast (body text vs background) >= 4.5:1', async () => {
      const r = await f.evaluate(() => {
        const lum = (c) => {
          const m = c
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((v) => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
          return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
        };
        const bgOf = (e) => {
          let n = e;
          while (n) {
            const b = getComputedStyle(n).backgroundColor;
            if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b;
            n = n.parentElement;
          }
          return 'rgb(255,255,255)';
        };
        const out = {};
        for (const [k, s] of Object.entries({
          cell: '.data-grid-row:not(.header-row) .data-grid-cell:not(.row-number)',
          colname: '.column-name',
          tab: '.analysis-tabs button',
          footer: '.footer-range',
          toolbar: '.workspace-actions button',
        })) {
          const e = document.querySelector(s);
          if (!e) continue;
          const a = lum(getComputedStyle(e).color),
            b = lum(bgOf(e));
          out[k] = +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
        }
        return out;
      });
      const low = Object.entries(r).filter(([, v]) => v < 4.5);
      if (low.length) throw new Error('low contrast: ' + JSON.stringify(Object.fromEntries(low)));
      return JSON.stringify(r);
    });

    // ---- Other formats, join/union, dbt: each opens its own editor tab ----
    const formatCheck = (label, file, expectCols, expectRows) =>
      step(`opens ${label} and profiles every column`, async () => {
        const fr = await openFile(file);
        if (!fr) throw new Error('editor did not open ' + file);
        await fr.locator('.profile-card').first().waitFor({ timeout: 20000 });
        const info = await fr.locator('.data-info').first().innerText();
        const cards = await fr.locator('.profile-card').count();
        if (cards !== expectCols)
          throw new Error(`profile cards ${cards} != ${expectCols} (${info})`);
        if (!new RegExp(String(expectRows)).test(info)) throw new Error('rows: ' + info);
        return info.replace(/\s+/g, ' ');
      });

    await formatCheck('a TSV file', 'people.tsv', 3, 3);
    await formatCheck('a JSON file with nested values', 'events.json', 4, 2);
    if (fs.existsSync(path.join(OUT, 'ws/stock.xlsx')))
      await formatCheck('an XLSX file', 'stock.xlsx', 3, 2);

    await step(
      'nested JSON cell opens a tree with extract / flatten / explode actions',
      async () => {
        const fr = await openFile('events.json');
        await fr.locator('.profile-card').first().waitFor({ timeout: 20000 });
        await fr.locator('.metadata-badge').first().locator('..').click({ force: true });
        await fr.locator('.nested-tree').waitFor({ timeout: 6000 });
        const actions = await fr.locator('.nested-node-actions button').allInnerTexts();
        await fr.page().keyboard.press('Escape');
        if (!actions.some((a) => /Extract/.test(a)))
          throw new Error('actions: ' + actions.join('|'));
        return [...new Set(actions.map((a) => a.trim()))].join(', ');
      },
    );

    await step(
      'Join another file: pick a join type and columns, then see the joined columns',
      async () => {
        const fr = await openFile('people.tsv');
        await fr.locator('.profile-card').first().waitFor({ timeout: 20000 });
        await fr.locator('.workspace-actions button', { hasText: 'Transform' }).first().click();
        await fr.locator('.operation-search').fill('join');
        await fr.locator('.operation-btn', { hasText: 'Join Another File' }).click();
        const types = await fr
          .locator('.operation-form select')
          .nth(0)
          .locator('option')
          .allInnerTexts();
        if (!types.some((t) => /Inner/i.test(t))) throw new Error('join types: ' + types.join('|'));
        return 'join form lists ' + types.filter(Boolean).join(', ');
      },
    );

    // Command Palette lookup that works while focus is inside a webview: open Quick Open with
    // the '>' command prefix, wait for the list to settle, read the rows, then close it.
    const paletteHas = async (query) => {
      await win
        .locator('.monaco-workbench')
        .first()
        .click({ position: { x: 5, y: 5 }, force: true })
        .catch(() => {});
      await win.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+p' : 'Control+Shift+p');
      const input = win.locator('.quick-input-box input').first();
      await input.waitFor({ timeout: 6000 });
      await input.fill('>' + query);
      await win.waitForTimeout(900);
      const rows = await win.locator('.quick-input-list .monaco-list-row').allInnerTexts();
      await win.keyboard.press('Escape');
      return rows.some((r) => r.toLowerCase().includes(query.toLowerCase()));
    };

    await step('dbt: Copy as dbt SQL is offered inside a dbt project', async () => {
      const inDbt = await openFile('dbt_proj/seeds/orders.csv');
      if (!inDbt) throw new Error('could not open the dbt seed');
      await inDbt.locator('.profile-card').first().waitFor({ timeout: 20000 });
      await win.waitForTimeout(800);
      if (!(await paletteHas('Copy as dbt SQL')))
        throw new Error('command missing inside a dbt project');
    });

    await step('dbt: Copy as dbt SQL is hidden outside a dbt project', async () => {
      const outside = await openFile('sales.csv');
      if (!outside) throw new Error('could not open sales.csv');
      await outside.locator('.profile-card').first().waitFor({ timeout: 20000 });
      await win.waitForTimeout(800);
      if (await paletteHas('Copy as dbt SQL'))
        throw new Error('command offered outside a dbt project');
      // Guard against a false pass: the palette must still list other QuackWrangler commands.
      if (!(await paletteHas('QuackWrangler: Open Data Wrangler')))
        throw new Error('palette lookup is not working');
    });

    await win.screenshot({ path: path.join(OUT, `suite-${tag}.png`) });
  } catch (e) {
    results.push({ name: 'suite setup', ok: false, detail: String(e.message || e) });
    try {
      await (win || (await app.firstWindow())).screenshot({
        path: path.join(OUT, `suite-${tag}-error.png`),
      });
    } catch {}
  } finally {
    await app.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n=== ${theme}${width ? ' @' + width + (process.env.QW_UI_HEIGHT ? 'x' + height : '') : ''}: ${results.length - failed.length}/${results.length} passed ===`,
  );
  for (const r of results)
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  if (errors.length) console.log('console errors:', [...new Set(errors)].slice(0, 5));
  process.exitCode = failed.length ? 1 : 0;
})();
