import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { getBulkFirmwareUpdateDevices } from '../services/api';
import type {
  BulkDeviceState,
  BulkFirmwareJob,
  BulkJobDeviceRow,
} from '../services/api';

const STATE_LABEL: Record<BulkDeviceState, string> = {
  failed: 'Failed',
  sent: 'No reply',
  in_progress: 'Updating',
  queued: 'Waiting to send',
  success: 'Success',
  skipped_uptodate: 'Skipped (up to date)',
  skipped_beta: 'Skipped (beta)',
  skipped_legacy: 'Skipped (legacy < 436)',
};

const FILTERS: (BulkDeviceState | 'all')[] = [
  'all',
  'failed',
  'sent',
  'in_progress',
  'queued',
  'success',
  'skipped_uptodate',
  'skipped_beta',
  'skipped_legacy',
];

const PAGE_SIZE = 50;

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Per-device view of a bulk firmware job: filter by state, see the last OTA
 * message each device reported, export everything as CSV.
 */
const BulkJobDevices: React.FC<{ job: BulkFirmwareJob }> = ({ job }) => {
  const [filter, setFilter] = useState<BulkDeviceState | 'all'>('failed');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<BulkJobDeviceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const counts = job.counts as Record<string, number | undefined>;
  const countOf = (f: BulkDeviceState | 'all') =>
    f === 'all'
      ? Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0)
      : counts[f] ?? 0;

  // Refetch when the filter/page changes and whenever the job's counters move
  // (the parent polls the job every few seconds).
  const countsKey = JSON.stringify(job.counts);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getBulkFirmwareUpdateDevices(job.jobId, {
      state: filter === 'all' ? undefined : filter,
      page,
      limit: PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return;
        setRows(res.data.data);
        setTotal(res.data.total);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.jobId, filter, page, countsKey]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await getBulkFirmwareUpdateDevices(job.jobId, {
        state: filter === 'all' ? undefined : filter,
        page: 1,
        limit: 5000,
      });
      const header = [
        'deviceId',
        'userId',
        'state',
        'otaStatus',
        'progress',
        'message',
        'versionBefore',
        'updatedAt',
      ];
      const lines = res.data.data.map((r) =>
        [
          r.deviceId,
          r.userId,
          STATE_LABEL[r.state] ?? r.state,
          r.otaStatus,
          r.progress,
          r.message,
          r.version,
          r.at,
        ]
          .map(csvCell)
          .join(','),
      );
      const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\n')], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bulk-update-${job.jobId.slice(0, 8)}-${filter}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="bulk-devices">
      <div className="bulk-filters">
        {FILTERS.filter((f) => f === 'all' || countOf(f) > 0 || f === filter).map(
          (f) => (
            <button
              key={f}
              className={`bulk-filter ${f === filter ? 'active' : ''} state-${f}`}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
            >
              {f === 'all' ? 'All' : STATE_LABEL[f]} <strong>{countOf(f)}</strong>
            </button>
          ),
        )}
        <button
          className="btn btn-secondary btn-sm bulk-export"
          onClick={exportCsv}
          disabled={exporting || total === 0}
          title="Download the devices in this filter as CSV"
        >
          {exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
          CSV
        </button>
      </div>

      <div className="bulk-table-wrap">
        <table className="bulk-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>User</th>
              <th>State</th>
              <th>Last report</th>
              <th>Version before</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted center">
                  <Loader2 size={16} className="spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted center">
                  No devices in this state
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.userId}/${r.deviceId}`}>
                  <td className="monospace">{r.deviceId}</td>
                  <td className="monospace muted" title={r.userId}>
                    {r.userId.slice(0, 10)}…
                  </td>
                  <td>
                    <span className={`bulk-state state-${r.state}`}>
                      {STATE_LABEL[r.state] ?? r.state}
                    </span>
                  </td>
                  <td>
                    {r.otaStatus && <span className="muted">{r.otaStatus}</span>}
                    {typeof r.progress === 'number' && r.progress >= 0 && (
                      <span className="muted"> · {r.progress}%</span>
                    )}
                    {r.message && <div>{r.message}</div>}
                  </td>
                  <td className="monospace">{r.version ?? '—'}</td>
                  <td className="muted">
                    {r.at ? new Date(r.at).toLocaleTimeString() : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="bulk-pager">
          <button
            className="btn-icon"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="muted">
            Page {page} of {totalPages} · {total} devices
          </span>
          <button
            className="btn-icon"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default BulkJobDevices;
