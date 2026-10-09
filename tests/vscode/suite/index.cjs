const assert = require('node:assert/strict');
const vscode = require('vscode');

const EXTENSION_ID = 'quackwrangler.quackwrangler';
const WEBVIEW_TYPE = 'dataWrangler';

function dataEditorTabs() {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === WEBVIEW_TYPE) ||
        (tab.input instanceof vscode.TabInputCustom &&
          tab.input.viewType === 'quackwrangler.dataEditor'),
    );
}

function describeTabs() {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.map((tab) => ({
      label: tab.label,
      input: tab.input?.constructor?.name,
      viewType: tab.input?.viewType,
    })),
  );
}

async function waitFor(description, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for ${description}; open tabs: ${JSON.stringify(describeTabs())}`,
  );
}

async function closeAllEditors() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('all editors to close', () =>
    vscode.window.tabGroups.all.every((g) => !g.tabs.length),
  );
}

async function openFixture(name) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(root, 'The Extension Host test workspace must be open');
  const uri = vscode.Uri.joinPath(root, name);
  await vscode.commands.executeCommand('quackwrangler.openFile', uri);
  return uri;
}

async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} should be installed in the test host`);
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'quackwrangler.openFile',
    'quackwrangler.openfile',
    'quackwrangler.summarizeFile',
    'quackwrangler.copyDbtSql',
  ]) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }

  await closeAllEditors();

  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(root, 'The Extension Host test workspace must be open');
  await vscode.commands.executeCommand(
    'quackwrangler.openfile',
    vscode.Uri.joinPath(root, 'first.csv'),
  );
  await waitFor('the legacy lowercase command to open a panel', () => dataEditorTabs().length === 1);
  await closeAllEditors();

  await openFixture('first.csv');
  await waitFor('the first QuackWrangler panel', () => dataEditorTabs().length === 1);

  await openFixture('second.csv');
  await waitFor('two independent QuackWrangler panels', () => dataEditorTabs().length === 2);
  assert.equal(new Set(dataEditorTabs()).size, 2, 'each CSV must own a distinct editor tab');
  assert.deepEqual(
    new Set(dataEditorTabs().map((tab) => tab.label)),
    new Set(['first.csv', 'second.csv']),
    'the default custom-editor tabs must retain their source filenames',
  );

  await vscode.commands.executeCommand('quackwrangler.summarizeFile');
  assert.equal(dataEditorTabs().length, 2, 'summarizing must not replace or close either panel');

  const active = vscode.window.tabGroups.activeTabGroup.activeTab;
  assert.ok(active, 'one QuackWrangler panel should be active');
  await vscode.window.tabGroups.close(active);
  await waitFor('one panel to remain after disposal', () => dataEditorTabs().length === 1);

  await vscode.commands.executeCommand('quackwrangler.summarizeFile');
  assert.equal(dataEditorTabs().length, 1, 'the remaining panel must still accept commands');

  await closeAllEditors();
  await openFixture('first.csv');
  await waitFor(
    'first.csv to reopen after all panels were disposed',
    () => dataEditorTabs().length === 1,
  );

  await closeAllEditors();
  console.log('QuackWrangler VS Code host tests passed');
}

module.exports = { run };
