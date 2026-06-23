import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const METRIC_LABELS = {
  reach: 'Reach',
  views: 'Views',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
  saved: 'Saves',
  total_interactions: 'Total Interactions',
  follows: 'Follows',
  profile_visits: 'Profile Visits',
  reposts: 'Reposts',
  ig_reels_avg_watch_time: 'Avg Watch Time (s)',
  ig_reels_video_view_total_time: 'Total Watch Time (s)',
  reels_skip_rate: 'Skip Rate (%)',
};

function formatMetric(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export default function IgInsightsPanel({ insights }) {
  const { history } = insights;
  if (!history || history.length === 0) return null;

  const latest = history[history.length - 1].metrics;
  const metricKeys = Object.keys(METRIC_LABELS).filter((k) => latest[k] != null);

  const chartData = history.map((snap) => ({
    date: new Date(snap.fetchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    ...snap.metrics,
  }));
  const chartMetrics = ['reach', 'saved', 'shares', 'follows'].filter((k) => latest[k] != null);

  return (
    <div style={{
      borderBottom: 'var(--border)',
      background: 'var(--color-white)',
      padding: '12px 24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
        <h3 style={{
          fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)',
        }}>
          Instagram Insights
        </h3>
        <span className="label">{insights.mediaProductType || insights.mediaType}</span>
      </div>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: history.length > 1 ? '16px' : 0 }}>
        {metricKeys.map((key) => (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, lineHeight: 1.1 }}>
              {formatMetric(latest[key])}
            </span>
            <span className="label">{METRIC_LABELS[key]}</span>
          </div>
        ))}
      </div>

      {history.length > 1 && chartMetrics.length > 0 && (
        <div style={{ width: '100%', maxWidth: '640px', height: '160px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontFamily: 'var(--font-mono)', fontSize: 9 }} />
              <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 9 }} />
              <Tooltip contentStyle={{ fontFamily: 'var(--font-mono)', fontSize: 10 }} />
              {chartMetrics.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={METRIC_LABELS[key]}
                  stroke={['#000', '#888', '#0a6', '#c00'][i % 4]}
                  strokeWidth={1.5}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
