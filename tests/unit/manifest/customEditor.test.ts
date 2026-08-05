import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

describe('QuackWrangler custom editor contribution', () => {
  it('registers only Parquet with default editor priority', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      contributes: {
        customEditors: Array<{
          viewType: string;
          priority: string;
          selector: Array<{ filenamePattern: string }>;
        }>;
      };
    };
    const editor = manifest.contributes.customEditors[0];

    expect(editor.viewType).toBe('quackwrangler.dataEditor');
    expect(editor.priority).toBe('default');
    expect(editor.selector.map((item) => item.filenamePattern)).toEqual(['*.parquet']);
  });

  it('registers release-critical commands, formats, and privacy settings', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      version: string;
      activationEvents: string[];
      contributes: {
        commands: Array<{ command: string }>;
        configuration: { properties: Record<string, unknown> };
      };
    };
    const commands = manifest.contributes.commands.map((item) => item.command);
    expect(manifest.version).toBe('0.1.5');
    expect(commands).toEqual(
      expect.arrayContaining([
        'quackwrangler.openRemoteData',
        'quackwrangler.configureAI',
        'quackwrangler.generateAITransforms',
        'quackwrangler.compareSchemas',
        'quackwrangler.detectSchemaDrift',
        'quackwrangler.copyDbtSql',
      ]),
    );
    expect(manifest.activationEvents).toEqual(
      expect.arrayContaining([
        'workspaceContains:**/*.arrow',
        'workspaceContains:**/*.orc',
        'onCustomEditor:quackwrangler.dataEditor',
      ]),
    );
    expect(manifest.contributes.configuration.properties).toHaveProperty('quackwrangler.ai.model');
  });
});
