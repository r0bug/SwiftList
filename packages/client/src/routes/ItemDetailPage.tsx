import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

export function ItemDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['item', id],
    queryFn: () => api.getItem(id!),
    enabled: !!id,
  });

  if (isLoading) return <div className="text-neutral-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl">{data.title ?? '(untitled)'}</h2>
        <div className="text-xs text-neutral-500 mt-1">
          {data.stage} · {data.status} · completeness {data.completeness?.score ?? 0}%
        </div>
      </div>

      <section>
        <h3 className="text-sm uppercase text-neutral-500 mb-2">Photos</h3>
        <div className="grid grid-cols-4 gap-2">
          {data.photos.map((p) => (
            <img
              key={p.id}
              src={p.publicUrl ?? `/uploads/${p.thumbnailPath}`}
              alt=""
              className="rounded border border-neutral-800"
            />
          ))}
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
    </div>
  );
}
