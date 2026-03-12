const STATE_KEY = 'state';
const MAX_LOGS = 200;
const DEDUPE_TTL_MS = 15000;

async function loadState() {
  const stored = await browser.storage.local.get(STATE_KEY);
  return (
    stored[STATE_KEY] || {
      logs: [],
      lastCapture: null,
      downloadIds: {},
      recentCaptureKeys: {},
    }
  );
}

async function saveState(state) {
  await browser.storage.local.set({ [STATE_KEY]: state });
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

function requestKeyFromUrl(requestUrl) {
  try {
    const u = new URL(requestUrl);
    const messageId = u.searchParams.get('message_id') || '';
    const sandboxPath = u.searchParams.get('sandbox_path') || '';
    return `${messageId}::${sandboxPath}`;
  } catch {
    return requestUrl || '';
  }
}

function directKeyFromUrl(directUrl) {
  try {
    const u = new URL(directUrl);
    const id = u.searchParams.get('id') || '';
    return id || directUrl || '';
  } catch {
    return directUrl || '';
  }
}

function captureKey(capture) {
  const requestKey = requestKeyFromUrl(capture.requestUrl || '');
  const directKey = directKeyFromUrl(capture.directUrl || '');
  return `${requestKey}::${directKey}`;
}

async function rememberCapture(capture) {
  const state = await loadState();
  state.lastCapture = capture;
  await saveState(state);
}

async function shouldSkipRecent(capture) {
  const key = captureKey(capture);
  const now = Date.now();
  const state = await loadState();

  for (const [k, ts] of Object.entries(state.recentCaptureKeys || {})) {
    if (now - ts > DEDUPE_TTL_MS) {
      delete state.recentCaptureKeys[k];
    }
  }

  const prior = state.recentCaptureKeys[key];
  if (prior && now - prior <= DEDUPE_TTL_MS) {
    await saveState(state);
    return { skip: true, key };
  }

  state.recentCaptureKeys[key] = now;
  await saveState(state);
  return { skip: false, key };
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
    const id = await browser.downloads.download({
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

  const dedupe = await shouldSkipRecent(capture);
  if (dedupe.skip) {
    await addLog('debug', 'SKIPPED_DUPLICATE_CAPTURE', {
      source,
      key: dedupe.key,
      requestUrl: capture.requestUrl,
      directUrl: capture.directUrl,
      filename: capture.filename,
    });
    return { ok: true, skipped: true };
  }

  await rememberCapture(capture);
  return startDirectDownload(capture, source);
}

browser.runtime.onMessage.addListener((message) => {
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

      const tab = await browser.tabs.create({
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

browser.downloads.onChanged.addListener((delta) => {
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