import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type PoolPhoto } from '../api/client.js';

// URL resolution mirrors ItemDetailPage: prefer publicUrl (absolute or
// /public-images/... path), fall back to /uploads/<thumbnailPath>.
function resolvePhotoSrc(p: PoolPhoto): string {
  if (p.cdnUrl) return p.cdnUrl;
  if (p.publicUrl) return p.publicUrl;
  return `/api/v1/items/photo/${p.id}/thumb`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function PoolPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ['pool'],
    queryFn: () => api.listPool(),
  });

  const createGroup = useMutation({
    mutationFn: (photoIds: string[]) => api.createGroup(photoIds),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['pool'] });
      qc.invalidateQueries({ queryKey: ['groups', 'unidentified'] });
      setSelected(new Set());
      navigate(`/groups/${res.id}`);
    },
  });

  if (isLoading) return <div className="text-neutral-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>;

  const photos = data?.photos ?? [];
  const total = data?.total ?? 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-2xl">Pool</h2>
        <div className="text-xs text-neutral-500">
          {total} un-grouped photo{total === 1 ? '' : 's'}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => createGroup.mutate(Array.from(selected))}
          disabled={selected.size === 0 || createGroup.isPending}
          className="px-3 py-1.5 text-sm rounded bg-neutral-100 text-neutral-900 disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {createGroup.isPending ? 'Grouping…' : `Group Selected (${selected.size})`}
        </button>
        {selected.size > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 text-sm rounded border border-neutral-800 text-neutral-400 hover:border-neutral-600"
          >
            Clear selection
          </button>
        )}
        {createGroup.error && (
          <span className="text-xs text-red-400">{(createGroup.error as Error).message}</span>
        )}
      </div>

      {photos.length === 0 ? (
        <div className="text-neutral-500">
          Pool is empty — drop photos into the watcher inbox to get started.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {photos.map((p) => {
            const src = resolvePhotoSrc(p);
            const isSelected = selected.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={`text-left border rounded overflow-hidden bg-neutral-950 relative ${
                  isSelected
                    ? 'border-blue-400 ring-2 ring-blue-400/30'
                    : 'border-neutral-800 hover:border-neutral-600'
                }`}
              >
                <div className="aspect-square bg-neutral-900 flex items-center justify-center">
                  {src ? (
                    <img
                      src={src}
                      alt={p.originalPath ?? ''}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-neutral-600 text-xs">no preview</div>
                  )}
                </div>
                {isSelected && (
                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-blue-400 text-white text-xs flex items-center justify-center">
                    ✓
                  </div>
                )}
                <div className="p-2 text-xs">
                  <div className="truncate text-neutral-300" title={p.originalPath ?? ''}>
                    {p.originalPath ?? '(unnamed)'}
                  </div>
                  <div className="text-neutral-500 mt-0.5">{formatDate(p.createdAt)}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
