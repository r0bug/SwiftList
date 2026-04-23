import { useQuery } from '@tanstack/react-query';
import { api, type Device } from '../api/client.js';

// Relative-time formatter — avoids pulling in a dep. Collapses the usual
// seconds/minutes/hours/days scale; falls back to a plain locale date.
function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Date.now() - then;
  if (diff < 0) return 'in the future';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Cheap UA summary — pulls out the common browser/OS tokens without
// hauling in ua-parser. Unknown strings just get truncated to 80 chars.
function summarizeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown client';
  const browser = /Edg\/[\d.]+/.test(ua)
    ? 'Edge'
    : /OPR\/[\d.]+/.test(ua)
      ? 'Opera'
      : /Firefox\/[\d.]+/.test(ua)
        ? 'Firefox'
        : /Chrome\/[\d.]+/.test(ua)
          ? 'Chrome'
          : /Safari\/[\d.]+/.test(ua)
            ? 'Safari'
            : null;
  const os = /Windows NT/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iOS/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (browser || os) return [browser, os].filter(Boolean).join(' on ');
  return ua.slice(0, 80);
}

interface Group {
  apiKey: Device['apiKey'];
  client: Device['client'];
  machines: Device[];
}

function groupByApiKey(devices: Device[]): Group[] {
  const map = new Map<string, Group>();
  for (const d of devices) {
    const g = map.get(d.apiKey.id);
    if (g) {
      g.machines.push(d);
    } else {
      map.set(d.apiKey.id, { apiKey: d.apiKey, client: d.client, machines: [d] });
    }
  }
  return Array.from(map.values());
}

export function DevicesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.listDevices(),
  });

  if (isLoading) return <div className="text-neutral-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>;

  const devices = data?.devices ?? [];
  const groups = groupByApiKey(devices);

  return (
    <div>
      <h2 className="text-2xl mb-4">Devices</h2>
      {groups.length === 0 ? (
        <div className="text-neutral-500">
          No devices have checked in yet. Mint an API key in Settings and load the Chrome extension.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.apiKey.id} className="border border-neutral-800 rounded p-4">
              <div className="flex items-baseline justify-between gap-4 mb-3">
                <div>
                  <div className="font-medium">
                    {g.client.name}
                    {g.client.email ? (
                      <span className="text-neutral-500 text-sm ml-2">{g.client.email}</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    API key: {g.apiKey.name ?? '(unnamed)'} ·{' '}
                    {g.apiKey.revokedAt ? (
                      <span className="text-red-400">revoked {relativeTime(g.apiKey.revokedAt)}</span>
                    ) : (
                      <span className="text-emerald-400">active</span>
                    )}
                    {g.apiKey.lastUsedAt ? ` · used ${relativeTime(g.apiKey.lastUsedAt)}` : ''}
                  </div>
                </div>
                <div className="text-xs text-neutral-500">
                  {g.machines.length} {g.machines.length === 1 ? 'machine' : 'machines'}
                </div>
              </div>
              <div className="flex flex-col divide-y divide-neutral-800 border-t border-neutral-800">
                {g.machines.map((m) => (
                  <div key={m.id} className="py-3 flex flex-col gap-1">
                    <div className="text-sm">{summarizeUserAgent(m.userAgent)}</div>
                    <div className="text-xs text-neutral-500 font-mono truncate">{m.machineId}</div>
                    <div className="text-xs text-neutral-500">
                      last seen {relativeTime(m.lastSeenAt)} · first seen {relativeTime(m.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
