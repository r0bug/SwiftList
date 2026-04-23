import { useQuery } from '@tanstack/react-query';
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
  const { data, isLoading, error } = useQuery({
    queryKey: ['pool'],
    queryFn: () => api.listPool(),
  });

  if (isLoading) return <div className="text-neutral-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>;

  const photos = data?.photos ?? [];
  const total = data?.total ?? 0;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-2xl">Pool</h2>
        <div className="text-xs text-neutral-500">
          {total} un-grouped photo{total === 1 ? '' : 's'}
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="text-neutral-500">
          Pool is empty — drop photos into the watcher inbox to get started.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {photos.map((p) => {
            const src = resolvePhotoSrc(p);
            return (
              <div
                key={p.id}
                className="border border-neutral-800 rounded overflow-hidden bg-neutral-950 hover:border-neutral-600"
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
                <div className="p-2 text-xs">
                  <div className="truncate text-neutral-300" title={p.originalPath ?? ''}>
                    {p.originalPath ?? '(unnamed)'}
                  </div>
                  <div className="text-neutral-500 mt-0.5">{formatDate(p.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
