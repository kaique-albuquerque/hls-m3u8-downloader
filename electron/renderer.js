const MODE_LABELS = {
  'running:copy': 'Baixando - modo: copia direta (-c copy)',
  'running:copy-adtstoasc': 'Baixando - modo: copia direta com correcao de audio (aac_adtstoasc)',
  'running:aac': 'Baixando - modo: reconversao do audio para AAC (-c:a aac)',
  'retrying:copy': 'Falha no modo copia direta. Tentando modo alternativo...',
  'retrying:copy-adtstoasc': 'Falha no modo com aac_adtstoasc. Tentando modo alternativo...',
  'retrying:aac': 'Falha no modo AAC.',
};

const STEP_ORDER = ['ffmpeg', 'url', 'variant', 'file', 'dir', 'download'];

const tabBar = document.getElementById('tabBar');
const tabPanels = document.getElementById('tabPanels');
const tabTemplate = document.getElementById('tabTemplate');
const newTabBtn = document.getElementById('newTabBtn');
const themeToggle = document.getElementById('themeToggle');
const themeLabel = document.querySelector('[data-theme-label]');

const tabs = new Map();
const activeOutputs = new Map();
let counter = 1;
let defaultOutputDir = '';
let activeTabId = '';

initializeTheme();

window.api.resolvePaths().then(({ defaultDownloads }) => {
  defaultOutputDir = defaultDownloads || '';
  for (const tab of tabs.values()) {
    if (!tab.fields.outputDir.value) tab.fields.outputDir.value = defaultOutputDir;
    refreshResolvedOutput(tab);
  }
});

window.api.onDownloadProgress((payload) => {
  const tab = tabs.get(payload.taskId);
  if (!tab) return;

  lockTab(tab, true);
  tab.panel.classList.add('downloading');
  if (payload.duration) tab.duration = payload.duration;

  if (payload.key === 'out_time') {
    tab.metrics.time = payload.value;
    const pct = tab.duration
      ? Math.min(99, Math.floor((timeToSeconds(payload.value) / tab.duration) * 100))
      : null;
    if (pct !== null && Number.isFinite(pct)) {
      tab.fields.progress.style.width = `${Math.max(1, pct)}%`;
      tab.fields.percent.textContent = `${Math.max(1, pct)}%`;
    }
    setStatus(tab, `Baixando... Tempo: ${payload.value}`);
  }

  if (payload.key === 'total_size') {
    tab.metrics.size = formatBytes(payload.value);
  }

  if (payload.key === 'speed') {
    tab.metrics.speed = normalizeSpeed(payload.value);
  }

  if (payload.key === 'progress' && payload.value === 'end') {
    tab.fields.progress.style.width = '100%';
    tab.fields.percent.textContent = '100%';
    tab.panel.classList.remove('downloading');
    lockTab(tab, false, true);
  }

  syncMetrics(tab);
  appendLog(tab, `${payload.key}=${payload.value}`);
  setActiveStep(tab, 'download');
});

window.api.onDownloadLog(({ taskId, line }) => {
  const tab = tabs.get(taskId);
  if (!tab || !line) return;
  appendLog(tab, line);
});

window.api.onDownloadStatus(({ taskId, text }) => {
  const tab = tabs.get(taskId);
  if (!tab || !text) return;
  setStatus(tab, text);
});

window.api.onDownloadState(({ taskId, state, label, output }) => {
  const tab = tabs.get(taskId);
  if (!tab) return;

  if (state.startsWith('running')) {
    lockTab(tab, true);
    tab.panel.classList.add('downloading');
    setActiveStep(tab, 'download');
  }

  const text = label || MODE_LABELS[state] || state;
  tab.fields.modeLabel.textContent = text;
  setStatus(tab, text);
  if (output) {
    tab.outputPath = output;
    tab.fields.resolvedOutput.textContent = output;
  }
  appendLog(tab, text);
});

