// Annotates rows on https://www.ebay.com/sh/lst/drafts*. For each draft row,
// looks up linkage on the server and injects a green "swiftlist · <Item>" badge
// when linked, or a grey "Link to swiftlist Item" button when not.

(async () => {
  const rows = await waitFor(
    () => document.querySelectorAll('[data-testid="draft-row"], tr[data-test-draft-id], tr.draft-row'),
    8_000,
  );
  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    if (row.querySelector('.swiftlist-badge')) continue;
    const link = row.querySelector('a[href*="/lstng"], a[href*="draftId"]');
    if (!link) continue;
    const url = link.href;
    try {
      const data = await window.swiftlist.api(`/api/v1/drafts/by-url?url=${encodeURIComponent(url)}`);
      injectBadge(row, true, data.item?.title || '(linked)');
    } catch (err) {
      if (/404/.test(err.message)) {
        injectBadge(row, false);
      } else {
        console.warn('[swiftlist] drafts-list lookup failed', err);
      }
    }
  }
})();

function injectBadge(row, isLinked, title) {
  const span = document.createElement('span');
  span.className = 'swiftlist-badge';
  span.style.cssText = `display:inline-block;margin-left:8px;padding:2px 6px;border-radius:3px;font-size:11px;${isLinked ? 'background:#1a4d1a;color:#9f9;' : 'background:#333;color:#aaa;'}`;
  span.textContent = isLinked ? `swiftlist · ${title.slice(0, 30)}` : 'not in swiftlist';
  const target = row.querySelector('td:first-child, [data-testid="draft-title"]') ?? row.firstElementChild;
  target?.appendChild(span);
}

function waitFor(fn, timeout = 5_000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const v = fn();
      if (v && (!v.length || v.length > 0)) return resolve(v);
      if (Date.now() - t0 > timeout) return resolve(null);
      setTimeout(tick, 200);
    };
    tick();
  });
}
