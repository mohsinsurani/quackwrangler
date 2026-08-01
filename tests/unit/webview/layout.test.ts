import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../../..');
const appSource = fs.readFileSync(path.join(projectRoot, 'webview-ui/src/App.tsx'), 'utf8');
const themeSource = fs.readFileSync(
  path.join(projectRoot, 'webview-ui/src/styles/theme.css'),
  'utf8',
);
const profilesSource = fs.readFileSync(
  path.join(projectRoot, 'webview-ui/src/components/ColumnProfiles.tsx'),
  'utf8',
);
const operationsSource = fs.readFileSync(
  path.join(projectRoot, 'webview-ui/src/components/OperationsPanel.tsx'),
  'utf8',
);
const gridSource = fs.readFileSync(
  path.join(projectRoot, 'webview-ui/src/components/DataGrid.tsx'),
  'utf8',
);
const qualitySource = fs.readFileSync(
  path.join(projectRoot, 'webview-ui/src/components/DataQualitySummary.tsx'),
  'utf8',
);
const chartSource = fs.readFileSync(
  path.join(projectRoot, 'webview-ui/src/components/ChartPanel.tsx'),
  'utf8',
);
const previewSource = fs.readFileSync(
  path.join(projectRoot, 'webview-ui/src/main.tsx'),
  'utf8',
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return themeSource.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
}

