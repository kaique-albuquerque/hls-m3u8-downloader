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

// P11: downloads fluem pela fila real (src/core/queue.js) — o main process
// encaminha os eventos do engine/fila em um canal unico `queue:event`.
// Nenhuma aba depende mais de download:log/status/state/progress/done.
window.api.onQueueEvent(({ event, payload }) => {
  handleQueueEvent(event, payload);
});

newTabBtn.addEventListener('click', () => addTab());
addTab();

function addTab({ copyFrom } = {}) {
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
    enqueueBtn: panel.querySelector('[data-action="enqueue"]'),
    cancelBtn: panel.querySelector('[data-action="cancel"]'),
    pickDirBtn: panel.querySelector('[data-action="pickDir"]'),
    openFileBtn: panel.querySelector('[data-action="openFile"]'),
    showInFolderBtn: panel.querySelector('[data-action="showInFolder"]'),
    revealRow: panel.querySelector('[data-field="revealRow"]'),
    metadata: panel.querySelector('[data-field="metadata"]'),
    thumbnail: panel.querySelector('[data-field="thumbnail"]'),
    metaTitle: panel.querySelector('[data-field="metaTitle"]'),
    metaDuration: panel.querySelector('[data-field="metaDuration"]'),
    metaProvider: panel.querySelector('[data-field="metaProvider"]'),
    metaCodec: panel.querySelector('[data-field="metaCodec"]'),
    metaBitrate: panel.querySelector('[data-field="metaBitrate"]'),
    metaSize: panel.querySelector('[data-field="metaSize"]'),
    turbo: panel.querySelector('[data-field="turbo"]'),
  };

  fields.outputDir.value = defaultOutputDir;

  // P8: "Adicionar à fila" copia URL/arquivo/pasta/turbo da aba origem.
  if (copyFrom) {
    fields.url.value = copyFrom.fields.url.value || '';
    fields.filename.value = copyFrom.fields.filename.value || '';
    fields.outputDir.value = copyFrom.fields.outputDir.value || defaultOutputDir;
    if (copyFrom.fields.turbo?.checked) fields.turbo.checked = true;
  }

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
    media: null,
    busy: false,
    duration: 0,
    outputPath: '',
    // P11: vínculo com a fila real (jobId da DownloadQueue + estado).
    jobId: '',
    jobState: '', // '' | queued | active | paused | terminal
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
    state.fields.revealRow.hidden = true;
    setStatus(state, 'Analisando playlist...');
    fields.modeLabel.textContent = 'Analise de playlist em andamento';
    fields.log.textContent = [
      '==============================================',
      'StreamGrab - HLS / DASH / YouTube / Redes sociais',
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
      // P11 (secao 42 — UX de falhas): erro normalizado do main process.
      if (info && info.ok === false) {
        const err = info.error || {};
        setStatus(state, `Erro ao analisar: ${err.message || 'falha desconhecida'}`);
        appendLog(state, `[ERRO] ${err.message || 'falha desconhecida'}`);
        if (err.suggestedAction) appendLog(state, `Acao sugerida: ${err.suggestedAction}`);
        if (err.detail) appendLog(state, `Detalhes: ${err.detail}`);
        fields.modeLabel.textContent = 'Falha na analise';
        return;
      }
      state.sourceUrl = info.workingUrl || url;
      state.analysisBaseUrl = info.baseUrl || info.media?.baseUrl || url;
      state.media = info.media || null;
      renderMediaInfo(state);

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
    // "Baixar agora": enfileira na fila real e trava a aba — o job inicia
    // assim que houver vaga (concorrência limitada) e o engine transmite
    // os eventos de progresso para esta aba via queue:event.
    await enqueueForTab(state, { lockNow: true });
  });

  // P11 (item 2): "Adicionar à fila" usa a fila real de src/core/queue.js —
  // concorrência limitada, estados aguardando/downloading/paused, pause/
  // resume/cancel/retry — sem criar uma nova aba nem iniciar fora da fila.
  fields.enqueueBtn.addEventListener('click', async () => {
    if (state.busy) return;
    await enqueueForTab(state, { lockNow: false });
  });

  fields.openFileBtn.addEventListener('click', async () => {
    if (!state.outputPath) return;
    const { ok, error } = await window.api.openFile({ filePath: state.outputPath });
    if (!ok) setStatus(state, `Nao foi possivel abrir o arquivo: ${error || 'erro desconhecido'}`);
  });

  fields.showInFolderBtn.addEventListener('click', async () => {
    if (!state.outputPath) return;
    await window.api.showInFolder({ filePath: state.outputPath });
  });

  fields.cancelBtn.addEventListener('click', async () => {
    if (state.jobId) {
      await window.api.queueCancel(state.jobId);
      setStatus(state, 'Solicitando cancelamento...');
      appendLog(state, 'Solicitando cancelamento...');
      return; // o evento queue:cancel finaliza a UI da aba
    }
    // Job ainda não criado: cancela por taskId (compatibilidade).
    await window.api.cancelDownload({ taskId: state.taskId });
    cancelTabDownload(state);
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
  if (tab.busy || tab.jobState === 'active' || tab.jobState === 'queued') {
    setStatus(tab, 'Cancele o download antes de excluir esta aba.');
    return;
  }
  if (tab.jobId) {
    window.api.queueCancel(tab.jobId).catch(() => {});
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

function renderMediaInfo(state) {
  const media = state.media;
  const fields = state.fields;
  if (!media) {
    fields.metadata.hidden = true;
    return;
  }
  fields.metadata.hidden = false;
  fields.metaTitle.textContent = media.title || 'Video';
  fields.metaDuration.textContent = media.durationLabel || '—';
  const providerBits = [media.provider, media.protocol].filter(Boolean).join(' · ');
  fields.metaProvider.textContent = providerBits || '—';
  fields.metaCodec.textContent = [media.resolution, media.codecs].filter(Boolean).join(' · ') || '—';
  fields.metaBitrate.textContent = media.bitrateLabel || '—';
  fields.metaSize.textContent = media.estimatedSizeLabel || '—';
  const thumb = fields.thumbnail;
  if (media.thumbnail && /^https?:\/\//i.test(media.thumbnail)) {
    thumb.src = media.thumbnail;
    thumb.hidden = false;
  } else {
    thumb.removeAttribute('src');
    thumb.hidden = true;
  }
}

// P11 (itens 1-2): enfileira na fila real via IPC queue:enqueue. Nenhuma
// dependencia de runCliSession/createAnswerBook — o progresso chega pelos
// eventos queue:event do engine (start/progress/complete/error/cancel).
async function enqueueForTab(state, { lockNow }) {
  const fields = state.fields;
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
  const qualityChoice = state.qualities.length
    ? String(Math.max(1, (state.qualities.findIndex((q) => q.uri === state.selectedVariantUri) + 1) || 1))
    : '';

  state.outputPath = fullOutput;
  activeOutputs.set(fullOutput, state.taskId);
  refreshResolvedOutput(state);

  const result = await window.api.queueEnqueue({
    url: state.sourceUrl || url,
    filename,
    outputDir,
    selectedUrl: state.selectedQuality || '',
    title: state.media?.title || chosenQuality?.resolution || 'video',
    turbo: fields.turbo?.checked === true,
    qualityChoice,
    taskId: state.taskId,
  });

  if (!result || !result.ok) {
    activeOutputs.delete(fullOutput);
    setStatus(state, `Nao foi possivel enfileirar: ${result?.error || 'erro desconhecido'}`);
    appendLog(state, `ERRO ao enfileirar: ${result?.error || 'erro desconhecido'}`);
    return;
  }

  // Mantém o vínculo aba ↔ job: os eventos do engine carregam meta.taskId.
  state.jobId = result.jobId;
  state.jobState = 'queued';
  if (lockNow) {
    resetProgress(state);
    lockTab(state, true);
    setActiveStep(state, 'download');
    markAllPreviousAsDone(state, 'download');
    state.fields.modeLabel.textContent = 'Na fila — aguardando vaga';
    setStatus(state, 'Download adicionado à fila. Iniciando assim que houver vaga...');
  } else {
    setStatus(state, 'Adicionado à fila — progresso em Fila / Histórico.');
  }
  appendLog(
    state,
    [
      '==============================================',
      'StreamGrab - HLS / DASH / YouTube / Redes sociais',
      '==============================================',
      '',
      `URL reconhecida: ${url}`,
      state.qualities.length
        ? `Formato escolhido: ${chosenQuality?.resolution || state.selectedQuality || 'melhor disponivel'}`
        : 'Playlist unica detectada.',
      `Salvando em: ${fullOutput}`,
      `Fila: jobId=${state.jobId}`,
    ].join('\n')
  );
  refreshQueuePanel();
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

function lockTab(state, busy) {
  state.busy = busy;
  state.fields.analyzeBtn.disabled = busy;
  state.fields.downloadBtn.disabled = busy;
  state.fields.enqueueBtn.disabled = busy;
  state.fields.url.disabled = busy;
  state.fields.filename.disabled = busy;
  state.fields.outputDir.disabled = busy;
  state.fields.pickDirBtn.disabled = busy;
  state.fields.qualities.querySelectorAll('button').forEach((btn) => {
    btn.disabled = busy;
  });
  // Cancelar continua habilitado enquanto o job estiver ativo ou aguardando vaga.
  const cancelable = busy || state.jobState === 'active' || state.jobState === 'queued';
  state.fields.cancelBtn.disabled = !cancelable;
  state.closeBtn.disabled = busy || state.jobState === 'active';
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

// ===========================================================================
// P11 — Fila real, Histórico e Configurações (itens 2-5 do ajuste)
// ===========================================================================

const QUEUE_STATE_LABELS = {
  queued: 'Aguardando',
  analyzing: 'Analisando',
  preparing: 'Preparando',
  downloading: 'Baixando',
  paused: 'Pausado',
  merging: 'Mesclando',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_STATES = new Set(['analyzing', 'preparing', 'downloading', 'merging']);

// jobId -> percent, alimentado pelos eventos do engine (a fila não guarda %).
const jobProgress = new Map();

function findTabForJob(payload) {
  if (!payload) return null;
  if (payload.taskId) {
    const byTask = tabs.get(payload.taskId);
    if (byTask) return byTask;
  }
  if (payload.jobId) {
    for (const t of tabs.values()) {
      if (t.jobId === payload.jobId) return t;
    }
  }
  return null;
}

function handleQueueEvent(event, payload) {
  payload = payload || {};
  const tab = findTabForJob(payload);

  if (payload.jobId && typeof payload.percent === 'number') {
    jobProgress.set(payload.jobId, payload.percent);
  }

  switch (event) {
    case 'started':
      if (tab) {
        tab.jobId = payload.jobId || tab.jobId;
        tab.jobState = 'active';
        if (tab.busy) {
          tab.panel.classList.add('downloading');
          setActiveStep(tab, 'download');
          markAllPreviousAsDone(tab, 'download');
          setStatus(tab, payload.message || 'Baixando...');
        }
      }
      break;
    case 'start':
    case 'progress':
      if (tab && tab.busy) applyProgress(tab, payload);
      break;
    case 'speed':
      if (tab && tab.busy && payload.speed != null && payload.speed !== '') {
        // engine reporta bytes/s; formatKbps espera bits/s.
        tab.metrics.speed = formatKbps(Number(payload.speed) * 8) || 'N/A';
        syncMetrics(tab);
      }
      break;
    case 'eta':
      if (tab && tab.busy && payload.etaSeconds != null) {
        tab.metrics.time = formatDuration(payload.etaSeconds);
        syncMetrics(tab);
      }
      break;
    case 'pause':
      if (tab) {
        tab.jobState = 'paused';
        if (tab.busy) {
          tab.panel.classList.remove('downloading');
          setStatus(tab, 'Pausado. Retome pela Fila ou pelo botão da aba.');
          appendLog(tab, 'Download pausado.');
        }
      }
      break;
    case 'resume':
      if (tab) {
        tab.jobState = 'active';
        if (tab.busy) {
          tab.panel.classList.add('downloading');
          setStatus(tab, 'Retomando download...');
          appendLog(tab, 'Download retomado.');
        }
      }
      break;
    case 'complete':
      if (tab) finishTabDownload(tab, payload);
      break;
    case 'error':
      if (tab) failTabDownload(tab, payload);
      break;
    case 'cancel':
      if (tab) cancelTabDownload(tab, payload);
      break;
    default:
      break;
  }

  refreshQueuePanel();
  if (event === 'complete' || event === 'error' || event === 'cancel') {
    refreshHistoryPanel();
  }
}

function applyProgress(tab, payload) {
  const pct = Number(payload.percent);
  if (Number.isFinite(pct) && pct > 0) {
    const capped = Math.min(99, pct);
    tab.fields.progress.style.width = `${capped}%`;
    tab.fields.percent.textContent = `${Math.floor(capped)}%`;
  }
  if (payload.bytesDownloaded != null) {
    tab.metrics.size = formatBytes(payload.bytesDownloaded);
    if (payload.totalBytes) tab.fields.progress.dataset.total = formatBytes(payload.totalBytes);
  } else if (payload.downloaded != null) {
    tab.metrics.size = formatBytes(payload.downloaded);
  }
  syncMetrics(tab);
  setActiveStep(tab, 'download');
  markAllPreviousAsDone(tab, 'download');
  if (payload.message) {
    setStatus(tab, payload.message);
  } else if (Number.isFinite(pct) && pct > 0) {
    setStatus(tab, `Baixando... ${Math.floor(Math.min(99, pct))}%`);
  } else {
    setStatus(tab, 'Baixando...');
  }
  if (payload.stage && payload.message) appendLog(tab, `[${payload.stage}] ${payload.message}`);
}

function finishTabDownload(tab, payload) {
  const output = payload.output || tab.outputPath;
  tab.outputPath = output;
  tab.jobState = 'terminal';
  releaseOutput(tab.outputPath, tab.taskId);
  tab.panel.classList.remove('downloading');
  lockTab(tab, false);
  tab.fields.progress.style.width = '100%';
  tab.fields.percent.textContent = '100%';
  tab.fields.modeLabel.textContent = 'Download concluído';
  setStatus(tab, 'Download concluído!');
  if (output) tab.fields.resolvedOutput.textContent = output;
  appendLog(tab, `Download concluído! ${output}`);
  markAllPreviousAsDone(tab, 'download');
  if (output) tab.fields.revealRow.hidden = false;
}

function failTabDownload(tab, payload) {
  tab.jobState = 'terminal';
  releaseOutput(tab.outputPath, tab.taskId);
  tab.panel.classList.remove('downloading');
  lockTab(tab, false);
  tab.fields.progress.style.width = '0%';
  tab.fields.percent.textContent = '0%';
  tab.fields.modeLabel.textContent = 'Falha no download';
  const message = payload.message || 'O download não pôde ser concluído.';
  setStatus(tab, `Falha: ${message}`);
  appendLog(tab, `ERRO: ${message}`);
  if (payload.suggestedAction) appendLog(tab, `Ação sugerida: ${payload.suggestedAction}`);
  if (payload.detail) appendLog(tab, `Detalhes: ${payload.detail}`);
}

function cancelTabDownload(tab, payload) {
  tab.jobState = 'terminal';
  releaseOutput(tab.outputPath, tab.taskId);
  tab.panel.classList.remove('downloading');
  lockTab(tab, false);
  tab.fields.progress.style.width = '0%';
  tab.fields.percent.textContent = '0%';
  tab.fields.modeLabel.textContent = 'Cancelado';
  setStatus(tab, (payload && payload.message) || 'Download cancelado.');
  appendLog(tab, (payload && payload.message) || 'Download cancelado.');
  tab.fields.revealRow.hidden = true;
}

function formatDuration(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// --- Fila -------------------------------------------------------------------

async function refreshQueuePanel() {
  const listEl = document.getElementById('queueList');
  if (!listEl) return;
  const emptyEl = document.getElementById('queueEmpty');
  const summaryEl = document.getElementById('queueSummary');
  const badgeEl = document.getElementById('queueBadge');
  const toggleBtn = document.getElementById('queueTogglePauseBtn');

  let data;
  try {
    data = await window.api.queueList();
  } catch {
    return;
  }
  const jobs = data.jobs || [];
  const activeCount = jobs.filter((j) => ACTIVE_STATES.has(j.state)).length;
  const nonTerminal = jobs.filter((j) => !TERMINAL_STATES.has(j.state));

  if (badgeEl) {
    badgeEl.hidden = nonTerminal.length === 0;
    badgeEl.textContent = String(nonTerminal.length);
  }
  if (toggleBtn) toggleBtn.textContent = data.paused ? 'Retomar fila' : 'Pausar fila';
  if (summaryEl) {
    summaryEl.textContent =
      `${activeCount}/${data.maxConcurrent} ativos · ${nonTerminal.length} na fila · ` +
      `${jobs.length - nonTerminal.length} concluídos/falhos/cancelados`;
  }
  if (emptyEl) emptyEl.hidden = jobs.length > 0;
  listEl.innerHTML = '';
  for (const job of jobs) listEl.appendChild(renderQueueItem(job));
}

function renderQueueItem(job) {
  const item = document.createElement('div');
  item.className = 'queue-item';
  item.dataset.jobId = job.id;

  const state = job.state;
  const terminal = TERMINAL_STATES.has(state);
  const percent = Math.min(100, jobProgress.get(job.id) || 0);
  const totalBytes = Number(job.meta?.totalBytes) || 0;

  const head = document.createElement('div');
  head.className = 'queue-item-head';

  const titleWrap = document.createElement('div');
  titleWrap.style.minWidth = '0';
  const title = document.createElement('div');
  title.className = 'queue-item-title';
  title.textContent = job.meta?.filename || job.title || 'Download';
  const sub = document.createElement('div');
  sub.className = 'queue-item-url';
  sub.textContent = job.meta?.sourceUrl || job.url || '';
  titleWrap.append(title, sub);

  const statePill = document.createElement('span');
  statePill.className = 'job-state';
  statePill.dataset.state = state;
  statePill.textContent = QUEUE_STATE_LABELS[state] || state;

  head.append(titleWrap, statePill);
  item.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'queue-item-meta';
  const bits = [`id: ${job.id}`];
  if (!terminal) bits.push(`${Math.floor(percent)}%`);
  if (totalBytes > 0) bits.push(formatBytes(totalBytes));
  if (state === 'failed' && job.error?.message) bits.push(job.error.message);
  meta.textContent = bits.join(' · ');
  item.appendChild(meta);

  if (!terminal && state !== 'paused' && percent > 0) {
    const mini = document.createElement('div');
    mini.className = 'mini-progress';
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    const fill = document.createElement('span');
    fill.style.width = `${percent}%`;
    bar.appendChild(fill);
    mini.appendChild(bar);
    item.appendChild(mini);
  }

  if (state === 'failed' && job.error?.message) {
    const err = document.createElement('div');
    err.className = 'queue-item-error';
    err.textContent = job.error.message;
    if (job.error.code) err.textContent += ` (${job.error.code})`;
    item.appendChild(err);
  }

  const actions = document.createElement('div');
  actions.className = 'queue-item-actions';
  const act = (label, fn) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button button-ghost';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      fn().catch(() => {});
      refreshQueuePanel();
    });
    actions.appendChild(btn);
  };

  if (state === 'queued') {
    act('Cancelar', () => window.api.queueCancel(job.id));
  } else if (state === 'downloading' || state === 'analyzing' || state === 'preparing' || state === 'merging') {
    act('Pausar', () => window.api.queuePause(job.id));
    act('Cancelar', () => window.api.queueCancel(job.id));
  } else if (state === 'paused') {
    act('Retomar', () => window.api.queueResume(job.id));
    act('Cancelar', () => window.api.queueCancel(job.id));
  } else if (terminal) {
    if (state === 'completed' && job.meta?.output) {
      act('Abrir arquivo', () => window.api.openFile({ filePath: job.meta.output }));
      act('Mostrar na pasta', () => window.api.showInFolder({ filePath: job.meta.output }));
    }
    if (state === 'failed' || state === 'cancelled') {
      act('Tentar novamente', () => window.api.queueRetry(job.id));
    }
    act('Remover', () => window.api.queueRemove(job.id));
  }
  item.appendChild(actions);
  return item;
}

// --- Histórico ---------------------------------------------------------------

async function refreshHistoryPanel() {
  const listEl = document.getElementById('historyList');
  if (!listEl) return;
  const emptyEl = document.getElementById('historyEmpty');
  const summaryEl = document.getElementById('historySummary');

  let entries;
  try {
    entries = await window.api.historyList();
  } catch {
    return;
  }
  const list = entries || [];
  if (summaryEl) summaryEl.textContent = `${list.length} registros`;
  if (emptyEl) emptyEl.hidden = list.length > 0;
  listEl.innerHTML = '';
  for (const entry of list) listEl.appendChild(renderHistoryItem(entry));
}

function renderHistoryItem(entry) {
  const item = document.createElement('div');
  item.className = 'queue-item';

  const head = document.createElement('div');
  head.className = 'queue-item-head';

  const titleWrap = document.createElement('div');
  titleWrap.style.minWidth = '0';
  const title = document.createElement('div');
  title.className = 'queue-item-title';
  title.textContent = entry.title || entry.url;
  const sub = document.createElement('div');
  sub.className = 'queue-item-url';
  sub.textContent = entry.url || '';
  titleWrap.append(title, sub);

  const statePill = document.createElement('span');
  statePill.className = 'job-state';
  statePill.dataset.state = entry.status || 'completed';
  statePill.textContent = QUEUE_STATE_LABELS[entry.status] || entry.status || 'Concluído';

  head.append(titleWrap, statePill);
  item.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'queue-item-meta';
  const bits = [];
  if (entry.date) bits.push(formatDate(entry.date));
  if (entry.provider) bits.push(entry.provider);
  if (entry.format) bits.push(entry.format);
  if (entry.size) bits.push(formatBytes(entry.size));
  if (entry.destination) bits.push(entry.destination);
  meta.textContent = bits.join(' · ');
  item.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'queue-item-actions';
  const act = (label, fn) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button button-ghost';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      fn().catch(() => {});
      refreshHistoryPanel();
      refreshQueuePanel();
    });
    actions.appendChild(btn);
  };

  if (entry.destination) {
    act('Abrir arquivo', () => window.api.openFile({ filePath: entry.destination }));
    act('Mostrar na pasta', () => window.api.showInFolder({ filePath: entry.destination }));
  }
  act('Baixar de novo', () => window.api.historyRedownload(entry.id));
  act('Remover', () => window.api.historyRemove(entry.id));
  item.appendChild(actions);
  return item;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return String(iso);
  }
}

