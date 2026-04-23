// Runs on https://www.ebay.com/sch/*. Adds an "Associate with swiftlist Item"
// button to each search result tile. If the URL has ?swiftlistItemId=…, all
// associate-actions are pre-bound to that Item. Adapted from comptool's
// extension/content-sold.js.

(async () => {
  const url = new URL(location.href);
  const preboundItemId = url.searchParams.get('swiftlistItemId');

  // Wait for results to render.
  const cards = await waitFor(() => document.querySelectorAll('.s-item, .s-card'));
  if (!cards || cards.length === 0) return;

  for (const card of cards) {
    if (card.querySelector('.swiftlist-associate')) continue;
    const linkEl = card.querySelector('a[href*="/itm/"]');
    if (!linkEl) continue;
    const itemUrl = linkEl.href;
    const ebayItemId = (itemUrl.match(/\/itm\/(?:[^/]+\/)?(\d{8,})/) || [])[1];
    if (!ebayItemId) continue;

    const btn = document.createElement('button');
    btn.className = 'swiftlist-associate';
    btn.textContent = preboundItemId ? '+ Associate' : '+ swiftlist';
    btn.style.cssText =
      'margin-top:6px;padding:4px 8px;background:#0064d2;color:#fff;border:0;border-radius:3px;cursor:pointer;font-size:11px;';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const itemId = preboundItemId || (await pickItemId());
        if (!itemId) return;
        const title = (card.querySelector('.s-item__title, .s-card__title')?.textContent || '').trim();
        const priceText = (card.querySelector('.s-item__price, .s-card__price')?.textContent || '').trim();
        const soldPrice = parsePrice(priceText);
        const soldDateText = (card.querySelector('.s-item__title--tag, .s-item__caption')?.textContent || '').trim();
        const imageUrl = card.querySelector('img')?.src;
        await window.swiftlist.api(`/api/v1/items/${itemId}/sold-comp-link`, {
          method: 'POST',
          body: JSON.stringify({
            ebayItemId,
            title,
            soldPrice,
            soldDate: soldDateText.match(/(\w{3}\s+\d{1,2},\s+\d{4})/)?.[1]
              ? new Date(soldDateText.match(/(\w{3}\s+\d{1,2},\s+\d{4})/)[1]).toISOString()
              : undefined,
            imageUrls: imageUrl ? [imageUrl] : [],
          }),
        });
        btn.textContent = '✓ Associated';
        btn.disabled = true;
      } catch (err) {
        btn.textContent = `Failed: ${err.message}`;
      }
    });

    const insertAfter = card.querySelector('.s-item__price, .s-card__price') ?? card.firstElementChild;
    insertAfter?.parentElement?.insertBefore(btn, insertAfter.nextSibling);
  }
})();

function waitFor(fn, timeout = 10_000) {
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

function parsePrice(s) {
  const m = s.replace(/,/g, '').match(/[\d.]+/);
  return m ? Number(m[0]) : undefined;
}

async function pickItemId() {
  const id = window.prompt('swiftlist Item ID (we will improve this UI):');
  if (id) await window.swiftlist.setLastItem(id);
  return id || null;
}
