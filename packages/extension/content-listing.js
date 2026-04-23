// Runs on the eBay listing-creation flow. Reads ?swiftlistItemId=… (or the
// last-stored Item ID), fetches /api/v1/items/:id/autofill, and writes form
// fields. Selector strategy: data-testid → aria-label → name → label
// proximity. All fills are wrapped in try/catch and emit telemetry on failure.
//
// content-draft.js handles the draft-specific behavior (link banner, delta
// fill, force overwrite, submission tracking, heartbeat). This file owns the
// raw "fill these field values into the live form" actions, which both new
// listings AND draft fills use.

(async () => {
  if (window.__swiftlist_listing_loaded) return;
  window.__swiftlist_listing_loaded = true;

  // Expose the field-filler so content-draft.js can call it with either a
  // full autofill payload or a delta payload.
  window.swiftlist.fillForm = fillForm;

  // If the URL carries ?swiftlistItemId, auto-fill on first load (new listing
  // case). Draft pages let content-draft.js drive fills instead.
  const url = new URL(location.href);
  const itemId = url.searchParams.get('swiftlistItemId');
  if (itemId && !looksLikeDraft(url)) {
    await window.swiftlist.setLastItem(itemId);
    try {
      const payload = await window.swiftlist.api(`/api/v1/items/${itemId}/autofill`);
      const filled = await fillForm(payload, { mode: 'full' });
      console.log('[swiftlist] auto-filled fields:', filled);
    } catch (err) {
      window.swiftlist.telemetry({ where: 'content-listing.autofill', err: err.message });
    }
  }
})();

function looksLikeDraft(url) {
  return url.searchParams.has('draftId') || url.pathname.includes('/lstng');
}

// fillForm walks the payload and writes each present field into the form.
// Returns the list of fields successfully filled (used by content-draft.js
// to update lastFilledFields on the server).
async function fillForm(payload, opts = {}) {
  const filled = [];

  if (payload.title) safe(() => fillTitle(payload.title), 'title', filled);
  if (payload.condition?.label) safe(() => fillCondition(payload.condition), 'condition', filled);
  if (payload.category?.id) safe(() => fillCategory(payload.category), 'category', filled);
  if (payload.itemSpecifics) safe(() => fillSpecifics(payload.itemSpecifics), 'itemSpecifics', filled);
  if (payload.description?.html) safe(() => fillDescription(payload.description.html), 'description', filled);
  if (payload.pricing?.buyNowPrice) safe(() => setInput(['[name="binPrice"]', '[data-testid="buy-now-price"]'], payload.pricing.buyNowPrice), 'pricing.buyNowPrice', filled);
  if (payload.pricing?.startingPrice) safe(() => setInput(['[name="startPrice"]', '[data-testid="starting-price"]'], payload.pricing.startingPrice), 'pricing.startingPrice', filled);
  if (payload.shipping?.weightOz) safe(() => setInput(['[name="weightOz"]', '[data-testid="weight-oz"]'], payload.shipping.weightOz), 'shipping.weightOz', filled);
  if (payload.shipping?.postalCode) safe(() => setInput(['[name="postalCode"]', '[data-testid="postal-code"]'], payload.shipping.postalCode), 'shipping.postalCode', filled);

  if (payload.photos?.length) {
    safe(() => sidePanelPhotoUrls(payload.photos), 'photos', filled);
  }

  return filled;

  function safe(fn, name, list) {
    try {
      const ok = fn();
      if (ok !== false) list.push(name);
    } catch (err) {
      window.swiftlist.telemetry({ where: 'content-listing.fill', field: name, err: err.message });
    }
  }
}

// ── Field fillers ──────────────────────────────────────────────────────

function fillTitle(title) {
  const el = pick(['[data-testid="title-input"]', '[name="title"]', 'input[aria-label*="Title" i]']);
  if (!el) return false;
  setReactValue(el, title.slice(0, 80));
}

function fillCondition({ label }) {
  const el = pick(['[data-testid="condition-dropdown"]', 'select[name="conditionId"]', '[aria-label*="Condition" i]']);
  if (!el) return false;
  if (el.tagName === 'SELECT') {
    for (const opt of el.options) {
      if (opt.text.trim().toLowerCase() === label.toLowerCase()) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  } else {
    el.click();
    setTimeout(() => {
      const option = [...document.querySelectorAll('[role="option"], li')].find(
        (e) => e.textContent.trim().toLowerCase() === label.toLowerCase(),
      );
      option?.click();
    }, 100);
  }
}

function fillCategory({ id }) {
  const el = pick(['[data-testid="category-id-input"]', 'input[name="categoryId"]', 'input[aria-label*="Category" i]']);
  if (!el) return false;
  setReactValue(el, id);
}

function fillSpecifics(specifics) {
  for (const { name, values } of specifics) {
    const v = values.join(', ');
    const el = pick([`[aria-label="${cssEscape(name)}"]`, `[data-testid="spec-${cssEscape(name)}"]`, `input[name="spec_${cssEscape(name)}"]`]);
    if (el) setReactValue(el, v);
  }
}

function fillDescription(html) {
  // eBay's description editor is a sandboxed iframe. Best-effort.
  const iframe = document.querySelector('iframe[title*="description" i], iframe#description_ifr');
  if (iframe?.contentDocument) {
    iframe.contentDocument.body.innerHTML = html;
    iframe.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  // Plain textarea fallback (some flows expose this).
  const ta = pick(['textarea[name="description"]', 'textarea[aria-label*="description" i]']);
  if (ta) setReactValue(ta, stripHtml(html));
}

function sidePanelPhotoUrls(photos) {
  // Photo upload via JS into eBay's gallery is fragile across variants; show
  // a side panel with copyable URLs the user can drag into eBay's "add by URL"
  // dialog (when offered) or paste into the picture URL field.
  const id = '__swiftlist_photo_panel';
  document.getElementById(id)?.remove();
  const panel = document.createElement('div');
  panel.id = id;
  panel.style.cssText =
    'position:fixed;top:80px;right:24px;width:280px;max-height:60vh;overflow:auto;background:#181818;color:#eee;border:1px solid #444;border-radius:6px;padding:12px;z-index:99999;font:12px -apple-system,system-ui,sans-serif;';
  panel.innerHTML = `<div style="font-weight:600;margin-bottom:6px;">swiftlist photos (${photos.length})</div><div style="color:#888;font-size:11px;margin-bottom:8px;">eBay's photo flow varies. Copy these URLs into the "Add from URL" dialog, or drag images into the gallery.</div>`;
  for (const p of photos) {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:6px;';
    row.innerHTML = `<a href="${p.url}" target="_blank" style="color:#6af;word-break:break-all;font-size:11px;">${escapeHtml(p.url)}</a>`;
    panel.appendChild(row);
  }
  document.body.appendChild(panel);
}

// ── Selector + React-input helpers ─────────────────────────────────────

function pick(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function setInput(selectors, value) {
  const el = pick(selectors);
  if (!el) return false;
  setReactValue(el, value);
}

// React-controlled inputs need both the native value setter AND a 'change' event.
function setReactValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function cssEscape(s) {
  if (window.CSS?.escape) return window.CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