// --- Configurações ------------------------------------------------------------

async function renderSettingsPanel() {
  const form = document.getElementById('settingsForm');
  if (!form) return;
  let settings;
  try {
    settings = await window.api.settingsGet();
  } catch {
    return;
  }
  for (const input of form.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    const value = settings[key];
    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else if (input.type === 'number') {
      input.value = value == null ? '' : String(value);
    } else {
      input.value = value == null ? '' : String(value);
    }
  }
}

function collectSettingsForm() {
  const form = document.getElementById('settingsForm');
  const partial = {};
  for (const input of form.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    if (input.type === 'checkbox') {
      partial[key] = input.checked;
    } else if (input.type === 'number') {
      const n = Number(input.value);
      partial[key] = Number.isFinite(n) ? n : null;
    } else {
      partial[key] = input.value.trim();
    }
  }
  return partial;
}

function settingsStatus(text, ok = true) {
  const el = document.querySelector('[data-field="settingsStatus"]');
  if (el) {
    el.textContent = text;
    el.style.color = ok ? 'var(--accent)' : 'var(--danger)';
  }
}

// --- Navegação ---------------------------------------------------------------

const VIEWS = ['videos', 'queue', 'history', 'settings'];

function switchView(name) {
  if (!VIEWS.includes(name)) return;
  for (const viewName of VIEWS) {
    const view = document.getElementById(`view-${viewName}`);
    const btn = document.getElementById(
      { videos: 'viewVideosBtn', queue: 'viewQueueBtn', history: 'viewHistoryBtn', settings: 'viewSettingsBtn' }[viewName]
    );
    if (view) view.hidden = viewName !== name;
    if (btn) btn.classList.toggle('active', viewName === name);
  }
  if (name === 'queue') refreshQueuePanel();
  if (name === 'history') refreshHistoryPanel();
  if (name === 'settings') renderSettingsPanel();
}

