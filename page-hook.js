(() => {
  if (window.__chatgptDownloadRescuePageHookInstalledV4) {
    return;
  }
  window.__chatgptDownloadRescuePageHookInstalledV4 = true;

  function log(event, data = {}, level = 'debug') {
    window.postMessage(
      {
        __chatgptDownloadRescue: 'v4',
        type: 'HOOK_LOG',
        level,
        event,
        data,
      },
      '*'
    );
  }

  function filenameFromRequestUrl(requestUrl) {
    try {
      const parsed = new URL(requestUrl, location.href);
      const sandboxPath = parsed.searchParams.get('sandbox_path') || '';
      const piece = sandboxPath.split('/').filter(Boolean).pop();
      return piece ? decodeURIComponent(piece) : '';
    } catch {
      return '';
    }
  }

  function emit(requestUrl, directUrl, source) {
    if (!requestUrl || !directUrl) return;

    window.postMessage(
      {
        __chatgptDownloadRescue: 'v4',
        type: 'DIRECT_URL_CAPTURE',
        source,
        requestUrl,
        directUrl,
        filename: filenameFromRequestUrl(requestUrl),
      },
      '*'
    );
  }

  function looksLikeDownloadPrep(url) {
    try {
      const u = new URL(url, location.href);
      const path = u.pathname.toLowerCase();

      if (path.includes('/interpreter/download')) return true;

      if (
        path.includes('/download') &&
        (u.searchParams.has('message_id') || u.searchParams.has('sandbox_path'))
      ) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  function maybeDirectUrlFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return '';

    if (typeof payload.download_url === 'string' && payload.download_url) {
      return payload.download_url;
    }

    if (typeof payload.url === 'string' && /^https?:/i.test(payload.url)) {
      return payload.url;
    }

    if (payload.data && typeof payload.data === 'object') {
      const nested = maybeDirectUrlFromPayload(payload.data);
      if (nested) return nested;
    }

    if (payload.result && typeof payload.result === 'object') {
      const nested = maybeDirectUrlFromPayload(payload.result);
      if (nested) return nested;
    }

    return '';
  }

  async function inspectFetchResponse(requestUrl, response) {
    try {
      if (!response || typeof response.clone !== 'function') return;

      const clone = response.clone();
      const text = await clone.text();

      if (!text) {
        log('FETCH_MATCHED_EMPTY_BODY', { requestUrl });
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        log('FETCH_MATCHED_NON_JSON', {
          requestUrl,
          error: String(error),
          preview: text.slice(0, 300),
        });
        return;
      }

      const directUrl = maybeDirectUrlFromPayload(data);

      if (directUrl) {
        log('FETCH_MATCHED_DIRECT_URL', { requestUrl });
        emit(requestUrl, directUrl, 'fetch-response');
      } else {
        log('FETCH_MATCHED_NO_DIRECT_URL', {
          requestUrl,
          keys: Object.keys(data || {}),
        });
      }
    } catch (error) {
      log(
        'FETCH_MATCHED_PARSE_ERROR',
        {
          requestUrl,
          error: String(error),
          bodyUsed: Boolean(response && response.bodyUsed),
        },
        'error'
      );
    }
  }

  function inspectXhrResponse(requestUrl, xhr) {
    try {
      if (!xhr) return;

      let payload = null;

      if (xhr.responseType === 'json' && xhr.response) {
        payload = xhr.response;
      } else if (!xhr.responseType || xhr.responseType === 'text') {
        payload = JSON.parse(xhr.responseText || 'null');
      }

      const directUrl = maybeDirectUrlFromPayload(payload);

      if (directUrl) {
        log('XHR_MATCHED_DIRECT_URL', { requestUrl });
        emit(requestUrl, directUrl, 'xhr-response');
      } else {
        log('XHR_MATCHED_NO_DIRECT_URL', {
          requestUrl,
          keys: Object.keys(payload || {}),
        });
      }
    } catch (error) {
      log(
        'XHR_MATCHED_PARSE_ERROR',
        {
          requestUrl,
          error: String(error),
        },
        'error'
      );
    }
  }

  function extractUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const requestUrl = extractUrl(args[0]);
    const result = originalFetch.apply(this, args);

    if (requestUrl && looksLikeDownloadPrep(requestUrl)) {
      log('FETCH_MATCHED_REQUEST', { requestUrl });
      Promise.resolve(result)
        .then((response) => inspectFetchResponse(requestUrl, response))
        .catch((error) => {
          log(
            'FETCH_MATCHED_PROMISE_ERROR',
            {
              requestUrl,
              error: String(error),
            },
            'error'
          );
        });
    }

    return result;
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__chatgptDownloadRescueRequestUrl = String(url || '');
    return xhrOpen.call(this, method, url, ...rest);
  };

  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const requestUrl = this.__chatgptDownloadRescueRequestUrl || '';

    if (requestUrl && looksLikeDownloadPrep(requestUrl)) {
      log('XHR_MATCHED_REQUEST', { requestUrl });
      this.addEventListener(
        'load',
        () => inspectXhrResponse(requestUrl, this),
        { once: true }
      );
    }

    return xhrSend.apply(this, args);
  };
})();