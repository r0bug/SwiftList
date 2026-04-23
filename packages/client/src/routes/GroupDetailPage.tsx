import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type EbayHit, type GroupDetail, type PoolPhoto } from '../api/client.js';

type GroupPhoto = GroupDetail['photos'][number];

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
  const [aiModal, setAiModal] = useState(false);
  const [ebaySearchPhotoId, setEbaySearchPhotoId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => api.getGroup(groupId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['group', groupId] });
    qc.invalidateQueries({ queryKey: ['pool'] });
    qc.invalidateQueries({ queryKey: ['groups', 'unidentified'] });
    qc.invalidateQueries({ queryKey: ['items'] });
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
        <span>{isIdentified ? 'In-process' : 'Unidentified'}</span>
      </div>
      <div className="flex items-baseline justify-between mb-4 gap-4">
        <h2 className="text-2xl truncate">📁 {title}</h2>
        <div className="text-xs text-neutral-500 shrink-0">
          {photos.length} photo{photos.length === 1 ? '' : 's'} · {data.status}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          onClick={() => setAiModal(true)}
          disabled={photos.length === 0}
          className="px-3 py-1.5 text-sm rounded bg-neutral-100 text-neutral-900 disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          Run AI identification
        </button>
        <button
          onClick={() => setEbaySearchPhotoId(photos[0]?.id ?? null)}
          disabled={photos.length === 0}
          className="px-3 py-1.5 text-sm rounded border border-neutral-700 text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
        >
          eBay image search
        </button>
        <button
          onClick={() => setAddMode((v) => !v)}
          className="px-3 py-1.5 text-sm rounded border border-neutral-700 text-neutral-200 hover:border-neutral-500"
        >
          {addMode ? 'Done adding' : '+ Add photos from pool'}
        </button>
        {isIdentified && data.item && (
          <Link
            to={`/items/${data.item.id}`}
            className="px-3 py-1.5 text-sm rounded border border-neutral-700 text-neutral-200 hover:border-neutral-500"
          >
            Open Item →
          </Link>
        )}
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
              onSearch={() => setEbaySearchPhotoId(p.id)}
              onRemove={() => removePhoto.mutate(p.id)}
              onDelete={() => {
                if (confirm('Hard-delete this photo? Files will be removed.')) deletePhoto.mutate(p.id);
              }}
            />
          ))}
        </div>
      )}

      {addMode && <AddFromPool groupId={groupId} onAdded={invalidate} />}

      {aiModal && (
        <RunAiModal
          groupId={groupId}
          onClose={() => setAiModal(false)}
          onDone={(resp) => {
            setAiModal(false);
            invalidate();
            if (resp.queued === false) navigate(`/items/${resp.itemId}`);
          }}
        />
      )}

      {ebaySearchPhotoId && (
        <EbaySearchModal
          groupId={groupId}
          photoId={ebaySearchPhotoId}
          photos={photos}
          onChangePhoto={setEbaySearchPhotoId}
          onClose={() => setEbaySearchPhotoId(null)}
          onIdentified={(itemId) => {
            setEbaySearchPhotoId(null);
            invalidate();
            navigate(`/items/${itemId}`);
          }}
        />
      )}
    </div>
  );
}