window.api.onDownloadDone(({ taskId, result }) => {
  const tab = tabs.get(taskId);
  if (!tab) return;

  releaseOutput(tab.outputPath, taskId);
  tab.panel.classList.remove('downloading');
  lockTab(tab, false);

  if (result?.ok) {
    tab.fields.progress.style.width = '100%';
    tab.fields.percent.textContent = '100%';
    tab.fields.modeLabel.textContent = 'Download concluido';
    setStatus(tab, 'Download concluido! Arquivo salvo com sucesso.');
    appendLog(tab, 'Download concluido!');
    setActiveStep(tab, 'download');
    markAllPreviousAsDone(tab, 'download');
    return;
  }

  tab.fields.progress.style.width = '0%';
  tab.fields.percent.textContent = '0%';
  const message = buildErrorMessage(result);
  tab.fields.modeLabel.textContent = 'Falha no download';
  setStatus(tab, `O download nao pode ser concluido: ${message}`);
  appendLog(tab, `ERRO: ${message}`);
});

newTabBtn.addEventListener('click', () => addTab());
addTab();

function addTab() {
  const id = `tab-${counter++}`;
  const label = `Video ${counter - 1}`;

  const tabButton = document.createElement('button');
  tabButton.className = 'tab';
  tabButton.addEventListener('click', () => activateTab(id));

  const title = document.createElement('span');
  title.textContent = label;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tab-close';
  closeBtn.textContent = 'x';
  closeBtn.title = 'Excluir aba';
  closeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    removeTab(id);
  });

  tabButton.append(title, closeBtn);

  const panel = tabTemplate.content.firstElementChild.cloneNode(true);
  const fields = {
    url: panel.querySelector('[data-field="url"]'),
    filename: panel.querySelector('[data-field="filename"]'),
    outputDir: panel.querySelector('[data-field="outputDir"]'),
    qualities: panel.querySelector('[data-field="qualities"]'),
    progress: panel.querySelector('[data-field="progressBar"]'),
    status: panel.querySelector('[data-field="status"]'),
    log: panel.querySelector('[data-field="log"]'),
    percent: panel.querySelector('[data-field="percent"]'),
    modeLabel: panel.querySelector('[data-field="modeLabel"]'),
    resolvedOutput: panel.querySelector('[data-field="resolvedOutput"]'),
    timeValue: panel.querySelector('[data-field="timeValue"]'),
    sizeValue: panel.querySelector('[data-field="sizeValue"]'),
    speedValue: panel.querySelector('[data-field="speedValue"]'),
    analyzeBtn: panel.querySelector('[data-action="analyze"]'),
    downloadBtn: panel.querySelector('[data-action="download"]'),
    cancelBtn: panel.querySelector('[data-action="cancel"]'),
    pickDirBtn: panel.querySelector('[data-action="pickDir"]'),
    turbo: panel.querySelector('[data-field="turbo"]'),
  };

  fields.outputDir.value = defaultOutputDir;

  const state = {
    id,
    taskId: id,
    tabButton,
    closeBtn,
    panel,
    fields,
    selectedQuality: null,
    selectedVariantUri: '',
    qualities: [],
    sourceUrl: '',
    analysisBaseUrl: '',
    busy: false,
    duration: 0,
    outputPath: '',
    metrics: {
      time: '--:--:--',
      size: '0 B',
      speed: 'N/A',
    },
    steps: Object.fromEntries(
      [...panel.querySelectorAll('[data-step]')].map((node) => [node.dataset.step, node])
    ),
  };

  fields.url.addEventListener('input', () => {
    if (fields.url.value.trim()) {
      setActiveStep(state, 'url');
      markAllPreviousAsDone(state, 'url');
    }
  });

  fields.filename.addEventListener('input', () => {
    refreshResolvedOutput(state);
    if (fields.filename.value.trim()) {
      setActiveStep(state, 'file');
      markAllPreviousAsDone(state, 'file');
    }
  });

  fields.outputDir.addEventListener('input', () => {
    refreshResolvedOutput(state);
    if (fields.outputDir.value.trim()) {
      setActiveStep(state, 'dir');
      markAllPreviousAsDone(state, 'dir');
    }
  });

  fields.pickDirBtn.addEventListener('click', async () => {
    if (state.busy) return;
    const dir = await window.api.pickOutputDir();
    if (dir) {
      fields.outputDir.value = dir;
      refreshResolvedOutput(state);
      setActiveStep(state, 'dir');
      markAllPreviousAsDone(state, 'dir');
    }
  });

  fields.analyzeBtn.addEventListener('click', async () => {
    if (state.busy) return;

    const url = fields.url.value.trim();
    if (!url) {
      setStatus(state, 'Nenhuma URL informada.');
      return;
    }

    setActiveStep(state, 'url');
    markAllPreviousAsDone(state, 'url');
    resetProgress(state);
    setStatus(state, 'Analisando playlist...');
    fields.modeLabel.textContent = 'Analise de playlist em andamento';
    fields.log.textContent = [
      '==============================================',
      'Video Downloader - HLS / DASH / YouTube / Redes sociais',
      '==============================================',
      '',
      'Verificando FFmpeg...',
      'FFmpeg OK.',
      '',
      `URL do video/playlist: ${url}`,
      'Analisando playlist...',
    ].join('\n');

    try {
      const info = await window.api.analyzePlaylist({ url, headers: {} });
      state.sourceUrl = url;
      state.analysisBaseUrl = info.baseUrl || url;

      if (info.kind === 'master' || info.kind === 'youtube' || info.kind === 'ytdlp') {
        state.qualities = info.variants;
        state.selectedVariantUri = info.variants[0]?.uri || '';
        state.selectedQuality = state.selectedVariantUri
          ? new URL(state.selectedVariantUri, state.analysisBaseUrl).toString()
          : null;
        renderQualities(state);
        setActiveStep(state, 'variant');
        markAllPreviousAsDone(state, 'variant');
        const title = info.title ? ` para "${info.title}"` : '';
        setStatus(
          state,
          `Formatos encontrados${title}. Se nada for escolhido, a melhor disponivel sera usada.`
        );
        appendLog(state, `Formatos encontrados: ${info.variants.length}`);
      } else if (info.kind === 'dash') {
        state.qualities = [];
        state.selectedVariantUri = '';
        state.selectedQuality = url;
        const best = info.videoRepresentations?.[0];
        renderQualities(
          state,
          best
            ? `Manifesto DASH detectado. Melhor representacao encontrada: ${best.resolution || 'sem resolucao'}.`
            : 'Manifesto DASH detectado. O FFmpeg resolvera as representacoes automaticamente.'
        );
        setActiveStep(state, 'file');
        markAllPreviousAsDone(state, 'file');
        setStatus(state, 'Manifesto DASH pronto para download.');
        appendLog(state, `Representacoes DASH: ${info.videoRepresentations?.length || 0}`);
      } else {
        state.qualities = [];
        state.selectedVariantUri = '';
        state.selectedQuality = url;
        state.duration = info.totalDuration || 0;
        renderQualities(state, info.kind === 'direct'
          ? 'Arquivo direto detectado. O CLI seguira direto para o download.'
          : 'Playlist unica detectada. O CLI seguiria direto para o download.');
        setActiveStep(state, 'file');
        markAllPreviousAsDone(state, 'file');
        setStatus(state, info.kind === 'direct' ? 'Arquivo direto pronto para download.' : 'Playlist pronta para download.');
        appendLog(state, info.kind === 'direct' ? 'Arquivo direto detectado.' : 'Playlist unica detectada.');
      }
    } catch (err) {
      setStatus(state, `Erro ao analisar: ${err.message}`);
      appendLog(state, `[ERRO] ${err.message}`);
    }
  });

  fields.downloadBtn.addEventListener('click', async () => {
    if (state.busy) return;

    const url = fields.url.value.trim();
    if (!url) {
      setStatus(state, 'Nenhuma URL informada.');
      return;
    }

    const outputDir = (fields.outputDir.value.trim() || defaultOutputDir || '').trim();
    const baseName = sanitizeFilename(fields.filename.value.trim() || 'video');
    const filename = ensureMp4(baseName);
    const fullOutput = outputDir ? `${outputDir}\\${filename}` : filename;
    const conflict = activeOutputs.get(fullOutput);

    if (conflict && conflict !== state.taskId) {
      setStatus(state, 'Esse nome de arquivo ja esta sendo usado em outra aba.');
      return;
    }

    if (!state.selectedQuality && state.qualities.length > 0) {
      state.selectedVariantUri = state.qualities[0].uri;
      state.selectedQuality = new URL(state.selectedVariantUri, state.analysisBaseUrl || url).toString();
    }

    const chosenQuality = state.qualities.find((q) => q.uri === state.selectedVariantUri);

    state.outputPath = fullOutput;
    activeOutputs.set(fullOutput, state.taskId);
    refreshResolvedOutput(state);
    resetProgress(state);
    lockTab(state, true);
    setActiveStep(state, 'download');
    markAllPreviousAsDone(state, 'download');
    state.fields.modeLabel.textContent = 'Modo automatico (fallback do CLI)';
    setStatus(state, 'Iniciando download...');
    fields.log.textContent = [
      '==============================================',
      'Video Downloader - HLS / DASH / YouTube / Redes sociais',
      'via FFmpeg + curl-impersonate (opcional)',
      '==============================================',
      '',
      'Verificando FFmpeg...',
      'FFmpeg OK.',
      '',
      `URL reconhecida: ${url}`,
      state.qualities.length
        ? `Formato escolhido: ${chosenQuality?.resolution || state.selectedQuality || 'melhor disponivel'}`
        : 'Playlist unica detectada.',
      `Salvando em: ${fullOutput}`,
      'Iniciando fluxo padrao do FFmpeg...',
    ].join('\n');

    await window.api.startDownload({
      taskId: state.taskId,
      url: state.sourceUrl || url,
      filename: baseName,
      outputDir,
      qualityChoice: state.qualities.length
        ? String(
            Math.max(
              1,
              state.qualities.findIndex((q) => q.uri === state.selectedVariantUri) + 1 || 1
            )
          )
        : '',
      overwriteAction: 'overwrite',
      overwriteNewName: '',
      forceCurl: false,
      turbo: fields.turbo?.checked === true,
    });
  });

  fields.cancelBtn.addEventListener('click', async () => {
    await window.api.cancelDownload({ taskId: state.taskId });
    setStatus(state, 'Operacao cancelada.');
    fields.modeLabel.textContent = 'Cancelado';
    appendLog(state, 'Operacao cancelada.');
    state.panel.classList.remove('downloading');
    releaseOutput(state.outputPath, state.taskId);
    lockTab(state, false);
  });

  tabs.set(id, state);
  tabBar.appendChild(tabButton);
  tabPanels.appendChild(panel);
  refreshResolvedOutput(state);
  syncMetrics(state);
  activateTab(id);
}

