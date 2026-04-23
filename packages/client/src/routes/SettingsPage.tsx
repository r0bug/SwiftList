import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiKeyRow } from '../api/client.js';
import { useAuth } from '../hooks/useAuth.js';

// Same relative-time helper used on DevicesPage — duplicated here to avoid
// carving out a shared util file for two callers. If a third page wants it,
// lift it into packages/client/src/util/relativeTime.ts.
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

export function SettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-2xl">Settings</h2>
      <AccountSection />
      <ApiKeysSection />
    </div>
  );
}

function AccountSection() {
  const { me } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ok, setOk] = useState(false);

  const change = useMutation({
    mutationFn: () => api.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setOk(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    },
  });

  const valid = next.length >= 8 && next === confirm && current.length > 0;

  return (
    <section className="border border-neutral-800 rounded p-4">
      <h3 className="font-medium mb-3">Account</h3>
      {me ? (
        <div className="text-sm text-neutral-300 mb-4">
          Signed in as <span className="font-mono">{me.email}</span>
          {me.name ? <span className="text-neutral-500"> · {me.name}</span> : null}
          {me.isAdmin ? <span className="ml-2 text-emerald-400 text-xs">admin</span> : null}
        </div>
      ) : null}
      <form
        className="flex flex-col gap-2 max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          setOk(false);
          change.mutate();
        }}
      >
        <label className="text-xs text-neutral-500">Current password</label>
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm"
          autoComplete="current-password"
        />
        <label className="text-xs text-neutral-500 mt-2">New password (min 8)</label>
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm"
          autoComplete="new-password"
        />
        <label className="text-xs text-neutral-500 mt-2">Confirm new password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm"
          autoComplete="new-password"
        />
        {next.length > 0 && next.length < 8 ? (
          <div className="text-xs text-red-400">Must be at least 8 characters.</div>
        ) : null}
        {confirm.length > 0 && next !== confirm ? (
          <div className="text-xs text-red-400">Passwords do not match.</div>
        ) : null}
        <button
          type="submit"
          disabled={!valid || change.isPending}
          className="mt-3 px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm self-start"
        >
          {change.isPending ? 'Saving…' : 'Change password'}
        </button>
        {change.error ? (
          <div className="text-xs text-red-400 mt-2">{(change.error as Error).message}</div>
        ) : null}
        {ok ? <div className="text-xs text-emerald-400 mt-2">Password updated.</div> : null}
      </form>
    </section>
  );
}

function ApiKeysSection() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.listApiKeys(),
  });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [justCreated, setJustCreated] = useState<{ apiKey: string; id: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api.createApiKey({
        name: newName,
        clientName: newClientName.trim() || undefined,
      }),
    onSuccess: (res) => {
      setJustCreated({ apiKey: res.apiKey, id: res.id });
      setNewName('');
      setNewClientName('');
      setCreating(false);
      setCopied(false);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  function dismissJustCreated() {
    setJustCreated(null);
    setCopied(false);
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Fallback: leave user to select manually.
    }
  }

  const keys = data?.keys ?? [];

  return (
    <section className="border border-neutral-800 rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">API keys</h3>
        {!creating && !justCreated ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="px-3 py-1 rounded border border-neutral-700 hover:border-neutral-500 text-sm"
          >
            Create API key
          </button>
        ) : null}
      </div>

      {justCreated ? (
        <div className="mb-4 border border-amber-600/60 bg-amber-950/40 rounded p-3">
          <div className="text-amber-300 text-sm font-medium mb-2">
            Save this — it won't be shown again.
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm bg-neutral-900 border border-neutral-800 rounded px-2 py-1 flex-1 break-all">
              {justCreated.apiKey}
            </code>
            <button
              type="button"
              onClick={() => copyToClipboard(justCreated.apiKey)}
              className="px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 text-xs"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={dismissJustCreated}
            className="mt-3 text-xs text-neutral-400 hover:text-neutral-200"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {creating ? (
        <form
          className="mb-4 flex flex-col gap-2 max-w-md border border-neutral-800 rounded p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            create.mutate();
          }}
        >
          <label className="text-xs text-neutral-500">Key name</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. laptop-chrome"
            className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm"
            autoFocus
          />
          <label className="text-xs text-neutral-500 mt-2">Client name (optional)</label>
          <input
            value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
            placeholder="defaults to “web”"
            className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm"
          />
          <div className="flex gap-2 mt-3">
            <button
              type="submit"
              disabled={!newName.trim() || create.isPending}
              className="px-3 py-1 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 text-sm"
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName('');
                setNewClientName('');
              }}
              className="px-3 py-1 rounded border border-neutral-800 hover:border-neutral-600 text-sm text-neutral-400"
            >
              Cancel
            </button>
          </div>
          {create.error ? (
            <div className="text-xs text-red-400 mt-1">{(create.error as Error).message}</div>
          ) : null}
        </form>
      ) : null}

      {isLoading ? (
        <div className="text-neutral-400">Loading…</div>
      ) : error ? (
        <div className="text-red-400">Error: {(error as Error).message}</div>
      ) : keys.length === 0 ? (
        <div className="text-neutral-500 text-sm">
          No API keys yet. Create one to pair the Chrome extension or watcher.
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-neutral-800 border-t border-neutral-800">
          {keys.map((k) => (
            <ApiKeyRowView
              key={k.id}
              k={k}
              disabled={revoke.isPending}
              onRevoke={() => {
                if (window.confirm(`Revoke API key "${k.name ?? k.client.name}"? This cannot be undone.`)) {
                  revoke.mutate(k.id);
                }
              }}
            />
          ))}
        </div>
      )}
      {revoke.error ? (
        <div className="text-xs text-red-400 mt-2">{(revoke.error as Error).message}</div>
      ) : null}
    </section>
  );
}

function ApiKeyRowView({
  k,
  disabled,
  onRevoke,
}: {
  k: ApiKeyRow;
  disabled: boolean;
  onRevoke: () => void;
}) {
  const revoked = !!k.revokedAt;
  return (
    <div className="py-3 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="font-medium text-sm">
          {k.client.name}
          <span className="text-neutral-500 ml-2">· {k.name ?? '—'}</span>
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          {revoked ? (
            <span className="text-red-400">revoked {relativeTime(k.revokedAt)}</span>
          ) : (
            <span className="text-emerald-400">active</span>
          )}
          {' · '}
          last used {relativeTime(k.lastUsedAt)}
          {' · '}
          created {relativeTime(k.createdAt)}
        </div>
      </div>
      {!revoked ? (
        <button
          type="button"
          onClick={onRevoke}
          disabled={disabled}
          className="px-2 py-1 rounded border border-red-900/60 text-red-400 hover:border-red-500 disabled:opacity-40 text-xs shrink-0"
        >
          Revoke
        </button>
      ) : null}
    </div>
  );
}
