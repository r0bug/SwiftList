(async () => {
  const s = await window.swiftlist.settings();
  const local = await chrome.storage.local.get('machineId');
  document.getElementById('apiKey').value = s.apiKey || '';
  document.getElementById('baseUrl').value = s.baseUrl || '';
  document.getElementById('webUrl').value = s.webUrl || '';
  document.getElementById('machineId').value = local.machineId || '(generated on first install)';
})();

document.getElementById('save').addEventListener('click', async () => {
  const msg = document.getElementById('msg');
  const apiKey = document.getElementById('apiKey').value.trim();
  const baseUrl = document.getElementById('baseUrl').value.trim().replace(/\/$/, '');
  const webUrl = document.getElementById('webUrl').value.trim().replace(/\/$/, '');
  await chrome.storage.sync.set({ apiKey, baseUrl, webUrl });
  try {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    if (res.ok) {
      msg.textContent = 'Saved. Server reachable.';
      msg.className = 'ok';
    } else {
      msg.textContent = `Saved. Server returned ${res.status}.`;
      msg.className = 'err';
    }
  } catch (err) {
    msg.textContent = `Saved. Could not reach server: ${err.message}`;
    msg.className = 'err';
  }
});