function activateTab(id) {
  activeTabId = id;
  for (const [tabId, tab] of tabs) {
    tab.tabButton.classList.toggle('active', tabId === id);
    tab.panel.classList.toggle('active', tabId === id);
  }
}

function removeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (tab.busy) {
    setStatus(tab, 'Cancele o download antes de excluir esta aba.');
    return;
  }

  releaseOutput(tab.outputPath, tab.taskId);
  tab.tabButton.remove();
  tab.panel.remove();
  tabs.delete(id);

  if (!tabs.size) {
    addTab();
    return;
  }

  if (activeTabId === id) {
    const nextId = tabs.keys().next().value;
    activateTab(nextId);
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
    const resolved = new URL(q.uri, state.analysisBaseUrl || state.fields.url.value.trim()).toString();
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `quality ${state.selectedQuality === resolved ? 'selected' : ''}`;
    item.disabled = state.busy;
    item.innerHTML = [
      '<div>',
      `<strong>${q.resolution || `variante ${idx + 1}`}</strong>`,
      `<small>${q.height ? `${q.height}p` : 'Resolucao nao informada'}${q.bandwidth ? `  ~ ${formatKbps(q.bandwidth)}` : ''}</small>`,
      '</div>',
      `<small>${q.codecs || 'Sem codecs informados'}</small>`,
    ].join('');
    item.addEventListener('click', () => {
      if (state.busy) return;
      state.selectedVariantUri = q.uri;
      state.selectedQuality = resolved;
      setActiveStep(state, 'variant');
      markAllPreviousAsDone(state, 'variant');
      setStatus(state, `Variant escolhida: ${q.resolution || `variante ${idx + 1}`}`);
      appendLog(state, `Variant escolhida: ${resolved}`);
      renderQualities(state);
    });
    el.appendChild(item);
  });
}