describe('webview layout contracts', () => {
  it('keeps analysis controls in a dedicated scroll region above the data grid', () => {
    expect(appSource).toContain('<div className="analysis-pane">');
    expect(appSource.indexOf('<div className="analysis-pane">')).toBeLessThan(
      appSource.indexOf('<DataGrid'),
    );
    expect(rule('.analysis-pane')).toContain('overflow-y: auto');
    expect(rule('.analysis-pane')).toContain('max-height:');
  });

  it('keeps the table usable when analysis panels are expanded', () => {
    expect(rule('.data-grid-container')).toContain('flex: 1 1 220px');
    expect(rule('.data-grid-container')).toContain('min-height: 160px');
    expect(rule('.app-layout')).toContain('grid-template-rows: minmax(0, 1fr)');
    expect(rule('.app-layout')).toContain('overflow: hidden');
  });

  it('allows wide visualizations to scroll and keeps profiles inside the grid scroll surface', () => {
    expect(rule('.chart-canvas')).toContain('overflow-x: auto');
    expect(rule('.chart-canvas svg')).toContain('min-width: 640px');
    expect(rule('.column-profiles')).toContain('display: grid');
    expect(gridSource).toContain('<ColumnProfiles');
    expect(gridSource.indexOf('<ColumnProfiles')).toBeGreaterThan(
      gridSource.indexOf('className="data-grid-scroll"'),
    );
    expect(gridSource).toContain('gridTemplateColumns={gridTemplateColumns}');
    expect(profilesSource).toContain('style={{ gridTemplateColumns, minWidth }}');
    expect(rule('.chart-bar')).toContain('#3794ff');
  });

  it('keeps search outside analysis content and uses explicit disclosure buttons', () => {
    expect(appSource.search(/<form\s+className="grid-search"/)).toBeGreaterThan(
      appSource.indexOf('<div className="analysis-pane">'),
    );
    expect(rule('.grid-search')).toContain('flex: none');
    expect(rule('.analysis-toggle')).toContain('position: sticky');
    expect(qualitySource).toContain('aria-expanded={open}');
    expect(qualitySource).toContain("'Collapse' : 'Expand'");
    expect(chartSource).toContain('aria-expanded={open}');
    expect(chartSource).toContain("'Collapse' : 'Expand'");
    expect(chartSource).toContain('setType(config.type)');
    expect(chartSource).toContain('setXColumn(config.xColumn)');
    expect(chartSource).toContain('setOpen(true)');
  });

  it('stacks operations and data panes in narrow editors', () => {
    expect(themeSource).toContain('@media (max-width: 640px)');
    expect(themeSource).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(themeSource).toContain('grid-template-rows: minmax(120px, 26vh)');
    expect(themeSource).toContain('grid-row: auto');
  });

  it('does not render a generated-code copy pane', () => {
    expect(appSource).not.toContain('CodePreview');
    expect(appSource).not.toContain('code-pane');
    expect(themeSource).not.toContain('.code-preview-panel');
  });

  it('lets users collapse operations and expand the data workspace', () => {
    expect(appSource).toContain('operationsCollapsed');
    expect(appSource).toContain('useState(true)');
    expect(operationsSource).toContain('aria-label="Collapse operations"');
    expect(appSource).toContain('aria-label="Expand operations"');
    expect(appSource).toContain('operations-expand-label">Operations');
    expect(rule('.app-layout.operations-collapsed')).toContain(
      'grid-template-columns: 42px minmax(0, 1fr)',
    );
  });

  it('shows staged percentages while remote data is loading', () => {
    expect(appSource).toContain('className="remote-progress"');
    expect(appSource).toContain('loadingProgress.percent}%');
    expect(appSource).toContain('aria-live="polite"');
    expect(rule('.remote-progress')).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('uses one shared grid template to align every virtualized row', () => {
    expect(gridSource).toContain("columnWidthMode === 'fit' ? 'minmax(150px, 1fr)'");
    expect(gridSource).toContain("const gridTemplateColumns = `52px ${columnTracks.join(' ')}`");
    expect(gridSource).toContain('style={{ gridTemplateColumns, minWidth: gridMinWidth }}');
    expect(rule('.data-grid-row')).toContain('display: grid');
    expect(rule('.data-grid-cell')).toContain('min-width: 0');
  });

  it('offers column-width presets, drag resizing, and docked metadata inspection', () => {
    expect(gridSource).toContain("type ColumnWidthMode = 'compact' | 'fit' | 'wide'");
    expect(gridSource).toContain('startColumnResize');
    expect(gridSource).toContain('autoFitColumn');
    expect(gridSource).toContain('autoFitAllColumns');
    expect(gridSource).toContain('aria-label={`Auto-fit ${col.name} column`}');
    expect(gridSource).toMatch(/onDoubleClick=\{\(event\) =>/);
    expect(gridSource).toContain('Drag to resize · Double-click to auto-fit');
    expect(gridSource).toContain('Auto-fit');
    expect(gridSource).toContain('aria-label="Table column width"');
    expect(gridSource).toContain('<aside className="cell-inspector"');
    expect(gridSource).toContain('complete value');
    expect(rule('.data-grid-workspace')).toContain('display: flex');
    expect(rule('.cell-inspector')).toContain('border-left: 1px solid');
  });

  it('does not sort a column when its resize handle is dragged or clicked', () => {
    expect(gridSource).toContain('const resizingColumnRef = useRef(false)');
    expect(gridSource).toContain('resizingColumnRef.current = true');
    expect(gridSource).toContain("closest('.column-resizer, .column-autofit')");
    expect(gridSource).toContain('resizingColumnRef.current = false');
    expect(gridSource).toMatch(
      /onClick=\{\(event\) => \{\s+event\.preventDefault\(\);\s+event\.stopPropagation\(\);/,
    );
  });

  it('lets users wrap long values or inspect the complete cell content', () => {
    expect(gridSource).toContain("type CellDisplayMode = 'clip' | 'wrap'");
    expect(gridSource).toContain('aria-label="Cell content display"');
    expect(gridSource).toContain("cellDisplayMode === 'wrap' ? 54 : ROW_HEIGHT");
    expect(gridSource).toContain('cellText.length > 18');
    expect(gridSource).toContain("'View' : 'More'");
    expect(rule('.wrap-cells .cell-value')).toContain('-webkit-line-clamp: 2');
  });

  it('uses selection-only copying with selectable formats', () => {
    expect(gridSource).not.toContain('className="copy-row-button"');
    expect(gridSource).not.toContain('className="copy-cell-button"');
    expect(gridSource).toContain('aria-label="Row copy format"');
    expect(gridSource).toContain('<option value="csv">CSV</option>');
    expect(gridSource).toContain('<option value="pipe">Pipe</option>');
    expect(gridSource).toContain("'Select all rows'");
    expect(gridSource).toContain('aria-label={`Select row ${rowIndex + 1}`}');
    expect(gridSource).toContain('Copy selected');
    expect(gridSource).toContain('checked={includeHeaders}');
  });

  it('offers context-aware quick filters that enter the transform pipeline', () => {
    expect(gridSource).toMatch(/onContextMenu=\{\(event\) =>/);
    expect(gridSource).toContain('className="quick-filter-menu"');
    expect(gridSource).toContain('Keep rows equal to this value');
    expect(gridSource).toContain('Exclude this value');
    expect(appSource).toContain("transform('filter_rows', { column, operator, value })");
    expect(rule('.quick-filter-menu')).toContain('position: fixed');
  });

  it('offers a guided formula builder for common non-SQL expressions', () => {
    expect(operationsSource).toContain("id: 'formula_column'");
    expect(operationsSource).toContain('IF condition');
    expect(operationsSource).toContain('Date difference');
    expect(operationsSource).toContain('Extract text with regex');
    expect(operationsSource).toContain('Combine text');
  });

  it('offers visual join and union workflows with a second-file picker', () => {
    expect(operationsSource).toContain("id: 'join_file'");
    expect(operationsSource).toContain("id: 'union_file'");
    expect(operationsSource).toContain('Column in Current File');
    expect(operationsSource).toContain('Column in Second File');
    expect(operationsSource).toContain('onSelectSecondaryFile');
    expect(appSource).toContain("type: 'selectSecondaryFile'");
  });

  it('keeps chrome compact so the table receives most of the editor height', () => {
    expect(rule('.header')).toContain('min-height: 44px');
    expect(rule('.analysis-pane')).toContain('max-height: min(32%, 320px)');
    expect(rule('.data-grid-row')).toContain('height: 28px');
  });

  it('keeps profile details compact, discoverable, and aligned with columns', () => {
    expect(profilesSource).not.toContain('slice(0, 13)');
    expect(profilesSource).toContain('title={profile.name}');
    expect(profilesSource).toContain('profile-summary-line');
    expect(profilesSource).toContain('Missing:');
    expect(profilesSource).toContain('Distinct:');
    expect(rule('.profile-grid-row')).toContain('position: sticky');
    expect(rule('.profile-card')).toContain('height: 126px');
    expect(rule('.column-profiles')).toContain('padding: 0');
  });

  it('keeps the documentation preview aligned with current headline features', () => {
    expect(previewSource).toContain("type: 'filter_rows'");
    expect(previewSource).toContain("type: 'formula_column'");
    expect(previewSource).toContain("type: 'correlation'");
    expect(previewSource).toContain("{ source: 'preview'");
    expect(previewSource).toContain("kind: 'nulls'");
    expect(previewSource).toContain("kind: 'outliers'");
  });
});
