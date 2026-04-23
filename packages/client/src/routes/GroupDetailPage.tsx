import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PoolPhoto } from '../api/client.js';

type GroupPhoto = {
  id: string;
  thumbnailPath: string | null;
  publicUrl: string | null;
  cdnUrl: string | null;
  originalPath: string | null;
  createdAt: string;
};

function resolvePhotoSrc(p: { cdnUrl: string | null; publicUrl: string | null; id: string }): string {
  if (p.cdnUrl) return p.cdnUrl;
  if (p.publicUrl) return p.publicUrl;
  return `/api/v1/items/photo/${p.id}/thumb`;
}

export function GroupDetailPage() {
  const { id } = useParams();
  const groupId = id!;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [addMode, setAddMode] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => api.getGroup(groupId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['group', groupId] });
    qc.invalidateQueries({ queryKey: ['pool'] });
    qc.invalidateQueries({ queryKey: ['groups', 'unidentified'] });
  };

  const removePhoto = useMutation({
    mutationFn: (photoId: string) => api.removePhotoFromGroup(groupId, photoId),
    onSuccess: invalidate,
  });
  const deletePhoto = useMutation({
    mutationFn: (photoId: string) => api.deletePhoto(photoId),
    onSuccess: invalidate,
  });
  const deleteGroup = useMutation({
    mutationFn: () => api.deleteGroup(groupId),
    onSuccess: () => {
      invalidate();
      navigate('/pool');
    },
  });

  if (isLoading) return <div className="text-neutral-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>;
  if (!data) return null;

  const photos = data.photos;
  const isIdentified = !!data.item;
  const title = data.item?.title ?? data.label ?? '(unnamed group)';

  return (
    <div>
      <div className="flex items-center gap-3 mb-1 text-sm text-neutral-500">
        <Link to="/" className="hover:text-neutral-300">Items</Link>
        <span>/</span>
        {isIdentified ? (
          <span>In-process</span>
        ) : (
          <span>Unidentified</span>
        )}
      </div>
      <div className="flex items-baseline justify-between mb-4 gap-4">
        <h2 className="text-2xl truncate">📁 {title}</h2>
        <div className="text-xs text-neutral-500 shrink-0">
          {photos.length} photo{photos.length === 1 ? '' : 's'} · {data.status}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          disabled
          title="Coming soon"
          className="px-3 py-1.5 text-sm rounded bg-neutral-100 text-neutral-900 disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          Run AI identification
        </button>
        <button
          disabled
          title="Coming soon"
          className="px-3 py-1.5 text-sm rounded border border-neutral-700 text-neutral-400 disabled:opacity-60"
        >
          eBay image search
        </button>
        <button
          onClick={() => setAddMode((v) => !v)}
          className="px-3 py-1.5 text-sm rounded border border-neutral-700 text-neutral-200 hover:border-neutral-500"
        >
          {addMode ? 'Done adding' : '+ Add photos from pool'}
        </button>
        <button
          onClick={() => {
            if (confirm('Dissolve this group? Photos go back to the pool.')) deleteGroup.mutate();
          }}
          className="ml-auto px-3 py-1.5 text-sm rounded border border-red-900 text-red-300 hover:border-red-700"
        >
          Dissolve group
        </button>
      </div>

      {photos.length === 0 ? (
        <div className="text-neutral-500">No photos in this group.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
          {photos.map((p) => (
            <GroupPhotoCell
              key={p.id}
              photo={p}
              onRemove={() => removePhoto.mutate(p.id)}
              onDelete={() => {
                if (confirm('Hard-delete this photo? Files will be removed.')) deletePhoto.mutate(p.id);
              }}
            />
          ))}
        </div>
      )}

      {addMode && <AddFromPool groupId={groupId} onAdded={invalidate} />}
    </div>
  );
}

function GroupPhotoCell({
  photo,
  onRemove,
  onDelete,
}: {
  photo: GroupPhoto;
  onRemove: () => void;
  onDelete: () => void;
}) {
  const src = resolvePhotoSrc(photo);
  return (
    <div className="border border-neutral-800 rounded overflow-hidden bg-neutral-950 group relative">
      <div className="aspect-square bg-neutral-900">
        <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
      </div>
      <div className="absolute inset-x-0 bottom-0 p-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition bg-gradient-to-t from-black/80 to-transparent">
        <button
          onClick={onRemove}
          title="Remove from group (back to pool)"
          className="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
        >
          ↩︎ Remove
        </button>
        <button
          onClick={onDelete}
          title="Hard-delete photo"
          className="text-xs px-2 py-1 rounded bg-red-900/70 text-red-100 hover:bg-red-800"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

function AddFromPool({ groupId, onAdded }: { groupId: string; onAdded: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data } = useQuery({ queryKey: ['pool'], queryFn: () => api.listPool() });
  const add = useMutation({
    mutationFn: (ids: string[]) => api.addPhotosToGroup(groupId, ids),
    onSuccess: () => {
      setSelected(new Set());
      onAdded();
    },
  });

  const poolPhotos = data?.photos ?? [];
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="border border-neutral-800 rounded p-4 bg-neutral-950">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm text-neutral-300">Pool ({poolPhotos.length})</h3>
        <button
          onClick={() => add.mutate(Array.from(selected))}
          disabled={selected.size === 0 || add.isPending}
          className="px-3 py-1.5 text-sm rounded bg-neutral-100 text-neutral-900 disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {add.isPending ? 'Adding…' : `Add ${selected.size} to group`}
        </button>
      </div>
      {poolPhotos.length === 0 ? (
        <div className="text-neutral-500 text-sm">Pool is empty.</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {poolPhotos.map((p) => (
            <PoolCell key={p.id} photo={p} selected={selected.has(p.id)} onToggle={() => toggle(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PoolCell({
  photo,
  selected,
  onToggle,
}: {
  photo: PoolPhoto;
  selected: boolean;
  onToggle: () => void;
}) {
  const src = resolvePhotoSrc(photo);
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`aspect-square rounded overflow-hidden relative border ${
        selected ? 'border-blue-400 ring-2 ring-blue-400/30' : 'border-neutral-800 hover:border-neutral-600'
      }`}
    >
      <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
      {selected && (
        <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-blue-400 text-white text-xs flex items-center justify-center">
          ✓
        </div>
      )}
    </button>
  );
}
