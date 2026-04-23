import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type DraftRow } from '../api/client.js';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function relativeFrom(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = then - Date.now();
  const absMs = Math.abs(diffMs);
  const sec = 1000;
  const min = 60 * sec;
  const hr = 60 * min;
  const day = 24 * hr;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    absMs < min ? [Math.round(diffMs / sec), 'second']
    : absMs < hr ? [Math.round(diffMs / min), 'minute']
    : absMs < day ? [Math.round(diffMs / hr), 'hour']
    : absMs < week ? [Math.round(diffMs / day), 'day']
    : absMs < month ? [Math.round(diffMs / week), 'week']
    : absMs < year ? [Math.round(diffMs / month), 'month']
    : [Math.round(diffMs / year), 'year'];

  return rtf.format(value, unit);
}

const STATUS_STYLES: Record<DraftRow['status'], string> = {
  OPEN: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  SUBMITTED: 'bg-sky-900/40 text-sky-300 border-sky-800',
  ABANDONED: 'bg-neutral-800 text-neutral-400 border-neutral-700',
  UNKNOWN: 'bg-amber-900/40 text-amber-300 border-amber-800',
};

function StatusBadge({ status }: { status: DraftRow['status'] }) {
  const cls = STATUS_STYLES[status] ?? STATUS_STYLES.UNKNOWN;
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded border ${cls}`}>{status}</span>
  );
}

export function DraftsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['drafts'],
    queryFn: () => api.listDrafts(),
  });

  if (isLoading) return <div className="text-neutral-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>;

  const drafts = data?.drafts ?? [];

  return (
    <div>
      <h2 className="text-2xl mb-4">Drafts</h2>
      {drafts.length === 0 ? (
        <div className="text-neutral-500">
          No drafts yet — the Chrome extension records them when you open an eBay listing page.
        </div>
      ) : (
        <div className="border border-neutral-800 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Item</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Account</th>
                <th className="text-left px-3 py-2 font-medium">Last seen</th>
                <th className="text-left px-3 py-2 font-medium">eBay draft</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id} className="border-t border-neutral-800 hover:bg-neutral-900/50">
                  <td className="px-3 py-2">
                    <Link
                      to={`/items/${d.item.id}`}
                      className="text-neutral-100 hover:underline"
                    >
                      {d.item.title ?? '(untitled)'}
                    </Link>
                    {d.item.brand && (
                      <div className="text-xs text-neutral-500">{d.item.brand}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-3 py-2 text-neutral-400">
                    {d.accountHint ?? <span className="text-neutral-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-400" title={new Date(d.lastSeenAt).toLocaleString()}>
                    {relativeFrom(d.lastSeenAt)}
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={d.ebayDraftUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:text-sky-300 hover:underline break-all"
                    >
                      {d.ebayDraftId ?? 'Open on eBay'}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
