(() => {
  if (window.__chatgptDownloadRescueContentInstalledV4) {
    return;
  }
  window.__chatgptDownloadRescueContentInstalledV4 = true;

  function injectPageHook() {
    if (document.documentElement?.dataset?.chatgptDownloadRescueHookInjected === 'v4') {
      return;
    }

    const script = document.createElement('script');
    script.src = browser.runtime.getURL('page-hook.js');
    script.dataset.chatgptDownloadRescue = 'v4';

    const root = document.documentElement || document.head || document.body;
    if (!root) return;

    root.dataset.chatgptDownloadRescueHookInjected = 'v4';
    root.appendChild(script);
    script.addEventListener(
      'load',
      () => {
        script.remove();
      },
      { once: true }
    );
  }

  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__chatgptDownloadRescue !== 'v4') return;

      if (data.type === 'DIRECT_URL_CAPTURE') {
        browser.runtime
          .sendMessage({
            type: 'DIRECT_URL_CAPTURE',
            source: data.source || 'page-hook',
            requestUrl: data.requestUrl || '',
            directUrl: data.directUrl || '',
            filename: data.filename || '',
          })
          .catch(() => {});
        return;
      }

      if (data.type === 'HOOK_LOG') {
        browser.runtime
          .sendMessage({
            type: 'HOOK_LOG',
            level: data.level || 'debug',
            event: data.event || 'HOOK_LOG',
            data: data.data || {},
          })
          .catch(() => {});
      }
    },
    true
  );

  injectPageHook();
})();