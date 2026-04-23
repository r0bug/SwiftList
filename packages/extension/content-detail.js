// Runs on https://www.ebay.com/itm/*. Injects a "Pull into swiftlist" button.
// If the URL carries ?swiftlistItemId=…, auto-runs once the page settles.

(async () => {
  const url = new URL(location.href);
  const preboundItemId = url.searchParams.get('swiftlistItemId');
  const ebayItemId = (location.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{8,})/) || [])[1];
  if (!ebayItemId) return;

  // Floating button
  const btn = document.createElement('button');
  btn.textContent = preboundItemId ? '↧ Auto-pulling…' : '↧ Pull into swiftlist';
  btn.style.cssText =
    'position:fixed;bottom:24px;right:24px;padding:10px 14px;background:#0064d2;color:#fff;border:0;border-radius:6px;cursor:pointer;z-index:99999;font:600 13px -apple-system, system-ui, sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
  btn.addEventListener('click', () => pull());
  document.body.appendChild(btn);

  if (preboundItemId) setTimeout(() => pull(), 2_000);

  async function pull() {
    btn.disabled = true;
    btn.textContent = '↧ Pulling…';
    try {
      const itemId = preboundItemId || (await pickItemId());
      if (!itemId) return;
      const payload = scrape(ebayItemId);
      await window.swiftlist.api(`/api/v1/items/${itemId}/sold-comp-link`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      btn.textContent = '✓ Pulled';
    } catch (err) {
      btn.textContent = `Failed: ${err.message}`;
      window.swiftlist.telemetry({ where: 'content-detail.pull', err: err.message, url: location.href });
    } finally {
      btn.disabled = false;
    }
  }
})();

function scrape(ebayItemId) {
  const title = textOf('h1.x-item-title__mainTitle, h1.it-ttl');
  const price = parsePrice(textOf('.x-price-primary, span#prcIsum'));
  const breadcrumbs = [...document.querySelectorAll('.seo-breadcrumb-text, .breadcrumb a')]
    .map((e) => e.textContent.trim())
    .filter(Boolean);
  const categoryPath = breadcrumbs.join(' > ');

  const specifics = {};
  const specRows = document.querySelectorAll(
    '.ux-layout-section-evo--features dl, .itemAttr table tr, .ux-layout-section__item--table-view dl',
  );
  for (const row of specRows) {
    const dt = row.querySelector('dt, td:nth-child(1)');
    const dd = row.querySelector('dd, td:nth-child(2)');
    if (dt && dd) {
      const k = dt.textContent.trim().replace(/\s+/g, ' ');
      const v = dd.textContent.trim().replace(/\s+/g, ' ');
      if (k && v) specifics[k] = v;
    }
  }

  const condition = specifics['Condition'] || textOf('.x-item-condition-text, [data-testid="x-item-condition"]') || undefined;

  let descHtml = '';
  const descIframe = document.querySelector('iframe#desc_ifr');
  try {
    if (descIframe?.contentDocument) {
      descHtml = descIframe.contentDocument.body.innerHTML;
    }
  } catch {
    // cross-origin, skip
  }

  const imageUrls = [...document.querySelectorAll('img.ux-image-carousel-item, img.img-zoom, img#icImg')]
    .map((img) => img.src)
    .filter(Boolean);

  const sellerName = textOf('.x-sellercard-atf__info__about-seller, span.mbg-nw');

  return {
    ebayItemId,
    title,
    soldPrice: price,
    categoryPath,
    condition,
    description: descHtml,
    itemSpecifics: specifics,
    imageUrls: [...new Set(imageUrls)],
    sellerName,
  };
}

function textOf(sel) {
  const el = document.querySelector(sel);
  return el ? el.textContent.trim() : '';
}

function parsePrice(s) {
  const m = (s || '').replace(/,/g, '').match(/[\d.]+/);
  return m ? Number(m[0]) : undefined;
}

async function pickItemId() {
  const id = window.prompt('swiftlist Item ID:');
  if (id) await window.swiftlist.setLastItem(id);
  return id || null;
}
