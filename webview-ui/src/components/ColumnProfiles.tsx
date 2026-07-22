import React from 'react';

export interface ColumnProfile {
  name: string;
  type: string;
  nullCount: number;
  distinctCount: number;
  min?: unknown;
  max?: unknown;
  mean?: number;
}

interface ColumnProfilesProps {
  profiles: ColumnProfile[];
  totalRows: number;
  loading: boolean;
}

function compact(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3, notation: 'compact' }).format(value);
  }
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 13)}…` : text;
}

export const ColumnProfiles: React.FC<ColumnProfilesProps> = ({ profiles, totalRows, loading }) => {
  if (loading && profiles.length === 0) {
    return <div className="profiles-loading"><span className="profile-spinner" /> Profiling columns…</div>;
  }

  return (
    <div className="column-profiles">
      {profiles.map(profile => {
        const validCount = Math.max(0, totalRows - profile.nullCount);
        const validPercent = totalRows ? (validCount / totalRows) * 100 : 0;
        const nullPercent = 100 - validPercent;
        const numericMin = typeof profile.min === 'number' ? profile.min : undefined;
        const numericMax = typeof profile.max === 'number' ? profile.max : undefined;
        const meanPosition = numericMin !== undefined && numericMax !== undefined && profile.mean !== undefined && numericMax !== numericMin
          ? Math.max(0, Math.min(100, ((profile.mean - numericMin) / (numericMax - numericMin)) * 100))
          : undefined;

        return (
          <article className="profile-card" key={profile.name}>
            <header className="profile-card-header">
              <strong title={profile.name}>{profile.name}</strong>
              <span>{profile.type}</span>
            </header>
            <div className="quality-bar" title={`${validPercent.toFixed(1)}% valid · ${nullPercent.toFixed(1)}% null`}>
              <span className="quality-valid" style={{ width: `${validPercent}%` }} />
              <span className="quality-null" style={{ width: `${nullPercent}%` }} />
            </div>
            <div className="profile-metrics">
              <span><b>{validPercent.toFixed(1)}%</b> valid</span>
              <span><b>{profile.nullCount.toLocaleString()}</b> null</span>
              <span><b>{profile.distinctCount.toLocaleString()}</b> unique</span>
            </div>
            {numericMin !== undefined && numericMax !== undefined ? (
              <div className="range-profile">
                <div className="range-track">
                  {meanPosition !== undefined && <span className="range-mean" style={{ left: `${meanPosition}%` }} title={`Mean ${compact(profile.mean)}`} />}
                </div>
                <div className="range-labels"><span>{compact(numericMin)}</span><span>μ {compact(profile.mean)}</span><span>{compact(numericMax)}</span></div>
              </div>
            ) : (
              <div className="value-range"><span>Min <b>{compact(profile.min)}</b></span><span>Max <b>{compact(profile.max)}</b></span></div>
            )}
          </article>
        );
      })}
    </div>
  );
};
