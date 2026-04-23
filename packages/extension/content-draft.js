// THE draft-resume content script.
//
// This is what makes "pick up an eBay draft where you left off" work end-to-end.
// On every listing/draft page load:
//   1. Detect whether the page is a draft (URL params, page badges).
//   2. Look up linkage on the server (/drafts/by-url, /drafts/by-ebay-id).
//   3. Show a banner: linked? then [Fill missing] [Force overwrite] [Unlink].
//      Not linked? then [Link to <last Item>] / [Pick Item…].
//   4. On Fill missing: POST /drafts/:id/resume → apply only the delta fields.
//   5. On Force overwrite: GET /items/:id/autofill → apply all.
//   6. Snapshot the current form values every 30s as a heartbeat.
//   7. Watch for the "Listing created" success → mark draft SUBMITTED and
//      flip the linked Item to status=LISTED.

(async () => {
  if (window.__swiftlist_draft_loaded) return;
  window.__swiftlist_draft_loaded = true;

  const url = new URL(location.href);
  const ebayDraftId = extractDraftId(url);
  const isDraftPage = !!ebayDraftId || url.pathname.includes('/lstng') || url.searchParams.has('mode') || hasDraftBadge();
  if (!isDraftPage) return;

  let linked = await lookupLinkage(url, ebayDraftId);

  const banner = renderBanner();
  document.body.appendChild(banner.root);

  if (linked) {
    await renderLinkedState(banner, linked);
    startHeartbeat(linked.draft.id);
    watchForSubmission(linked.draft.id);
  } else {
    await renderUnlinkedState(banner, url, ebayDraftId);
  }

  // ── handlers ─────────────────────────────────────────────────────────

  async function lookupLinkage(currentUrl, draftId) {
    try {
      if (draftId) {
        return await window.swiftlist.api(`/api/v1/drafts/by-ebay-id/${encodeURIComponent(draftId)}`);
      }
      return await window.swiftlist.api(`/api/v1/drafts/by-url?url=${encodeURIComponent(currentUrl.href)}`);
    } catch (err) {
      if (/404/.test(err.message)) return null;
      throw err;
    }
  }

  async function renderLinkedState(b, link) {
    b.title.textContent = `swiftlist · ${link.item.title || '(untitled item)'}`;
    b.subtitle.textContent = `Linked to draft ${link.draft.ebayDraftId || '(URL match)'}`;
    b.actions.innerHTML = '';
    b.actions.appendChild(button('Fill missing', async (btn) => {
      btn.disabled = true;
      btn.textContent = 'Filling…';
      try {
        // Snapshot current values so the server's delta math is accurate.
        const currentValues = snapshotForm();
        await window.swiftlist.api(`/api/v1/drafts/${link.draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ currentValues }),
        });
        const delta = await window.swiftlist.api(`/api/v1/drafts/${link.draft.id}/resume`, {
          method: 'POST',
          body: '{}',
        });
        const filled = (await window.swiftlist.fillForm(delta, { mode: 'delta' })) || [];
        await window.swiftlist.api(`/api/v1/drafts/${link.draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ lastFilledFields: filled }),
        });
        btn.textContent = `Filled ${filled.length} fields`;
      } catch (err) {
        btn.textContent = `Failed: ${err.message}`;
      }
    }));
    b.actions.appendChild(button('Force overwrite', async (btn) => {
      btn.disabled = true;
      btn.textContent = 'Overwriting…';
      try {
        const payload = await window.swiftlist.api(`/api/v1/items/${link.item.id}/autofill`);
        const filled = (await window.swiftlist.fillForm(payload, { mode: 'full' })) || [];
        await window.swiftlist.api(`/api/v1/drafts/${link.draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ lastFilledFields: filled }),
        });
        btn.textContent = `Filled ${filled.length} fields`;
      } catch (err) {
        btn.textContent = `Failed: ${err.message}`;
      }
    }));
    b.actions.appendChild(button('Unlink', async (btn) => {
      // For now, "unlink" means abandoning the draft on the server side.
      try {
        await window.swiftlist.api(`/api/v1/drafts/${link.draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'ABANDONED' }),
        });
        btn.textContent = 'Unlinked';
      } catch (err) {
        btn.textContent = `Failed: ${err.message}`;
      }
    }));
  }

  async function renderUnlinkedState(b, currentUrl, draftId) {
    const { lastSwiftlistItemId } = await window.swiftlist.settings();
    b.title.textContent = 'swiftlist · draft not linked';
    b.subtitle.textContent = lastSwiftlistItemId
      ? `Last Item: ${lastSwiftlistItemId.slice(-8)}`
      : 'No recent Item — visit the swiftlist popup first.';
    b.actions.innerHTML = '';
    if (lastSwiftlistItemId) {
      b.actions.appendChild(button('Link to last Item', async (btn) => {
        btn.disabled = true;
        try {
          const currentValues = snapshotForm();
          const draft = await window.swiftlist.api(
            `/api/v1/items/${lastSwiftlistItemId}/drafts`,
            {
              method: 'POST',
              body: JSON.stringify({ ebayDraftId: draftId, ebayDraftUrl: currentUrl.href, currentValues }),
            },
          );
          await renderLinkedState(b, { draft, item: { id: lastSwiftlistItemId, title: '' }, autofill: null });
        } catch (err) {
          btn.textContent = `Failed: ${err.message}`;
        }
      }));
    }
    b.actions.appendChild(button('Pick Item…', async () => {
      const id = window.prompt('swiftlist Item ID to link:');
      if (!id) return;
      await window.swiftlist.setLastItem(id);
      const currentValues = snapshotForm();
      const draft = await window.swiftlist.api(
        `/api/v1/items/${id}/drafts`,
        {
          method: 'POST',
          body: JSON.stringify({ ebayDraftId: draftId, ebayDraftUrl: currentUrl.href, currentValues }),
        },
      );
      await renderLinkedState(b, { draft, item: { id, title: '' }, autofill: null });
    }));
  }
})();

