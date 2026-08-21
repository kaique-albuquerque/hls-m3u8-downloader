export const STEP_ORDER = ['ffmpeg', 'url', 'variant', 'file', 'dir', 'download'];

export function setStatus(state, text) {
  state.fields.status.textContent = text;
}

export function appendLog(tab, line) {
  const content = [tab.fields.log.textContent, line].filter(Boolean).join('\n');
  const lines = content.split('\n').slice(-240);
  tab.fields.log.textContent = lines.join('\n');
  tab.fields.log.scrollTop = tab.fields.log.scrollHeight;
}

export function sanitizeFilename(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[.\s]+$/g, '')
    .replace(/^[.\s]+/g, '');
  return cleaned || 'video';
}

export function detectExtensionFromUrl(value) {
  try {
    const pathname = new URL(String(value || '')).pathname || '';
    const match = pathname.match(/\.([A-Za-z0-9]{1,12})$/);
    return match ? `.${match[1].toLowerCase()}` : '';
  } catch {
    return '';
  }
}

export function resolvePreferredExtension(state) {
  const container = String(state.media?.container || '').trim().toLowerCase();
  if (container && /^[a-z0-9]{1,12}$/.test(container)) return `.${container}`;
  return detectExtensionFromUrl(state.selectedQuality || state.sourceUrl || state.fields.url.value.trim()) || '.mp4';
}

export function ensureExpectedExtension(name, ext) {
  return name.toLowerCase().endsWith(ext.toLowerCase()) ? name : `${name}${ext}`;
}

export function resolveDesiredFilename(state) {
  const typed = state.fields.filename.value.trim();
  const fallbackBase = state.media?.title || (state.media?.sourceType === 'direct' ? 'arquivo' : 'video');
  const baseName = sanitizeFilename(typed || fallbackBase);
  return ensureExpectedExtension(baseName, resolvePreferredExtension(state));
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatKbps(bandwidth) {
  const n = Number(bandwidth) || 0;
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(n / 1000)} Kbps`;
}

export function formatDuration(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return String(iso);
  }
}

export function formatUiError(error) {
  if (!error) return 'erro desconhecido';
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim();
  return String(error);
}

export function syncMetrics(state) {
  state.fields.timeValue.textContent = state.metrics.time;
  state.fields.sizeValue.textContent = state.metrics.size;
  state.fields.speedValue.textContent = state.metrics.speed;
}

export function resetProgress(state) {
  state.metrics = {
    time: '--:--:--',
    size: '0 B',
    speed: 'N/A',
  };
  state.fields.progress.style.width = '0%';
  state.fields.percent.textContent = '0%';
  syncMetrics(state);
}

export function setActiveStep(state, activeStep) {
  STEP_ORDER.forEach((step) => {
    const node = state.steps[step];
    if (!node) return;
    node.classList.toggle('active', step === activeStep);
  });
}

export function markAllPreviousAsDone(state, currentStep) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  STEP_ORDER.forEach((step, index) => {
    const node = state.steps[step];
    if (!node) return;
    node.classList.toggle('done', index < currentIndex);
  });
}

export function refreshResolvedOutput(state, defaultOutputDir) {
  const dir = state.fields.outputDir.value.trim() || defaultOutputDir || '';
  const outputName = resolveDesiredFilename(state);
  const output = dir ? `${dir}\\${outputName}` : outputName;
  state.fields.resolvedOutput.textContent = output || 'Ainda nao definida';
}

export function lockTab(state, busy) {
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
  const cancelable = busy || state.jobState === 'active' || state.jobState === 'queued';
  state.fields.cancelBtn.disabled = !cancelable;
  state.closeBtn.disabled = busy || state.jobState === 'active';
}

export function releaseOutput(activeOutputs, output, taskId) {
  if (!output) return;
  const owner = activeOutputs.get(output);
  if (owner === taskId) activeOutputs.delete(output);
}

export function applyTheme(theme, themeLabel) {
  document.body.dataset.theme = theme;
  if (themeLabel) {
    themeLabel.textContent = theme === 'light' ? 'Modo claro' : 'Modo escuro';
  }
}

export function initializeTheme(themeToggle, themeLabel) {
  const savedTheme = localStorage.getItem('vd-theme') || 'dark';
  applyTheme(savedTheme, themeLabel);
  themeToggle.checked = savedTheme === 'light';
  themeToggle.addEventListener('change', () => {
    const nextTheme = themeToggle.checked ? 'light' : 'dark';
    applyTheme(nextTheme, themeLabel);
    localStorage.setItem('vd-theme', nextTheme);
  });
}
