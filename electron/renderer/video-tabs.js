import {
  appendLog,
  formatBytes,
  formatDuration,
  formatKbps,
  formatUiError,
  lockTab,
  markAllPreviousAsDone,
  refreshResolvedOutput,
  releaseOutput,
  resetProgress,
  resolveDesiredFilename,
  setActiveStep,
  setStatus,
  syncMetrics,
} from './shared.js';

export function createVideoTabsController({ appState, dom, onQueueRefresh, onHistoryRefresh }) {
  const jobProgress = new Map();

  function collectTabFields(panel) {
    return {
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
      audioSubtitleSection: panel.querySelector('[data-field="audioSubtitleSection"]'),
      audioTracksContainer: panel.querySelector('[data-field="audioTracksContainer"]'),
      audioTrackSelect: panel.querySelector('[data-field="audioTrackSelect"]'),
      allAudio: panel.querySelector('[data-field="allAudio"]'),
      subtitleTracksContainer: panel.querySelector('[data-field="subtitleTracksContainer"]'),
      subtitleCheckboxes: panel.querySelector('[data-field="subtitleCheckboxes"]'),
      embedSubs: panel.querySelector('[data-field="embedSubs"]'),
      noTracksMessage: panel.querySelector('[data-field="noTracksMessage"]'),
    };
  }

  function createTabState({ id, tabButton, closeBtn, panel, fields }) {
    return {
      id,
      taskId: id,
      tabButton,
      closeBtn,
      panel,
      fields,
      selectedQuality: null,
      selectedVariantUri: '',
      qualities: [],
      audioTracks: [],
      subtitleTracks: [],
      sourceUrl: '',
      analysisBaseUrl: '',
      media: null,
      busy: false,
      duration: 0,
      outputPath: '',
      jobId: '',
      jobState: '',
      metrics: {
        time: '--:--:--',
        size: '0 B',
        speed: 'N/A',
      },
      steps: Object.fromEntries(
        [...panel.querySelectorAll('[data-step]')].map((node) => [node.dataset.step, node])
      ),
    };
  }

  function addTab({ copyFrom } = {}) {
    const id = `tab-${appState.counter++}`;
    const label = `Video ${appState.counter - 1}`;

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

    const panel = dom.tabTemplate.content.firstElementChild.cloneNode(true);
    const fields = collectTabFields(panel);
    fields.outputDir.value = appState.defaultOutputDir;

    if (copyFrom) {
      fields.url.value = copyFrom.fields.url.value || '';
      fields.filename.value = copyFrom.fields.filename.value || '';
      fields.outputDir.value = copyFrom.fields.outputDir.value || appState.defaultOutputDir;
      if (copyFrom.fields.turbo?.checked) fields.turbo.checked = true;
    }

    const state = createTabState({ id, tabButton, closeBtn, panel, fields });
    wireTabEvents(state);

    appState.tabs.set(id, state);
    dom.tabBar.appendChild(tabButton);
    dom.tabPanels.appendChild(panel);
    refreshResolvedOutput(state, appState.defaultOutputDir);
    syncMetrics(state);
    activateTab(id);
  }

  function activateTab(id) {
    appState.activeTabId = id;
    for (const [tabId, tab] of appState.tabs) {
      tab.tabButton.classList.toggle('active', tabId === id);
      tab.panel.classList.toggle('active', tabId === id);
    }
  }

  function removeTab(id) {
    const tab = appState.tabs.get(id);
    if (!tab) return;
    if (tab.busy || tab.jobState === 'active' || tab.jobState === 'queued') {
      setStatus(tab, 'Cancele o download antes de excluir esta aba.');
      return;
    }
    if (tab.jobId) window.api.queueCancel(tab.jobId).catch(() => {});

    releaseOutput(appState.activeOutputs, tab.outputPath, tab.taskId);
    tab.tabButton.remove();
    tab.panel.remove();
    appState.tabs.delete(id);

    if (!appState.tabs.size) {
      addTab();
      return;
    }

    if (appState.activeTabId === id) {
      activateTab(appState.tabs.keys().next().value);
    }
  }

  function wireTabEvents(state) {
    const { fields } = state;

    fields.url.addEventListener('input', () => {
      if (fields.url.value.trim()) {
        setActiveStep(state, 'url');
        markAllPreviousAsDone(state, 'url');
      }
    });

    fields.filename.addEventListener('input', () => {
      refreshResolvedOutput(state, appState.defaultOutputDir);
      if (fields.filename.value.trim()) {
        setActiveStep(state, 'file');
        markAllPreviousAsDone(state, 'file');
      }
    });

    fields.outputDir.addEventListener('input', () => {
      refreshResolvedOutput(state, appState.defaultOutputDir);
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
        refreshResolvedOutput(state, appState.defaultOutputDir);
        setActiveStep(state, 'dir');
        markAllPreviousAsDone(state, 'dir');
      }
    });

    fields.analyzeBtn.addEventListener('click', async () => {
      await analyzeTab(state);
    });

    fields.downloadBtn.addEventListener('click', async () => {
      if (state.busy) return;
      await enqueueForTab(state, { lockNow: true });
    });

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
        return;
      }
      await window.api.cancelDownload({ taskId: state.taskId });
      cancelTabDownload(state);
    });
  }

  async function analyzeTab(state) {
    if (state.busy) return;

    const url = state.fields.url.value.trim();
    if (!url) {
      setStatus(state, 'Nenhuma URL informada.');
      return;
    }

    setActiveStep(state, 'url');
    markAllPreviousAsDone(state, 'url');
    resetProgress(state);
    state.fields.revealRow.hidden = true;
    setStatus(state, 'Analisando playlist...');
    state.fields.modeLabel.textContent = 'Analise de playlist em andamento';
    state.fields.log.textContent = [
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
      if (info && info.ok === false) {
        const err = info.error || {};
        setStatus(state, `Erro ao analisar: ${err.message || 'falha desconhecida'}`);
        appendLog(state, `[ERRO] ${err.message || 'falha desconhecida'}`);
        if (err.suggestedAction) appendLog(state, `Acao sugerida: ${err.suggestedAction}`);
        if (err.detail) appendLog(state, `Detalhes: ${err.detail}`);
        state.fields.modeLabel.textContent = 'Falha na analise';
        return;
      }

      state.sourceUrl = info.workingUrl || url;
      state.analysisBaseUrl = info.baseUrl || info.media?.baseUrl || url;
      state.media = info.media || null;
      state.audioTracks = info.media?.audioTracks || info.audioTracks || [];
      state.subtitleTracks = info.media?.subtitleTracks || info.subtitleTracks || [];
      renderMediaInfo(state);
      renderAudioSubtitleTracks(state);

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
        setStatus(state, `Formatos encontrados${title}. Se nada for escolhido, a melhor disponivel sera usada.`);
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
        renderQualities(
          state,
          info.kind === 'direct'
            ? 'Arquivo direto detectado. O CLI seguira direto para o download.'
            : 'Playlist unica detectada. O CLI seguiria direto para o download.'
        );
        setActiveStep(state, 'file');
        markAllPreviousAsDone(state, 'file');
        setStatus(state, info.kind === 'direct' ? 'Arquivo direto pronto para download.' : 'Playlist pronta para download.');
        appendLog(state, info.kind === 'direct' ? 'Arquivo direto detectado.' : 'Playlist unica detectada.');
      }

      refreshResolvedOutput(state, appState.defaultOutputDir);
    } catch (err) {
      setStatus(state, `Erro ao analisar: ${err.message}`);
      appendLog(state, `[ERRO] ${err.message}`);
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
    if (media.thumbnail && /^https?:\/\//i.test(media.thumbnail)) {
      fields.thumbnail.src = media.thumbnail;
      fields.thumbnail.hidden = false;
    } else {
      fields.thumbnail.removeAttribute('src');
      fields.thumbnail.hidden = true;
    }
  }


  async function enqueueForTab(state, { lockNow }) {
    const url = state.fields.url.value.trim();
    if (!url) {
      setStatus(state, 'Nenhuma URL informada.');
      return;
    }

    const outputDir = (state.fields.outputDir.value.trim() || appState.defaultOutputDir || '').trim();
    const filename = resolveDesiredFilename(state);
    const fullOutput = outputDir ? `${outputDir}\\${filename}` : filename;
    const conflict = appState.activeOutputs.get(fullOutput);

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
    appState.activeOutputs.set(fullOutput, state.taskId);
    refreshResolvedOutput(state, appState.defaultOutputDir);

    const result = await window.api.queueEnqueue({
      url: state.sourceUrl || url,
      filename,
      outputDir,
      selectedUrl: state.selectedQuality || '',
      title: state.media?.title || chosenQuality?.resolution || 'video',
      turbo: state.fields.turbo?.checked === true,
      qualityChoice,
      taskId: state.taskId,
      audioLanguage: state.selectedAudioLanguage || '',
      allAudio: state.fields.allAudio?.checked === true,
      subtitleLanguages: state.selectedSubtitleLanguages || [],
      embedSubs: state.fields.embedSubs?.checked === true,
    });

    if (!result || !result.ok) {
      appState.activeOutputs.delete(fullOutput);
      const errorText = formatUiError(result?.error);
      setStatus(state, `Nao foi possivel enfileirar: ${errorText}`);
      appendLog(state, `ERRO ao enfileirar: ${errorText}`);
      return;
    }

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
          : state.media?.sourceType === 'direct'
            ? 'Arquivo direto detectado.'
            : 'Playlist unica detectada.',
        `Salvando em: ${fullOutput}`,
        `Fila: jobId=${state.jobId}`,
      ].join('\n')
    );
    onQueueRefresh();
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

  function renderAudioSubtitleTracks(state) {
    const { audioTracks, subtitleTracks } = state;
    const section = state.fields.audioSubtitleSection;
    const audioContainer = state.fields.audioTracksContainer;
    const subtitleContainer = state.fields.subtitleTracksContainer;
    const noTracksMsg = state.fields.noTracksMessage;
    const audioSelect = state.fields.audioTrackSelect;
    const subtitleBoxes = state.fields.subtitleCheckboxes;

    const hasAudio = audioTracks.length > 1;
    const hasSubs = subtitleTracks.length > 0;

    if (!hasAudio && !hasSubs) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    if (hasAudio) {
      audioContainer.hidden = false;
      noTracksMsg.hidden = true;
      audioSelect.innerHTML = '';
      audioTracks.forEach((track) => {
        const opt = document.createElement('option');
        opt.value = track.language;
        opt.textContent = `${track.label || track.language}${track.isDefault ? ' (padrao)' : ''}`;
        if (track.isDefault) opt.selected = true;
        audioSelect.appendChild(opt);
      });
      audioSelect.onchange = () => {
        state.selectedAudioLanguage = audioSelect.value;
      };
      state.selectedAudioLanguage = audioSelect.value;
    } else {
      audioContainer.hidden = true;
    }

    if (hasSubs) {
      subtitleContainer.hidden = false;
      noTracksMsg.hidden = true;
      subtitleBoxes.innerHTML = '';
      subtitleTracks.forEach((track) => {
        const label = document.createElement('label');
        label.className = 'checkbox-inline';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = track.language;
        cb.checked = track.isDefault;
        cb.addEventListener('change', () => {
          state.selectedSubtitleLanguages = [...subtitleBoxes.querySelectorAll('input:checked')].map((el) => el.value);
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(` ${track.label || track.language}${track.isAutoGenerated ? ' (auto)' : ''}`));
        subtitleBoxes.appendChild(label);
      });
      state.selectedSubtitleLanguages = [...subtitleBoxes.querySelectorAll('input:checked')].map((el) => el.value);
    } else {
      subtitleContainer.hidden = true;
    }
  }

  function findTabForJob(payload) {
    if (!payload) return null;
    if (payload.taskId) {
      const byTask = appState.tabs.get(payload.taskId);
      if (byTask) return byTask;
    }
    if (payload.jobId) {
      for (const tab of appState.tabs.values()) {
        if (tab.jobId === payload.jobId) return tab;
      }
    }
    return null;
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
    if (payload.message) setStatus(tab, payload.message);
    else if (Number.isFinite(pct) && pct > 0) setStatus(tab, `Baixando... ${Math.floor(Math.min(99, pct))}%`);
    else setStatus(tab, 'Baixando...');
    if (payload.stage && payload.message) appendLog(tab, `[${payload.stage}] ${payload.message}`);
  }

  function finishTabDownload(tab, payload) {
    const output = payload.output || tab.outputPath;
    tab.outputPath = output;
    tab.jobState = 'terminal';
    releaseOutput(appState.activeOutputs, tab.outputPath, tab.taskId);
    tab.panel.classList.remove('downloading');
    lockTab(tab, false);
    tab.fields.progress.style.width = '100%';
    tab.fields.percent.textContent = '100%';
    tab.fields.modeLabel.textContent = 'Download concluido';
    setStatus(tab, 'Download concluido!');
    if (output) tab.fields.resolvedOutput.textContent = output;
    appendLog(tab, `Download concluido! ${output}`);
    markAllPreviousAsDone(tab, 'download');
    if (output) tab.fields.revealRow.hidden = false;
  }

  function failTabDownload(tab, payload) {
    tab.jobState = 'terminal';
    releaseOutput(appState.activeOutputs, tab.outputPath, tab.taskId);
    tab.panel.classList.remove('downloading');
    lockTab(tab, false);
    tab.fields.progress.style.width = '0%';
    tab.fields.percent.textContent = '0%';
    tab.fields.modeLabel.textContent = 'Falha no download';
    const message = payload.message || 'O download nao pode ser concluido.';
    setStatus(tab, `Falha: ${message}`);
    appendLog(tab, `ERRO: ${message}`);
    if (payload.suggestedAction) appendLog(tab, `Acao sugerida: ${payload.suggestedAction}`);
    if (payload.detail) appendLog(tab, `Detalhes: ${payload.detail}`);
  }

  function cancelTabDownload(tab, payload) {
    tab.jobState = 'terminal';
    releaseOutput(appState.activeOutputs, tab.outputPath, tab.taskId);
    tab.panel.classList.remove('downloading');
    lockTab(tab, false);
    tab.fields.progress.style.width = '0%';
    tab.fields.percent.textContent = '0%';
    tab.fields.modeLabel.textContent = 'Cancelado';
    setStatus(tab, payload?.message || 'Download cancelado.');
    appendLog(tab, payload?.message || 'Download cancelado.');
    tab.fields.revealRow.hidden = true;
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
      case 'log':
        if (tab && payload.message) appendLog(tab, payload.message);
        break;
      case 'pause':
        if (tab) {
          tab.jobState = 'paused';
          if (tab.busy) {
            tab.panel.classList.remove('downloading');
            setStatus(tab, 'Pausado. Retome pela Fila ou pelo botao da aba.');
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

    onQueueRefresh();
    if (event === 'complete' || event === 'error' || event === 'cancel') {
      onHistoryRefresh();
    }
  }

  function setDefaultOutputDir(dir) {
    appState.defaultOutputDir = dir || '';
    for (const tab of appState.tabs.values()) {
      if (!tab.fields.outputDir.value) tab.fields.outputDir.value = appState.defaultOutputDir;
      refreshResolvedOutput(tab, appState.defaultOutputDir);
    }
  }

  return {
    addTab,
    activateTab,
    handleQueueEvent,
    jobProgress,
    setDefaultOutputDir,
  };
}
