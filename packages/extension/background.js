// Service worker. Two jobs:
//   1. Generate a stable machineId on first install and store in chrome.storage.local.
//   2. Periodically poll /api/v1/extension/patch for hot-patch payloads.

const PATCH_INTERVAL_MIN = 6 * 60; // 6 hours

chrome.runtime.onInstalled.addListener(async () => {
  const { machineId } = await chrome.storage.local.get('machineId');
  if (!machineId) {
    await chrome.storage.local.set({ machineId: crypto.randomUUID() });
  }
  chrome.alarms.create('hot-patch', { periodInMinutes: PATCH_INTERVAL_MIN, when: Date.now() + 5_000 });
});

chrome.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'hot-patch') return;
  try {
    const { apiKey, baseUrl } = await chrome.storage.sync.get(['apiKey', 'baseUrl']);
    if (!apiKey || !baseUrl) return;
    const { machineId } = await chrome.storage.local.get('machineId');
    const res = await fetch(`${baseUrl}/api/v1/extension/patch`, {
      headers: { 'X-Api-Key': apiKey, 'X-Machine-Id': machineId },
    });
    if (!res.ok) return;
    const patch = await res.json();
    if (patch && patch.version) {
      const { patchVersion } = await chrome.storage.local.get('patchVersion');
      if (patch.version !== patchVersion) {
        await chrome.storage.local.set({ patchVersion: patch.version, patchScripts: patch.scripts ?? {} });
      }
    }
  } catch (err) {
    console.warn('[swiftlist] hot-patch poll failed', err);
  }
});
