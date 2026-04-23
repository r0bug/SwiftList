// Popup: connection status, navigation to the web UI, inline config panel,
// and the "items needing sold comps" quick actions.

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const statusDot = statusEl.querySelector('.dot');
const needsEl = document.getElementById('needs-comps');
const needsSection = document.getElementById('needs-comps-section');
const configForm = document.getElementById('config');
const configMsg = document.getElementById('config-msg');
const toggleConfig = document.getElementById('toggle-config');

function setStatus(kind, text) {
  statusEl.className = `status ${kind}`;
  statusDot.className = `dot ${kind}`;
  statusText.textContent = text;
}

// ── Nav ────────────────────────────────────────────────────────────
document.querySelectorAll('nav button[data-path]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const { webUrl } = await window.swiftlist.settings();
    const path = btn.getAttribute('data-path');
    if (!webUrl) {
      setStatus('err', 'Web UI URL not set — open Config.');
      return;
    }
    chrome.tabs.create({ url: `${webUrl}${path}` });
  });
});

// ── Config panel toggle + persistence ──────────────────────────────
toggleConfig.addEventListener('click', async () => {
  await fillConfigForm();
  configForm.classList.toggle('visible');
  configMsg.textContent = '';
});

async function fillConfigForm() {
  const s = await window.swiftlist.settings();
  document.getElementById('baseUrl').value = s.baseUrl;
  document.getElementById('apiKey').value = s.apiKey;
  document.getElementById('webUrl').value = s.webUrl;
}

configForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const apiKey = document.getElementById('apiKey').value.trim();
  const baseUrl = document.getElementById('baseUrl').value.trim().replace(/\/$/, '');
  const webUrl = document.getElementById('webUrl').value.trim().replace(/\/$/, '');
  await chrome.storage.sync.set({ apiKey, baseUrl, webUrl });
  configMsg.textContent = 'Saved. Testing…';
  configMsg.className = 'msg';
  try {
    await window.swiftlist.ping();
    configMsg.textContent = 'Connected.';
    configMsg.className = 'msg status ok';
    await refreshAll();
  } catch (err) {
    configMsg.textContent = `Fail: ${err.message}`;
    configMsg.className = 'msg status err';
  }
});

document.getElementById('reset-defaults').addEventListener('click', async () => {
  const def = window.swiftlist.bundledDefaults();
  document.getElementById('baseUrl').value = def.baseUrl;
  document.getElementById('apiKey').value = def.apiKey;
  document.getElementById('webUrl').value = def.webUrl;
});

// ── Items needing sold comps ───────────────────────────────────────
async function loadNeedsComps() {
  needsEl.className = '';
  try {
    const data = await window.swiftlist.api('/api/v1/extension/identify-search', {
      method: 'POST',
      body: '{}',
    });
    if (!data.items || data.items.length === 0) {
      needsEl.className = 'empty';
      needsEl.textContent = 'All caught up.';
      return;
    }
    needsEl.innerHTML = '';
    for (const it of data.items) {
      const row = document.createElement('div');
      row.className = 'row';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = it.title || '(untitled)';
      t.title = it.title || '';
      const btn = document.createElement('button');
      btn.textContent = 'Find sold →';
      btn.addEventListener('click', async () => {
        await window.swiftlist.setLastItem(it.id);
        const url = `${it.soldSearchUrl}&swiftlistItemId=${it.id}`;
        chrome.tabs.create({ url });
      });
      row.appendChild(t);
      row.appendChild(btn);
      needsEl.appendChild(row);
    }
  } catch (err) {
    needsEl.className = 'empty';
    needsEl.textContent = `Error: ${err.message}`;
  }
}

// ── Boot ───────────────────────────────────────────────────────────
async function refreshAll() {
  const { apiKey, baseUrl } = await window.swiftlist.settings();
  if (!apiKey) {
    setStatus('warn', 'Not configured');
    configForm.classList.add('visible');
    await fillConfigForm();
    needsSection.style.display = 'none';
    return;
  }
  try {
    await window.swiftlist.ping();
    setStatus('ok', new URL(baseUrl).host);
    needsSection.style.display = '';
    await loadNeedsComps();
  } catch (err) {
    setStatus('err', `Can't reach ${baseUrl}`);
    configForm.classList.add('visible');
    await fillConfigForm();
    needsSection.style.display = 'none';
  }
}

refreshAll();
