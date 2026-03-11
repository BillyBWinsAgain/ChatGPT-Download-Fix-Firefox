(() => {
	const ext = globalThis.browser ?? globalThis.chrome;

	if (!ext?.runtime?.getURL || !ext?.runtime?.sendMessage) {
		console.error('[ChatGPT Download Rescue] Extension API introuvable.');
		return;
	}

	function injectPageHook() {
		const script = document.createElement('script');
		script.src = ext.runtime.getURL('page-hook.js');
		script.dataset.chatgptDownloadRescue = 'v3';
		(document.documentElement || document.head || document.body).appendChild(script);
		script.addEventListener('load', () => script.remove(), { once: true });
	}

	window.addEventListener('message', (event) => {
		if (event.source !== window) return;
		const data = event.data;
		if (!data || data.__chatgptDownloadRescue !== 'v3') return;

		if (data.type === 'DIRECT_URL_CAPTURE') {
			try {
				const p = ext.runtime.sendMessage({
					type: 'DIRECT_URL_CAPTURE',
					source: data.source || 'page-hook',
					requestUrl: data.requestUrl || '',
					directUrl: data.directUrl || '',
					filename: data.filename || '',
				});

				if (p && typeof p.catch === 'function') {
					p.catch(() => {});
				}
			} catch {}
			return;
		}

		if (data.type === 'HOOK_LOG') {
			try {
				const p = ext.runtime.sendMessage({
					type: 'HOOK_LOG',
					level: data.level || 'debug',
					event: data.event || 'HOOK_LOG',
					data: data.data || {},
				});

				if (p && typeof p.catch === 'function') {
					p.catch(() => {});
				}
			} catch {}
		}
	}, true);

	injectPageHook();
})();
