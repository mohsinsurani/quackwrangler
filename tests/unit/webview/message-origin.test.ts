import { describe, expect, it } from 'vitest';

import { isTrustedExtensionMessageOrigin } from '../../../webview-ui/src/hooks/useVSCodeAPI';

describe('webview extension-message origin validation', () => {
  it('accepts a VS Code message from the webview origin regardless of relay frame', () => {
    expect(
      isTrustedExtensionMessageOrigin(
        'vscode-webview://quackwrangler-session',
        'vscode-webview://quackwrangler-session',
      ),
    ).toBe(true);
  });

  it('rejects a message from any other origin', () => {
    expect(
      isTrustedExtensionMessageOrigin(
        'https://untrusted.example',
        'vscode-webview://quackwrangler-session',
      ),
    ).toBe(false);
  });
});
