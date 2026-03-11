const browserApi = globalThis.browser ?? globalThis.chrome;
const STATE_KEY = 'state';
const MAX_LOGS = 200;

async function loadState() {
	const stored = await browserApi.storage.local.get(STATE_KEY);
	return (
		stored[STATE_KEY] || {
			logs: [],
			lastCapture: null,
			downloadIds: {},
		}
	);
}

async function saveState(state) {
	await browserApi.storage.local.set({ [STATE_KEY]: state });
}

async function addLog(level, event, data = {}) {
	const state = await loadState();
	state.logs.push({
		ts: new Date().toISOString(),
		level,
		event,
		data,
	});
	state.logs = state.logs.slice(-MAX_LOGS);
	await saveState(state);
}

function safeFilename(name) {
	return (
		String(name || 'chatgpt-download')
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
			.trim()
			.slice(0, 180) || 'chatgpt-download'
	);
}

function filenameFromRequestUrl(requestUrl) {
	try {
		const parsed = new URL(requestUrl);
		const sandboxPath = parsed.searchParams.get('sandbox_path') || '';
		const piece = sandboxPath.split('/').filter(Boolean).pop();
		if (piece) return safeFilename(decodeURIComponent(piece));
	} catch {}
	return null;
}

function filenameFromDirectUrl(directUrl) {
	try {
		const parsed = new URL(directUrl);
		const piece = parsed.pathname.split('/').filter(Boolean).pop();
		if (piece) return safeFilename(decodeURIComponent(piece));
	} catch {}
	return null;
}

async function rememberCapture(capture) {
	const state = await loadState();
	state.lastCapture = capture;
	await saveState(state);
}

async function startDirectDownload(capture, source) {
	const filename =
		capture.filename ||
		filenameFromRequestUrl(capture.requestUrl) ||
		filenameFromDirectUrl(capture.directUrl) ||
		'chatgpt-download';

	await addLog('debug', 'DIRECT_URL', {
		source,
		requestUrl: capture.requestUrl,
		directUrl: capture.directUrl,
		filename,
	});

	try {
		const id = await browserApi.downloads.download({
			url: capture.directUrl,
			filename,
			saveAs: false,
			conflictAction: 'uniquify',
		});

		const state = await loadState();
		state.downloadIds[String(id)] = {
			...capture,
			filename,
		};
		await saveState(state);

		await addLog('debug', 'DOWNLOAD_STARTED', {
			source,
			downloadId: id,
			filename,
			directUrl: capture.directUrl,
		});

		return { ok: true, downloadId: id, filename };
	} catch (error) {
		await addLog('error', 'DOWNLOAD_THROW', {
			source,
			error: String(error),
			directUrl: capture.directUrl,
			filename,
		});
		return { ok: false, error: String(error) };
	}
}

async function handleCapture(capture, source) {
	if (!capture || !capture.directUrl) {
		return { ok: false, error: 'No directUrl present.' };
	}

	capture.filename =
		capture.filename ||
		filenameFromRequestUrl(capture.requestUrl) ||
		filenameFromDirectUrl(capture.directUrl) ||
		'chatgpt-download';

	await rememberCapture(capture);
	return startDirectDownload(capture, source);
}

browserApi.runtime.onMessage.addListener((message) => {
	if (!message || typeof message !== 'object') return undefined;

	if (message.type === 'DIRECT_URL_CAPTURE') {
		return handleCapture(
			{
				requestUrl: message.requestUrl || '',
				directUrl: message.directUrl || '',
				filename: message.filename || '',
			},
			message.source || 'page-hook'
		);
	}

	if (message.type === 'HOOK_LOG') {
		return addLog(
			message.level || 'debug',
			message.event || 'HOOK_LOG',
			message.data || {}
		).then(() => ({ ok: true }));
	}

	if (message.type === 'GET_STATE') {
		return loadState();
	}

	if (message.type === 'REDOWNLOAD_LAST') {
		return loadState().then((state) => {
			if (!state.lastCapture) {
				return { ok: false, error: 'No captured direct URL yet.' };
			}
			return startDirectDownload(state.lastCapture, 'popup-redownload');
		});
	}

	if (message.type === 'OPEN_LAST') {
		return loadState().then(async (state) => {
			if (!state.lastCapture?.directUrl) {
				return { ok: false, error: 'No captured direct URL yet.' };
			}

			const tab = await browserApi.tabs.create({
				url: state.lastCapture.directUrl,
				active: true,
			});

			await addLog('debug', 'OPENED_DIRECT_URL_TAB', {
				tabId: tab.id,
				directUrl: state.lastCapture.directUrl,
			});

			return { ok: true, tabId: tab.id };
		});
	}

	if (message.type === 'CLEAR_LOGS') {
		return loadState().then(async (state) => {
			state.logs = [];
			await saveState(state);
			return { ok: true };
		});
	}

	return undefined;
});

browserApi.downloads.onChanged.addListener((delta) => {
	void (async () => {
		const id = String(delta.id);
		const state = await loadState();
		const meta = state.downloadIds[id];
		if (!meta) return;

		const payload = {
			downloadId: delta.id,
			directUrl: meta.directUrl,
			filename: meta.filename,
		};

		if (delta.state) payload.state = delta.state.current;
		if (delta.error) payload.error = delta.error.current;
		if (delta.filename) payload.finalFilename = delta.filename.current;

		await addLog('debug', 'DOWNLOAD_CHANGED', payload);
	})();
});