// ── Helpers ─────────────────────────────────────────────────────────────

function extractDraftId(url) {
  return (
    url.searchParams.get('draftId') ||
    url.searchParams.get('lstngId') ||
    (url.pathname.match(/lstng\/(\d+)/) || [])[1] ||
    null
  );
}

function hasDraftBadge() {
  // Heuristic: many eBay flows show a "Saved draft" / "Continue draft" UI.
  return /saved\s+draft|continue\s+draft|draft\s+saved/i.test(document.body.textContent || '');
}

function snapshotForm() {
  // Captures the live values for fields we know about. Used for both the
  // resume delta math and the heartbeat.
  return {
    title: getValue(['[data-testid="title-input"]', '[name="title"]', 'input[aria-label*="Title" i]']),
    category: { id: getValue(['[data-testid="category-id-input"]', 'input[name="categoryId"]']) },
    condition: { label: getDropdownLabel(['[data-testid="condition-dropdown"]', 'select[name="conditionId"]']) },
    description: { html: readDescriptionHtml() },
    pricing: {
      buyNowPrice: numeric(getValue(['[name="binPrice"]', '[data-testid="buy-now-price"]'])),
      startingPrice: numeric(getValue(['[name="startPrice"]', '[data-testid="starting-price"]'])),
    },
    shipping: {
      weightOz: numeric(getValue(['[name="weightOz"]'])),
      postalCode: getValue(['[name="postalCode"]', '[data-testid="postal-code"]']),
    },
  };
}

function getValue(selectors) {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el && 'value' in el) return el.value || undefined;
  }
  return undefined;
}

function getDropdownLabel(selectors) {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (!el) continue;
    if (el.tagName === 'SELECT' && el.selectedIndex >= 0) {
      return el.options[el.selectedIndex]?.text?.trim() || undefined;
    }
    return el.textContent?.trim() || undefined;
  }
  return undefined;
}

function readDescriptionHtml() {
  const iframe = document.querySelector('iframe[title*="description" i], iframe#description_ifr');
  try {
    if (iframe?.contentDocument) return iframe.contentDocument.body.innerHTML;
  } catch {}
  const ta = document.querySelector('textarea[name="description"]');
  return ta?.value || undefined;
}

function numeric(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function startHeartbeat(draftId) {
  setInterval(async () => {
    try {
      await window.swiftlist.api(`/api/v1/drafts/${draftId}`, {
        method: 'PATCH',
        body: JSON.stringify({ currentValues: snapshotForm() }),
      });
    } catch (err) {
      console.warn('[swiftlist] heartbeat failed', err);
    }
  }, 30_000);
}

function watchForSubmission(draftId) {
  // If the URL transitions to /itm/<id>, we successfully published.
  const observer = new MutationObserver(async () => {
    const m = location.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{8,})/);
    if (!m) return;
    observer.disconnect();
    try {
      await window.swiftlist.api(`/api/v1/drafts/${draftId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'SUBMITTED', ebayItemId: m[1] }),
      });
    } catch (err) {
      console.warn('[swiftlist] submission report failed', err);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function renderBanner() {
  const root = document.createElement('div');
  root.id = '__swiftlist_draft_banner';
  root.style.cssText =
    'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#181818;color:#eee;border:1px solid #444;border-radius:8px;padding:10px 14px;z-index:99999;font:13px -apple-system,system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,0.4);min-width:420px;';
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;';
  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'color:#888;font-size:11px;margin-top:2px;';
  const actions = document.createElement('div');
  actions.style.cssText = 'margin-top:8px;display:flex;gap:6px;';
  root.appendChild(title);
  root.appendChild(subtitle);
  root.appendChild(actions);
  return { root, title, subtitle, actions };
}

function button(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText =
    'padding:6px 10px;background:#0064d2;color:#fff;border:0;border-radius:4px;cursor:pointer;font-size:12px;';
  b.addEventListener('click', () => onClick(b));
  return b;
}
