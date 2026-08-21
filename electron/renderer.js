import { createAppState, getRendererDom } from './renderer/app-state.js';
import { createPanelsController } from './renderer/panels.js';
import { createVideoTabsController } from './renderer/video-tabs.js';

const appState = createAppState();
const dom = getRendererDom();

let panelsController = null;

const tabsController = createVideoTabsController({
  appState,
  dom,
  onQueueRefresh: () => panelsController?.refreshQueuePanel(),
  onHistoryRefresh: () => panelsController?.refreshHistoryPanel(),
});

panelsController = createPanelsController({
  dom,
  tabsController,
});

panelsController.initializeTheme();

window.api.resolvePaths().then(({ defaultDownloads }) => {
  tabsController.setDefaultOutputDir(defaultDownloads || '');
});

window.api.onQueueEvent(({ event, payload }) => {
  tabsController.handleQueueEvent(event, payload);
});

dom.newTabBtn.addEventListener('click', () => tabsController.addTab());
tabsController.addTab();
panelsController.initializePanels();