function setStatus(state, text) {
  state.fields.status.textContent = text;
}

function appendLog(tab, line) {
  const content = [tab.fields.log.textContent, line].filter(Boolean).join('\n');
  const lines = content.split('\n').slice(-240);
  tab.fields.log.textContent = lines.join('\n');
  tab.fields.log.scrollTop = tab.fields.log.scrollHeight;
}

function buildErrorMessage(result) {
  if (!result) return 'erro desconhecido';
  if (result.error?.message) return result.error.message;
  if (result.stderr) {
    const tail = String(result.stderr)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-6)
      .join(' | ');
    if (tail) return tail;
  }
  if (result.code !== undefined && result.code !== null) return `codigo ${result.code}`;
  return 'erro desconhecido';
}

function lockTab(state, busy) {
  state.busy = busy;
  state.fields.analyzeBtn.disabled = busy;
  state.fields.downloadBtn.disabled = busy;
  state.fields.url.disabled = busy;
  state.fields.filename.disabled = busy;
  state.fields.outputDir.disabled = busy;
  state.fields.pickDirBtn.disabled = busy;
  state.fields.qualities.querySelectorAll('button').forEach((btn) => {
    btn.disabled = busy;
  });
  state.fields.cancelBtn.disabled = !busy;
  state.closeBtn.disabled = busy;
}

