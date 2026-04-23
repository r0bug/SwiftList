import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export function ItemsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['items'], queryFn: () => api.listItems() });

  if (isLoading) return <div className="text-neutral-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>;

  return (
    <div>
      <h2 className="text-2xl mb-4">Items</h2>
      {data?.items.length === 0 ? (
        <div className="text-neutral-500">
          No items yet. Drop photos into your watch folder to start ingesting.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data?.items.map((item) => (
            <Link
              key={item.id}
              to={`/items/${item.id}`}
              className="border border-neutral-800 rounded p-4 hover:border-neutral-600 block"
            >
              <div className="font-medium">{item.title ?? '(untitled)'}</div>
              <div className="text-xs text-neutral-500 mt-1">
                {item.stage} · {item._count.photos} photos · {item.completeness?.score ?? 0}% complete
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
