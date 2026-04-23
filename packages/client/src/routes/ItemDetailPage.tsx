import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ItemRow } from '../api/client.js';

function photoSrc(p: { id: string; cdnUrl?: string | null; publicUrl?: string | null }): string {
  if ((p as { cdnUrl?: string | null }).cdnUrl) return (p as { cdnUrl?: string | null }).cdnUrl as string;
  if (p.publicUrl) return p.publicUrl;
  return `/api/v1/items/photo/${p.id}/thumb`;
}

export function ItemDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['item', id],
    queryFn: () => api.getItem(id!),
    enabled: !!id,
  });

  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<null | { mode: 'merge' | 'move' }>(null);

  if (isLoading) return <div className="text-neutral-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>;
  if (!data) return null;

  const toggle = (pid: string) =>
    setSelectedPhotos((s) => {
      const next = new Set(s);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl">{data.title ?? '(untitled)'}</h2>
          <div className="text-xs text-neutral-500 mt-1">
            {data.stage} · {data.status} · completeness {data.completeness?.score ?? 0}% · {data.photos.length} photos
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => {
              setPicker({ mode: 'merge' });
              setSelectedPhotos(new Set());
            }}
            className="px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 text-sm"
          >
            Merge into…
          </button>
          <button
            disabled={selectedPhotos.size === 0}
            onClick={() => setPicker({ mode: 'move' })}
            className="px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Move {selectedPhotos.size > 0 ? `${selectedPhotos.size} ` : ''}selected to…
          </button>
        </div>
      </div>

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm uppercase text-neutral-500">Photos</h3>
          {selectedPhotos.size > 0 && (
            <button
              onClick={() => setSelectedPhotos(new Set())}
              className="text-xs text-neutral-400 hover:text-neutral-200 underline"
            >
              Clear selection
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
          {data.photos.map((p) => {
            const selected = selectedPhotos.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={`relative aspect-square bg-neutral-900 rounded overflow-hidden border-2 ${
                  selected ? 'border-sky-400' : 'border-neutral-800 hover:border-neutral-600'
                }`}
              >
                <img
                  src={photoSrc(p)}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                <span
                  className={`absolute top-1 left-1 w-5 h-5 rounded-full border text-[10px] flex items-center justify-center ${
                    selected
                      ? 'bg-sky-400 border-sky-400 text-neutral-950'
                      : 'bg-neutral-950/70 border-neutral-600 text-transparent'
                  }`}
                >
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-sm uppercase text-neutral-500 mb-2">eBay drafts</h3>
        {data.drafts.length === 0 ? (
          <div className="text-neutral-600 text-sm">No drafts linked yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.drafts.map((d) => (
              <li key={d.id}>
                <a className="text-blue-400 hover:underline" href={d.ebayDraftUrl} target="_blank" rel="noreferrer">
                  {d.ebayDraftUrl}
                </a>
                <span className="text-neutral-500 ml-2">· {d.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm uppercase text-neutral-500 mb-2">Sold comps</h3>
        {data.soldComps.length === 0 ? (
          <div className="text-neutral-600 text-sm">No comps linked yet.</div>
        ) : (
          <ul className="text-sm">
            {data.soldComps.map((c) => (
              <li key={c.id}>
                {c.title} — {c.soldPrice ? `$${c.soldPrice}` : '—'}
              </li>
            ))}
          </ul>
        )}
      </section>

      {picker && (
        <ItemPicker
          excludeId={data.id}
          title={picker.mode === 'merge' ? 'Merge this item into…' : 'Move selected photos to…'}
          onCancel={() => setPicker(null)}
          onPick={async (targetId) => {
            try {
              if (picker.mode === 'merge') {
                await api.mergeItemInto(data.id, targetId);
                await qc.invalidateQueries({ queryKey: ['items'] });
                setPicker(null);
                navigate(`/items/${targetId}`, { replace: true });
              } else {
                await api.movePhotos(data.id, Array.from(selectedPhotos), targetId);
                await qc.invalidateQueries({ queryKey: ['item', data.id] });
                await qc.invalidateQueries({ queryKey: ['item', targetId] });
                setSelectedPhotos(new Set());
                setPicker(null);
              }
            } catch (err) {
              alert((err as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}

function ItemPicker({
  excludeId,
  title,
  onCancel,
  onPick,
}: {
  excludeId: string;
  title: string;
  onCancel: () => void;
  onPick: (itemId: string) => void;
}) {
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['items', q],
    queryFn: () => api.listItems(q || undefined),
  });
  const items = useMemo(() => (data?.items ?? []).filter((i) => i.id !== excludeId), [data, excludeId]);

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-lg p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <h4 className="font-medium">{title}</h4>
          <button onClick={onCancel} className="text-xs text-neutral-400 hover:text-neutral-200">
            Cancel
          </button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title…"
          className="w-full bg-neutral-950 border border-neutral-700 rounded px-3 py-2 text-sm"
        />
        <div className="max-h-80 overflow-y-auto border border-neutral-800 rounded divide-y divide-neutral-800">
          {items.length === 0 ? (
            <div className="text-neutral-500 text-sm p-3">No other items yet.</div>
          ) : (
            items.map((it: ItemRow) => (
              <button
                key={it.id}
                onClick={() => onPick(it.id)}
                className="w-full text-left px-3 py-2 hover:bg-neutral-800/70 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{it.title ?? '(untitled)'}</div>
                  <div className="text-xs text-neutral-500">
                    {it._count.photos} photo{it._count.photos === 1 ? '' : 's'} · {it.stage}
                  </div>
                </div>
                <Link
                  to={`/items/${it.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-neutral-400 hover:text-neutral-200"
                  target="_blank"
                >
                  open ↗
                </Link>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
