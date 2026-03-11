const browserApi = globalThis.browser ?? globalThis.chrome;

const summaryNode = document.getElementById('summary');
const captureNode = document.getElementById('capture');
const logsNode = document.getElementById('logs');
const redownloadButton = document.getElementById('redownload');
const openButton = document.getElementById('open');
const clearButton = document.getElementById('clear');

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

async function refresh() {
	const state = await browserApi.runtime.sendMessage({ type: 'GET_STATE' });
	const logs = (state.logs || []).slice().reverse();
	summaryNode.textContent = `${logs.length} log entries`;
	captureNode.textContent = state.lastCapture
		? JSON.stringify(state.lastCapture)
		: 'No direct URL captured yet.';
	logsNode.innerHTML = logs.map((log) => `
		<div class="log">
			<div><strong>${escapeHtml(log.event)}</strong></div>
			<div class="muted">${escapeHtml(log.ts)} · ${escapeHtml(log.level)}</div>
			<div class="mono">${escapeHtml(JSON.stringify(log.data))}</div>
		</div>
	`).join('');
}

redownloadButton.addEventListener('click', async () => {
	await browserApi.runtime.sendMessage({ type: 'REDOWNLOAD_LAST' });
	await refresh();
});

openButton.addEventListener('click', async () => {
	await browserApi.runtime.sendMessage({ type: 'OPEN_LAST' });
	await refresh();
});

clearButton.addEventListener('click', async () => {
	await browserApi.runtime.sendMessage({ type: 'CLEAR_LOGS' });
	await refresh();
});

void refresh();
