import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type GroupRow, type ItemRow } from '../api/client.js';

type Tab = 'unidentified' | 'in-process' | 'draft' | 'listed' | 'sold';

const TABS: Array<{ key: Tab; label: string; status?: string }> = [
  { key: 'unidentified', label: 'Unidentified' },
  { key: 'in-process', label: 'In-process', status: 'IN_PROCESS' },
  { key: 'draft', label: 'Drafts', status: 'DRAFT' },
  { key: 'listed', label: 'Listed', status: 'LISTED' },
  { key: 'sold', label: 'Sold', status: 'SOLD' },
];

function resolveCover(
  p: { thumbnailPath: string | null; publicUrl: string | null; cdnUrl: string | null; id: string } | null,
): string | null {
  if (!p) return null;
  if (p.cdnUrl) return p.cdnUrl;
  if (p.publicUrl) return p.publicUrl;
  return `/api/v1/items/photo/${p.id}/thumb`;
}

export function ItemsPage() {
  const [tab, setTab] = useState<Tab>('unidentified');
  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-2xl">Items</h2>
      </div>
      <div className="flex gap-1 border-b border-neutral-800 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${
              tab === t.key
                ? 'border-neutral-200 text-neutral-100'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'unidentified' ? (
        <UnidentifiedGrid />
      ) : (
        <ItemsGrid status={activeTab.status!} />
      )}
    </div>
  );
}

function UnidentifiedGrid() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['groups', 'unidentified'],
    queryFn: () => api.listGroups(true),
  });

  if (isLoading) return <div className="text-neutral-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>;

  const groups = data?.groups ?? [];
  if (groups.length === 0) {
    return (
      <div className="text-neutral-500">
        No unidentified groups. Select photos from the Pool and click “Group” to create one.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {groups.map((g) => (
        <GroupCard key={g.id} group={g} />
      ))}
    </div>
  );
}

function GroupCard({ group }: { group: GroupRow }) {
  const src = resolveCover(group.coverPhoto);
  return (
    <Link
      to={`/groups/${group.id}`}
      className="border border-neutral-800 rounded overflow-hidden bg-neutral-950 hover:border-neutral-600 block"
    >
      <div className="aspect-square bg-neutral-900 flex items-center justify-center relative">
        {src ? (
          <img src={src} alt={group.label ?? ''} loading="lazy" className="w-full h-full object-cover opacity-90" />
        ) : (
          <div className="text-neutral-600 text-xs">empty</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-2 flex items-center justify-between text-xs">
          <span className="text-neutral-100 truncate">📁 {group.label ?? '(unnamed)'}</span>
          <span className="text-neutral-300 ml-2">{group.photoCount}</span>
        </div>
      </div>
    </Link>
  );
}

function ItemsGrid({ status }: { status: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['items', status],
    queryFn: () => api.listItems({ status }),
  });

  if (isLoading) return <div className="text-neutral-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>;

  const items = data?.items ?? [];
  if (items.length === 0) {
    return <div className="text-neutral-500">No items in this state yet.</div>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function ItemCard({ item }: { item: ItemRow }) {
  return (
    <Link
      to={`/items/${item.id}`}
      className="border border-neutral-800 rounded p-4 hover:border-neutral-600 block"
    >
      <div className="font-medium truncate">{item.title ?? '(untitled)'}</div>
      <div className="text-xs text-neutral-500 mt-1">
        {item.stage} · {item._count.photos} photos · {item.completeness?.score ?? 0}% complete
      </div>
    </Link>
  );
}
