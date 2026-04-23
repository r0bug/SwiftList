// Shared fetch wrapper for all content scripts + popup/options. Reads
// {baseUrl, apiKey, webUrl} from chrome.storage.sync, falling back to
// window.__swiftlist_defaults (set by defaults.js, written at install time),
// then to localhost fallbacks.

(function () {
  if (window.__swiftlist_api_loaded) return;
  window.__swiftlist_api_loaded = true;

  const HARDCODED = {
    baseUrl: 'http://localhost:3004',
    apiKey: '',
    webUrl: 'http://localhost:5173',
  };

  function bundledDefaults() {
    return Object.assign({}, HARDCODED, window.__swiftlist_defaults || {});
  }

  async function settings() {
    const sync = await chrome.storage.sync.get(['apiKey', 'baseUrl', 'webUrl']);
    const local = await chrome.storage.local.get(['machineId', 'lastSwiftlistItemId']);
    const def = bundledDefaults();
    return {
      apiKey: sync.apiKey || def.apiKey || '',
      baseUrl: ((sync.baseUrl || def.baseUrl || '').replace(/\/$/, '')),
      webUrl: ((sync.webUrl || def.webUrl || '').replace(/\/$/, '')),
      machineId: local.machineId || '',
      lastSwiftlistItemId: local.lastSwiftlistItemId || '',
    };
  }

  async function api(path, opts = {}) {
    const { apiKey, baseUrl, machineId } = await settings();
    if (!apiKey) throw new Error('No swiftlist API key set — open extension popup.');
    const headers = Object.assign(
      { 'Content-Type': 'application/json', 'X-Api-Key': apiKey, 'X-Machine-Id': machineId },
      opts.headers || {},
    );
    const res = await fetch(`${baseUrl}${path}`, { ...opts, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  function setLastItem(itemId) {
    return chrome.storage.local.set({ lastSwiftlistItemId: itemId });
  }

  async function telemetry(payload) {
    try {
      await api('/api/v1/extension/telemetry', { method: 'POST', body: JSON.stringify(payload) });
    } catch (err) {
      console.warn('[swiftlist] telemetry failed', err);
    }
  }

  async function ping() {
    const { baseUrl } = await settings();
    const res = await fetch(`${baseUrl}/api/v1/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  window.swiftlist = { api, settings, setLastItem, telemetry, ping, bundledDefaults };
})();
