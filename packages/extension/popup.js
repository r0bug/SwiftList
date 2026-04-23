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
async function openWebPath(p) {
  const { webUrl } = await window.swiftlist.settings();
  if (!webUrl) {
    setStatus('err', 'Web UI URL not set — open Config.');
    return;
  }
  chrome.tabs.create({ url: `${webUrl}${p}` });
}

document.querySelectorAll('nav button[data-path]').forEach((btn) => {
  btn.addEventListener('click', () => openWebPath(btn.getAttribute('data-path')));
});

document.getElementById('open-webui').addEventListener('click', (e) => {
  e.preventDefault();
  openWebPath('/');
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

// ── Scan inbox + progress polling ──────────────────────────────────
const scanBtn = document.getElementById('scan-btn');
const scanFolder = document.getElementById('scan-folder');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

let pollHandle = null;
let pollSession = null; // { startProcessed, startAiCalls, startErrors }

async function refreshScanFolder() {
  try {
    const data = await window.swiftlist.api('/api/v1/ingest/status');
    scanFolder.textContent = data.watchFolder || '';
    scanFolder.title = data.watchFolder || '';
    return data.status;
  } catch {
    scanFolder.textContent = '';
    return null;
  }
}

function fmtCost(n) {
  if (!n || n <= 0) return '';
  return ` · $${n.toFixed(3)}`;
}

function renderProgress(status, scanInfo) {
  if (!status) {
    progressWrap.classList.remove('visible');
    return;
  }
  const { pending, processing, totalProcessed, totalErrors, totalAiCalls, totalAiCostUsd } = status;
  const sessionProcessed = totalProcessed - (pollSession?.startProcessed ?? 0);
  const sessionAi = totalAiCalls - (pollSession?.startAiCalls ?? 0);
  const sessionErrors = totalErrors - (pollSession?.startErrors ?? 0);
  const queuedInRun = scanInfo?.enqueued ?? 0;
  const target = Math.max(queuedInRun, sessionProcessed + pending + processing);
  const pct = target > 0 ? Math.min(100, Math.round((sessionProcessed / target) * 100)) : 0;

  progressWrap.classList.add('visible');
  progressFill.style.width = `${pct}%`;

  const active = pending + processing > 0;
  const statusLabel = active
    ? `Recognizing ${sessionProcessed}/${target}${fmtCost(totalAiCostUsd)}`
    : `<span class="ok">Done — ${sessionProcessed} processed${fmtCost(totalAiCostUsd)}</span>`;
  const extra = [];
  if (sessionAi > 0) extra.push(`${sessionAi} AI call${sessionAi === 1 ? '' : 's'}`);
  if (sessionErrors > 0) extra.push(`<span class="err">${sessionErrors} error${sessionErrors === 1 ? '' : 's'}</span>`);
  progressText.innerHTML = statusLabel + (extra.length ? ` · ${extra.join(' · ')}` : '');

  if (!active && pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

async function startScan() {
  scanBtn.disabled = true;
  scanBtn.textContent = 'Scanning…';
  progressText.innerHTML = 'Enqueuing files…';
  progressWrap.classList.add('visible');
  progressFill.style.width = '5%';

  let scanInfo = null;
  try {
    // Snapshot current counters so the bar reflects THIS run only.
    const pre = await window.swiftlist.api('/api/v1/ingest/status');
    pollSession = {
      startProcessed: pre.status.totalProcessed,
      startAiCalls: pre.status.totalAiCalls,
      startErrors: pre.status.totalErrors,
    };
    scanInfo = await window.swiftlist.api('/api/v1/ingest/scan', { method: 'POST', body: '{}' });
    if (scanInfo.truncated) {
      progressText.innerHTML = `<span class="err">Truncated at ${scanInfo.enqueued} files (limit reached).</span>`;
    }
  } catch (err) {
    progressText.innerHTML = `<span class="err">Scan failed: ${err.message}</span>`;
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan inbox';
    return;
  }

  if (scanInfo.enqueued === 0) {
    progressText.innerHTML = `<span class="ok">Nothing new — ${scanInfo.scanned} file${scanInfo.scanned === 1 ? '' : 's'} already known.</span>`;
    progressFill.style.width = '100%';
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan inbox';
    return;
  }

  scanBtn.textContent = 'Scanning…';
  renderProgress(scanInfo.status, scanInfo);
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(async () => {
    try {
      const data = await window.swiftlist.api('/api/v1/ingest/status');
      renderProgress(data.status, scanInfo);
      const active = data.status.pending + data.status.processing > 0;
      if (!active) {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan inbox';
      }
    } catch (err) {
      progressText.innerHTML = `<span class="err">Poll failed: ${err.message}</span>`;
      clearInterval(pollHandle);
      pollHandle = null;
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan inbox';
    }
  }, 2000);
}

scanBtn.addEventListener('click', startScan);

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
    await refreshScanFolder();
    await loadNeedsComps();
  } catch (err) {
    setStatus('err', `Can't reach ${baseUrl}`);
    configForm.classList.add('visible');
    await fillConfigForm();
    needsSection.style.display = 'none';
  }
}

refreshAll();
