/* ArBetter - popup.js */
(() => {
  'use strict';

  const KEY_ENABLED = 'enabled';
  const ARBOR_TAB_RE = /^https?:\/\/[^/]+\.arbor\.education\//i;

  const toggle = document.getElementById('enabled');
  const stateText = document.getElementById('state-text');
  const status = document.getElementById('status');

  const render = (enabled) => {
    toggle.checked = enabled;
    stateText.textContent = enabled
      ? 'Minimal view is on for Arbor pages.'
      : 'Native Arbor view is restored.';
  };

  const setStatus = (msg) => {
    status.textContent = msg;
  };

  chrome.storage.sync.get({ [KEY_ENABLED]: true }, (res) => {
    if (chrome.runtime.lastError) {
      setStatus('Could not read settings.');
      return;
    }
    render(res[KEY_ENABLED] !== false);
  });

  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked;
    toggle.disabled = true;

    try {
      await chrome.storage.sync.set({ [KEY_ENABLED]: enabled });
      render(enabled);

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab && tab.id && tab.url && ARBOR_TAB_RE.test(tab.url)) {
        await chrome.tabs.reload(tab.id);
        setStatus('Settings saved. Arbor tab reloaded.');
      } else {
        setStatus('Settings saved. Open an Arbor page to see the change.');
      }
    } catch (err) {
      setStatus('Could not save settings! Please try again.');
      toggle.checked = !enabled;
    } finally {
      toggle.disabled = false;
    }
  });
})();