function GroupPhotoCell({
  photo,
  onSearch,
  onRemove,
  onDelete,
}: {
  photo: GroupPhoto;
  onSearch: () => void;
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
          onClick={onSearch}
          title="eBay image search from this photo"
          className="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
        >
          🔍
        </button>
        <button
          onClick={onRemove}
          title="Remove from group (back to pool)"
          className="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
        >
          ↩︎
        </button>
        <button
          onClick={onDelete}
          title="Hard-delete photo"
          className="text-xs px-2 py-1 rounded bg-red-900/70 text-red-100 hover:bg-red-800 ml-auto"
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

function RunAiModal({
  groupId,
  onClose,
  onDone,
}: {
  groupId: string;
  onClose: () => void;
  onDone: (resp: Awaited<ReturnType<typeof api.identifyGroupAi>>) => void;
}) {
  const [context, setContext] = useState('');
  const [usePriors, setUsePriors] = useState(true);
  const run = useMutation({
    mutationFn: () =>
      api.identifyGroupAi(groupId, { context: context.trim() || undefined, useVisualPriors: usePriors }),
    onSuccess: onDone,
  });

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/80 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-lg p-4 space-y-4">
        <div className="flex items-baseline justify-between">
          <h4 className="font-medium">Run AI identification</h4>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-200">
            Cancel
          </button>
        </div>
        <div>
          <label className="block text-sm text-neutral-300 mb-1">
            Optional context (what do these photos show?)
          </label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={4}
            placeholder="e.g. antique cast-iron stationary engine, possibly a model; estate lot of electrical hardware"
            className="w-full text-sm bg-neutral-950 border border-neutral-800 rounded p-2 text-neutral-200 placeholder:text-neutral-600"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Scoped to this run. Takes precedence over the global Settings → Ingest hint.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={usePriors}
            onChange={(e) => setUsePriors(e.target.checked)}
            className="accent-blue-400"
          />
          Use eBay image-search results as visual hints
        </label>
        {run.error && (
          <div className="text-sm text-red-400">{(run.error as Error).message}</div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-neutral-700 text-neutral-300"
          >
            Cancel
          </button>
          <button
            onClick={() => run.mutate()}
            disabled={run.isPending}
            className="px-3 py-1.5 text-sm rounded bg-neutral-100 text-neutral-900 disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            {run.isPending ? 'Analyzing…' : 'Identify'}
          </button>
        </div>
        {run.data && run.data.queued === true && (
          <div className="text-sm text-amber-300">
            Queued for external MCP worker (batch {run.data.batchId}). Drain from a Claude Code session.
          </div>
        )}
      </div>
    </div>
  );
}

function EbaySearchModal({
  groupId,
  photoId,
  photos,
  onChangePhoto,
  onClose,
  onIdentified,
}: {
  groupId: string;
  photoId: string;
  photos: GroupPhoto[];
  onChangePhoto: (id: string) => void;
  onClose: () => void;
  onIdentified: (itemId: string) => void;
}) {
  const [picked, setPicked] = useState<EbayHit | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['group-image-search', groupId, photoId],
    queryFn: () => api.groupImageSearch(groupId, photoId),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/80 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden bg-neutral-900 border border-neutral-800 rounded-lg flex flex-col">
        <div className="flex items-baseline justify-between p-4 border-b border-neutral-800">
          <h4 className="font-medium">eBay image search</h4>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-200">
            Close
          </button>
        </div>
        <div className="p-4 border-b border-neutral-800">
          <div className="text-xs text-neutral-400 mb-2">Search from photo:</div>
          <div className="flex gap-2 overflow-x-auto">
            {photos.map((p) => {
              const src = resolvePhotoSrc(p);
              const selected = p.id === photoId;
              return (
                <button
                  key={p.id}
                  onClick={() => onChangePhoto(p.id)}
                  className={`shrink-0 w-16 h-16 rounded overflow-hidden border ${
                    selected ? 'border-blue-400 ring-2 ring-blue-400/30' : 'border-neutral-800'
                  }`}
                >
                  <img src={src} alt="" className="w-full h-full object-cover" />
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && <div className="text-neutral-400">Searching eBay…</div>}
          {error && <div className="text-red-400">Error: {(error as Error).message}</div>}
          {data && data.itemSummaries.length === 0 && (
            <div className="text-neutral-500">No matches. Try a different photo angle.</div>
          )}
          <ul className="space-y-2">
            {data?.itemSummaries.map((hit) => (
              <li
                key={hit.itemId}
                className="flex items-start gap-3 border border-neutral-800 rounded p-3 hover:border-neutral-600"
              >
                <img
                  src={hit.image?.imageUrl ?? hit.thumbnailImages?.[0]?.imageUrl ?? ''}
                  alt=""
                  className="w-20 h-20 object-cover rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-neutral-200 truncate">{hit.title}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {hit.price ? `${hit.price.value} ${hit.price.currency}` : '—'} ·{' '}
                    {hit.condition ?? 'condition ?'}
                    {hit.categoryPath ? ` · ${hit.categoryPath}` : ''}
                  </div>
                  <div className="mt-2 flex gap-2">
                    {hit.itemWebUrl && (
                      <a
                        href={hit.itemWebUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-neutral-300 hover:text-neutral-100 underline"
                      >
                        Open on eBay ↗
                      </a>
                    )}
                    <button
                      onClick={() => setPicked(hit)}
                      className="text-xs px-2 py-0.5 rounded bg-neutral-100 text-neutral-900"
                    >
                      Use as identification
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {picked && (
        <ApprovalPanel
          hit={picked}
          onCancel={() => setPicked(null)}
          onConfirm={async (approvedFields) => {
            const imgUrl =
              picked.image?.imageUrl ?? picked.thumbnailImages?.[0]?.imageUrl ?? undefined;
            const { itemId } = await api.identifyGroupEbay(groupId, {
              ebayItemId: picked.itemId,
              ebayItemUrl: picked.itemWebUrl,
              hit: {
                title: picked.title,
                condition: picked.condition,
                categoryPath: picked.categoryPath,
                price: picked.price,
                imageUrls: imgUrl ? [imgUrl] : [],
              },
              approvedFields,
            });
            onIdentified(itemId);
          }}
        />
      )}
    </div>
  );
}

type ApprovedFields = {
  title: boolean;
  description: boolean;
  category: boolean;
  condition: boolean;
  itemSpecifics: boolean;
  images: boolean;
};

function ApprovalPanel({
  hit,
  onCancel,
  onConfirm,
}: {
  hit: EbayHit;
  onCancel: () => void;
  onConfirm: (approvedFields: ApprovedFields) => Promise<void> | void;
}) {
  const isNew = (hit.condition ?? '').toLowerCase().startsWith('new');
  const [fields, setFields] = useState<ApprovedFields>({
    title: true,
    description: true,
    category: true,
    condition: true,
    itemSpecifics: true,
    images: false, // default OFF per user preference
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (key: keyof ApprovedFields) =>
    setFields((prev) => ({ ...prev, [key]: !prev[key] }));

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      await onConfirm(fields);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-neutral-950/90 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-lg p-4 space-y-3">
        <h4 className="font-medium">Import from eBay listing</h4>
        <div className="text-xs text-neutral-400 line-clamp-2">{hit.title}</div>
        <div className="space-y-1.5 text-sm">
          {(
            [
              ['title', 'Title'],
              ['description', 'Description'],
              ['category', 'Category'],
              ['condition', 'Condition'],
              ['itemSpecifics', 'Item specifics'],
            ] as Array<[keyof ApprovedFields, string]>
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-neutral-200">
              <input
                type="checkbox"
                checked={fields[key]}
                onChange={() => toggle(key)}
                className="accent-blue-400"
              />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-2 text-neutral-200 pt-1 border-t border-neutral-800 mt-2">
            <input
              type="checkbox"
              checked={fields.images}
              onChange={() => toggle('images')}
              className="accent-blue-400"
            />
            Import images
            {isNew && (
              <span className="text-xs text-emerald-400 ml-auto">condition: New — stock photo OK</span>
            )}
          </label>
          {!isNew && (
            <p className="text-xs text-neutral-500 pl-6">
              Off by default — only import when the listing's photos are genuine stock photos.
            </p>
          )}
        </div>
        {err && <div className="text-sm text-red-400">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded border border-neutral-700 text-neutral-300"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded bg-neutral-100 text-neutral-900 disabled:bg-neutral-800"
          >
            {submitting ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
