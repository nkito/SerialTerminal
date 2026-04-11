const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronSerial', {
  isElectron: true,

  list: () => ipcRenderer.invoke('serial:list'),
  open: (options) => ipcRenderer.invoke('serial:open', options),
  write: (bytes) => ipcRenderer.invoke('serial:write', bytes),
  close: () => ipcRenderer.invoke('serial:close'),

  onData: (callback) => {
    ipcRenderer.on('serial:data', (_event, bytes) => callback(bytes));
  },
  onError: (callback) => {
    ipcRenderer.on('serial:error', (_event, message) => callback(message));
  },
  onSerialAutoConnect: (callback) => {
    ipcRenderer.on('serial:autoconnect', (_event, options) => callback(options));
  },
  setArgumentOption: () => {
    ipcRenderer.invoke('app:init');
  },
  resizeToContent: (size) => ipcRenderer.send('resize-to-content', size),

  onTerminalReset: (callback) => {
    ipcRenderer.on('terminal:reset', () => callback());
  },

  onTerminalClear: (callback) => {
    ipcRenderer.on('terminal:clear', () => callback());
  },
  onTerminalSizeChange80x25: (callback) => {
    ipcRenderer.on('terminal:size-change-80x25', () => callback());
  },
  onTerminalSizeChange80x40: (callback) => {
    ipcRenderer.on('terminal:size-change-80x40', () => callback());
  },
  onTerminalCanselSend: (callback) => {
    ipcRenderer.on('terminal:cancel-send', () => callback());
  },
  
  onCharDelayChange: (callback) => {
    ipcRenderer.on('char-delay:change', (_event, value) => callback(value));
  },
  onMenuRequestCustomCharDelay: (callback) => {
    ipcRenderer.on('menu:request-custom-char-delay', () => callback());
  },
  setCustomCharDelay: (value) => {
    ipcRenderer.send('menu:set-custom-char-delay', value);
  },

  onNewlineDelayChange: (callback) => {
    ipcRenderer.on('newline-delay:change', (_event, value) => callback(value));
  },
  onMenuRequestCustomNewlineDelay: (callback) => {
    ipcRenderer.on('menu:request-custom-newline-delay', () => callback());
  },
  setCustomNewlineDelay: (value) => {
    ipcRenderer.send('menu:set-custom-newline-delay', value);
  },

  encodeText: (text, encoding) => ipcRenderer.invoke('text-encoding:encode-text', text, encoding),
  onTextEncodingChange: (callback) => {
    ipcRenderer.on('text-encoding:change', (_event, value) => callback(value));
  },
  getLocalEcho: () => ipcRenderer.invoke('terminal:local-echo'),

  showTerminalContextMenu: (hasSelection) => {
    ipcRenderer.send('terminal:context-menu', hasSelection);
  },
  onTerminalDoCopy: (callback) => {
    ipcRenderer.on('terminal:do-copy', async () => callback());
  },
  onTerminalDoPaste: (callback) => {
    ipcRenderer.on('terminal:do-paste', async () => callback());
  },
  onTerminalDoSelectAll: (callback) => {
    ipcRenderer.on('terminal:do-select-all', () => callback());
  },
});