function timeToSeconds(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 3) return 0;
  const [h, m, s] = parts.map(Number);
  if ([h, m, s].some((n) => Number.isNaN(n))) return 0;
  return h * 3600 + m * 60 + s;
}

function releaseOutput(output, taskId) {
  if (!output) return;
  const owner = activeOutputs.get(output);
  if (owner === taskId) activeOutputs.delete(output);
}

function sanitizeFilename(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[.\s]+$/g, '')
    .replace(/^[.\s]+/g, '');
  return cleaned || 'video';
}

function ensureMp4(name) {
  return /\.mp4$/i.test(name) ? name : `${name}.mp4`;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatKbps(bandwidth) {
  const n = Number(bandwidth) || 0;
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(n / 1000)} Kbps`;
}

function normalizeSpeed(value) {
  const text = String(value || '').trim();
  return text || 'N/A';
}

function refreshResolvedOutput(state) {
  const dir = state.fields.outputDir.value.trim() || defaultOutputDir || '';
  const base = sanitizeFilename(state.fields.filename.value.trim() || 'video');
  const output = dir ? `${dir}\\${ensureMp4(base)}` : ensureMp4(base);
  state.fields.resolvedOutput.textContent = output || 'Ainda nao definida';
}

function syncMetrics(state) {
  state.fields.timeValue.textContent = state.metrics.time;
  state.fields.sizeValue.textContent = state.metrics.size;
  state.fields.speedValue.textContent = state.metrics.speed;
}

function resetProgress(state) {
  state.metrics = {
    time: '--:--:--',
    size: '0 B',
    speed: 'N/A',
  };
  state.fields.progress.style.width = '0%';
  state.fields.percent.textContent = '0%';
  syncMetrics(state);
}

function setActiveStep(state, activeStep) {
  STEP_ORDER.forEach((step) => {
    const node = state.steps[step];
    if (!node) return;
    node.classList.toggle('active', step === activeStep);
  });
}

function markAllPreviousAsDone(state, currentStep) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  STEP_ORDER.forEach((step, index) => {
    const node = state.steps[step];
    if (!node) return;
    node.classList.toggle('done', index < currentIndex);
  });
}

function initializeTheme() {
  const savedTheme = localStorage.getItem('vd-theme') || 'dark';
  applyTheme(savedTheme);
  themeToggle.checked = savedTheme === 'light';
  themeToggle.addEventListener('change', () => {
    const nextTheme = themeToggle.checked ? 'light' : 'dark';
    applyTheme(nextTheme);
    localStorage.setItem('vd-theme', nextTheme);
  });
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  if (themeLabel) {
    themeLabel.textContent = theme === 'light' ? 'Modo claro' : 'Modo escuro';
  }
}
