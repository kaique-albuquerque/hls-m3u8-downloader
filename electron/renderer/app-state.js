export function createAppState() {
  return {
    tabs: new Map(),
    activeOutputs: new Map(),
    counter: 1,
    defaultOutputDir: '',
    activeTabId: '',
  };
}

export function getRendererDom() {
  return {
    tabBar: document.getElementById('tabBar'),
    tabPanels: document.getElementById('tabPanels'),
    tabTemplate: document.getElementById('tabTemplate'),
    newTabBtn: document.getElementById('newTabBtn'),
    themeToggle: document.getElementById('themeToggle'),
    themeLabel: document.querySelector('[data-theme-label]'),
  };
}
