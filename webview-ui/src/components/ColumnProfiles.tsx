import React from 'react';

export interface ColumnProfile {
  name: string;
  type: string;
  nullCount: number;
  distinctCount: number;
  min?: unknown;
  max?: unknown;
  mean?: number;
  p50?: number;
  p90?: number;
  p99?: number;
  histogram?: number[];
}

interface ColumnProfilesProps {
  columns: Array<{ name: string; type: string }>;
  profiles: ColumnProfile[];
  totalRows: number;
  loading: boolean;
  gridTemplateColumns: string;
  minWidth: string;
}

function compact(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 3,
      notation: 'compact',
    }).format(value);
  }
  return String(value);
}

export const ColumnProfiles: React.FC<ColumnProfilesProps> = ({
  columns,
  profiles,
  totalRows,
  loading,
  gridTemplateColumns,
  minWidth,
}) => (
  <div
    className="column-profiles profile-grid-row"
    style={{ gridTemplateColumns, minWidth }}
    aria-label="Column profiles"
  >
    <div className="profile-gutter" title="Column profiles">
      {loading && profiles.length === 0 ? <span className="profile-spinner" /> : ''}
    </div>
    {columns.map((column) => {
      const profile = profiles.find((item) => item.name === column.name);
      if (!profile) {
        const activeLoading = loading && profiles.length === 0;
        return (
          <article className="profile-card profile-placeholder" key={column.name}>
            <header className="profile-card-header">
              <strong title={column.name}>{column.name}</strong>
              <span className="profile-type" title={column.type}>
                {column.type}
              </span>
            </header>
            <span>{activeLoading ? 'Profiling…' : 'Profile unavailable'}</span>
          </article>
        );
      }

      const validCount = Math.max(0, totalRows - profile.nullCount);
      const validPercent = totalRows ? (validCount / totalRows) * 100 : 0;
      const nullPercent = 100 - validPercent;
      const numericMin = typeof profile.min === 'number' ? profile.min : undefined;
      const numericMax = typeof profile.max === 'number' ? profile.max : undefined;
      const meanPosition =
        numericMin !== undefined &&
        numericMax !== undefined &&
        profile.mean !== undefined &&
        numericMax !== numericMin
          ? Math.max(
              0,
              Math.min(100, ((profile.mean - numericMin) / (numericMax - numericMin)) * 100),
            )
          : undefined;
      const histogram = profile.histogram ?? percentileHistogram(profile, validCount);
      const histogramMax = Math.max(...histogram, 1);

      return (
        <article className="profile-card" key={profile.name}>
          <header className="profile-card-header">
            <strong title={profile.name}>{profile.name}</strong>
            <span className="profile-type" title={profile.type}>
              {profile.type}
            </span>
          </header>
          <div className="profile-summary-line">
            <span>
              Missing: <b>{profile.nullCount.toLocaleString()}</b>{' '}
              <small>({nullPercent.toFixed(1)}%)</small>
            </span>
            <span>
              Distinct: <b>{profile.distinctCount.toLocaleString()}</b>
            </span>
          </div>
          <div
            className={`quality-bar ${nullPercent >= 20 ? 'quality-poor' : nullPercent >= 5 ? 'quality-warning' : ''}`}
            title={`${validPercent.toFixed(1)}% valid · ${nullPercent.toFixed(1)}% missing`}
          >
            <span className="quality-valid" style={{ width: `${validPercent}%` }} />
            <span className="quality-null" style={{ width: `${nullPercent}%` }} />
          </div>
          {histogram.length > 0 ? (
            <div
              className="profile-histogram"
              role="img"
              aria-label={`Value distribution for ${profile.name}`}
              title={`Distribution · ${profile.nullCount.toLocaleString()} missing values`}
            >
              {histogram.map((count, index) => (
                <span
                  key={index}
                  style={{ height: `${Math.max(8, (count / histogramMax) * 100)}%` }}
                />
              ))}
            </div>
          ) : numericMin !== undefined && numericMax !== undefined ? (
            <div className="range-profile">
              <div className="range-track">
                {meanPosition !== undefined && (
                  <span
                    className="range-mean"
                    style={{ left: `${meanPosition}%` }}
                    title={`Mean ${compact(profile.mean)}`}
                  />
                )}
              </div>
              <div className="range-labels">
                <span title={`Minimum ${compact(numericMin)}`}>{compact(numericMin)}</span>
                <span title={`Mean ${compact(profile.mean)}`}>μ {compact(profile.mean)}</span>
                <span title={`Maximum ${compact(numericMax)}`}>{compact(numericMax)}</span>
              </div>
            </div>
          ) : profile.min !== undefined || profile.max !== undefined ? (
            <div className="value-range">
              <span title={`Minimum ${compact(profile.min)}`}>{compact(profile.min)}</span>
              <span title={`Maximum ${compact(profile.max)}`}>{compact(profile.max)}</span>
            </div>
          ) : null}
        </article>
      );
    })}
  </div>
);

function percentileHistogram(profile: ColumnProfile, validCount: number): number[] {
  if (profile.p50 === undefined || profile.p90 === undefined || profile.p99 === undefined)
    return [];
  const p50 = Math.floor(validCount * 0.5);
  const p90 = Math.floor(validCount * 0.9);
  const p99 = Math.floor(validCount * 0.99);
  return [p50, p90 - p50, p99 - p90, validCount - p99];
}

export default ColumnProfiles;