function initializePanels() {
  const wire = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };

  wire('viewVideosBtn', () => switchView('videos'));
  wire('viewQueueBtn', () => switchView('queue'));
  wire('viewHistoryBtn', () => switchView('history'));
  wire('viewSettingsBtn', () => switchView('settings'));

  wire('queueRefreshBtn', () => refreshQueuePanel());
  wire('queueTogglePauseBtn', async () => {
    const btn = document.getElementById('queueTogglePauseBtn');
    const shouldPause = btn?.textContent.trim() === 'Pausar fila';
    await window.api.queueSetPaused(shouldPause);
    refreshQueuePanel();
  });

  wire('historyRefreshBtn', () => refreshHistoryPanel());
  wire('historyClearBtn', async () => {
    await window.api.historyClear();
    refreshHistoryPanel();
  });

  wire('settingsSaveBtn', async () => {
    const partial = collectSettingsForm();
    const res = await window.api.settingsUpdate(partial);
    if (res?.ok) {
      settingsStatus('Configurações salvas.');
      // Aplica o tema escolhido imediatamente.
      if (partial.theme === 'light' || partial.theme === 'dark') {
        localStorage.setItem('vd-theme', partial.theme);
        applyTheme(partial.theme);
      }
      refreshQueuePanel();
    } else {
      settingsStatus(res?.error || 'Falha ao salvar.', false);
    }
  });
  wire('settingsResetBtn', async () => {
    await window.api.settingsReset();
    await renderSettingsPanel();
    settingsStatus('Configurações restauradas para o padrão.');
  });
  wire('settingsPickDirBtn', async () => {
    const picked = await window.api.pickOutputDir();
    if (picked) {
      const input = document.querySelector('[data-setting="defaultDir"]');
      if (input) input.value = picked;
    }
  });

  // Atualiza o painel de fila ao alternar para a aba "Fila".
  refreshQueuePanel();
  refreshHistoryPanel();
  renderSettingsPanel();
}

initializePanels();
