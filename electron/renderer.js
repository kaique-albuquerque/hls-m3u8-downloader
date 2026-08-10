const tabBar = document.getElementById('tabBar');
const tabPanels = document.getElementById('tabPanels');
const tabTemplate = document.getElementById('tabTemplate');
const newTabBtn = document.getElementById('newTabBtn');

const tabs = new Map();
let activeTabId = null;
let counter = 1;
let defaultOutputDir = '';

window.api.resolvePaths().then(({ defaultDownloads }) => {
  defaultOutputDir = defaultDownloads || '';
  for (const tab of tabs.values()) {
    if (!tab.fields.outputDir.value) tab.fields.outputDir.value = defaultOutputDir;
  }
});

window.api.onDownloadProgress((payload) => {
  const tab = tabs.get(payload.taskId);
  if (!tab) return;
  if (payload.key === 'out_time') tab.status.textContent = `Baixando... ${payload.value}`;
  if (payload.key === 'speed') tab.progress.dataset.speed = payload.value;
  if (payload.key === 'total_size') tab.progress.dataset.size = payload.value;
  tab.log.textContent = [
    tab.log.textContent,
    `${payload.key}=${payload.value}`,
  ].filter(Boolean).slice(-200).join('\n');
});

window.api.onDownloadState(({ taskId, state }) => {
  const tab = tabs.get(taskId);
  if (!tab) return;
  tab.status.textContent = state === 'running' ? 'Baixando...' : state;
});

window.api.onDownloadDone(({ taskId, result }) => {
  const tab = tabs.get(taskId);
  if (!tab) return;
  tab.progress.style.width = result?.ok ? '100%' : '0%';
  tab.status.textContent = result?.ok ? 'Concluído' : 'Erro';
});

newTabBtn.addEventListener('click', () => addTab());

addTab();

function addTab() {
  const id = `tab-${counter++}`;
  const label = `Vídeo ${counter - 1}`;

  const tabButton = document.createElement('button');
  tabButton.className = 'tab';
  tabButton.textContent = label;
  tabButton.addEventListener('click', () => activateTab(id));

  const panel = tabTemplate.content.firstElementChild.cloneNode(true);
  const fields = {
    url: panel.querySelector('[data-field="url"]'),
    filename: panel.querySelector('[data-field="filename"]'),
    outputDir: panel.querySelector('[data-field="outputDir"]'),
    qualities: panel.querySelector('[data-field="qualities"]'),
    progress: panel.querySelector('[data-field="progressBar"]'),
    status: panel.querySelector('[data-field="status"]'),
    log: panel.querySelector('[data-field="log"]'),
  };

  const state = {
    id,
    taskId: id,
    tabButton,
    panel,
    fields,
    selectedQuality: null,
    qualities: [],
    downloadTargetUrl: null,
  };

  panel.querySelector('[data-action="pickDir"]').addEventListener('click', async () => {
    const dir = await window.api.pickOutputDir();
    if (dir) fields.outputDir.value = dir;
  });

  panel.querySelector('[data-action="analyze"]').addEventListener('click', async () => {
    const url = fields.url.value.trim();
    if (!url) return setStatus(state, 'Cole uma URL primeiro.');
    setStatus(state, 'Analisando playlist...');
    fields.log.textContent = '';
    try {
      const info = await window.api.analyzePlaylist({ url, headers: {} });
      if (info.kind === 'master') {
        state.qualities = info.variants;
        state.downloadTargetUrl = info.baseUrl || url;
        state.selectedQuality = info.variants[0]
          ? new URL(info.variants[0].uri, info.baseUrl || url).toString()
          : null;
        renderQualities(state);
        setStatus(state, 'Qualidades carregadas. Escolha uma opção.');
      } else {
        state.qualities = [];
        state.downloadTargetUrl = url;
        state.selectedQuality = url;
        renderQualities(state, 'Playlist única detectada. Pronta para baixar.');
        setStatus(state, 'Playlist pronta.');
      }
    } catch (err) {
      setStatus(state, `Erro ao analisar: ${err.message}`);
    }
  });

  panel.querySelector('[data-action="download"]').addEventListener('click', async () => {
    const url = fields.url.value.trim();
    if (!url) return setStatus(state, 'Cole uma URL primeiro.');

    const outputDir = (fields.outputDir.value.trim() || defaultOutputDir || '').trim();
    const filename = (fields.filename.value.trim() || 'video') + '.mp4';
    const fullOutput = outputDir ? `${outputDir}\\${filename}` : filename;
    const target = state.selectedQuality || state.downloadTargetUrl || url;
    const taskId = state.taskId;

    fields.progress.style.width = '0%';
    setStatus(state, 'Iniciando download...');
    fields.log.textContent = '';

    if (!state.selectedQuality && state.qualities.length > 0) {
      state.selectedQuality = new URL(state.qualities[0].uri, state.downloadTargetUrl || url).toString();
    }

    await window.api.startDownload({
      taskId,
      url: target,
      output: fullOutput,
      headers: {},
    });
  });

  panel.querySelector('[data-action="cancel"]').addEventListener('click', async () => {
    await window.api.cancelDownload({ taskId: state.taskId });
    setStatus(state, 'Cancelado.');
  });

  tabs.set(id, state);
  tabBar.appendChild(tabButton);
  tabPanels.appendChild(panel);
  activateTab(id);
}

function activateTab(id) {
  activeTabId = id;
  for (const [tabId, tab] of tabs) {
    tab.tabButton.classList.toggle('active', tabId === id);
    tab.panel.classList.toggle('active', tabId === id);
  }
}

function renderQualities(state, emptyLabel = 'Nenhuma URL analisada ainda.') {
  const el = state.fields.qualities;
  el.innerHTML = '';
  if (!state.qualities.length) {
    el.classList.add('empty');
    el.textContent = emptyLabel;
    return;
  }
  el.classList.remove('empty');
  state.qualities.forEach((q, idx) => {
    const resolved = new URL(q.uri, state.downloadTargetUrl || state.fields.url.value.trim()).toString();
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `quality ${state.selectedQuality === resolved ? 'selected' : ''}`;
    const title = q.resolution || `${q.bandwidth || 0}`;
    item.innerHTML = `<span>${title}</span><small>${q.codecs || ''}</small>`;
    item.addEventListener('click', () => {
      state.selectedQuality = resolved;
      setStatus(state, `Qualidade selecionada: ${q.resolution || 'variante ' + (idx + 1)}`);
      renderQualities(state);
    });
    el.appendChild(item);
  });
}

function setStatus(state, text) {
  state.fields.status.textContent = text;
}
