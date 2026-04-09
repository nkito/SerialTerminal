const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

const windows = new Set();           // ウィンドウ管理
const windowPorts = new Map();       // webContents.id → SerialPort（各ウィンドウごとに独立）

const windowTitle = "Serial Terminal";

let currentCharDelay = 0; 
let currentNewlineDelay = 0;
let currentTextEncoding = 'utf-8'; // 文字エンコーディングの現在値
let localEchoEnabled = false; // ローカルエコーの状態

function buildAppMenu() {
  const template = [
    {
      label: 'ファイル',
      submenu: [
        {
          label: '新しいウィンドウ',
          accelerator: 'CmdOrCtrl+N',   // macはCmd+N、Windows/LinuxはCtrl+N
          click: () => {
            createWindow();
          }
        },
        { type: 'separator' },
        {
          label: '終了',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '端末',
      submenu: [
        {
          label: 'コピー',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: (_menuItem, focusedWindow) => {
            if (focusedWindow && !focusedWindow.isDestroyed()){
              focusedWindow.webContents.send('terminal:do-copy');
            }
          },
        },
        {
          label: 'ペースト',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: (_menuItem, focusedWindow) => {
            if (focusedWindow && !focusedWindow.isDestroyed()){
              focusedWindow.webContents.send('terminal:do-paste');
            }
          },
        },
        {
          label: '端末リセット',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (_menuItem, focusedWindow) => {
            const win = focusedWindow;
            if (win && !win.isDestroyed()) {
              win.webContents.send('terminal:reset');
            }
          },
        },
        {
          label: '画面クリア',
          accelerator: 'CmdOrCtrl+L',
          click: (_menuItem, focusedWindow) => {
            const win = focusedWindow;
            if (win && !win.isDestroyed()) {
              win.webContents.send('terminal:clear');
            }
          },
        },
      ],
    },
    {
      label: '端末サイズ',
      submenu: [
        {
          label: '80x25にセット',
          click: (_menuItem, focusedWindow) => {
            const win = focusedWindow;
            if (win && !win.isDestroyed()) {
              win.webContents.send('terminal:size-change-80x25');
            }
          },
        },
        {
          label: '80x40にセット',
          click: (_menuItem, focusedWindow) => {
            const win = focusedWindow;
            if (win && !win.isDestroyed()) {
              win.webContents.send('terminal:size-change-80x40');
            }
          },
        },
      ],
    },
    {
      label: '設定',
      submenu: [
        {
          label: `文字間遅延 (${currentCharDelay} ms)`,   // 現在値を表示
          submenu: [
            { label:  '0 ms', type: 'radio', checked: currentCharDelay ===   0, click: (_menuItem, focusedWindow) => setCharDelayValue(focusedWindow,   0) },
            { label:  '2 ms', type: 'radio', checked: currentCharDelay ===   2, click: (_menuItem, focusedWindow) => setCharDelayValue(focusedWindow,   2) },
            { label:  '5 ms', type: 'radio', checked: currentCharDelay ===   5, click: (_menuItem, focusedWindow) => setCharDelayValue(focusedWindow,   5) },
            { label: '10 ms', type: 'radio', checked: currentCharDelay ===  10, click: (_menuItem, focusedWindow) => setCharDelayValue(focusedWindow,  10) },
            { label: '20 ms', type: 'radio', checked: currentCharDelay ===  20, click: (_menuItem, focusedWindow) => setCharDelayValue(focusedWindow,  20) },
            { label: '50 ms', type: 'radio', checked: currentCharDelay ===  50, click: (_menuItem, focusedWindow) => setCharDelayValue(focusedWindow,  50) },
            { label:'100 ms', type: 'radio', checked: currentCharDelay === 100, click: (_menuItem, focusedWindow) => setCharDelayValue(focusedWindow, 100) },
            { label:'200 ms', type: 'radio', checked: currentCharDelay === 200, click: (_menuItem, focusedWindow) => setCharDelayValue(focusedWindow, 200) },
            { type: 'separator' },
            {
              label: 'カスタム...',
              click: (_menuItem, focusedWindow) => {
                if (focusedWindow && !focusedWindow.isDestroyed()) {
                  focusedWindow.webContents.send('menu:request-custom-char-delay');
                }
              }
            }
          ]
        },
        {
          label: `改行後遅延 (${currentNewlineDelay} ms)`,
          submenu: [
            { label:  '0 ms', type: 'radio', checked: currentNewlineDelay ===   0, click: (_menuItem, focusedWindow) => setNewlineDelayValue(focusedWindow,   0) },
            { label:  '2 ms', type: 'radio', checked: currentNewlineDelay ===   2, click: (_menuItem, focusedWindow) => setNewlineDelayValue(focusedWindow,   2) },
            { label:  '5 ms', type: 'radio', checked: currentNewlineDelay ===   5, click: (_menuItem, focusedWindow) => setNewlineDelayValue(focusedWindow,   5) },
            { label: '10 ms', type: 'radio', checked: currentNewlineDelay ===  10, click: (_menuItem, focusedWindow) => setNewlineDelayValue(focusedWindow,  10) },
            { label: '20 ms', type: 'radio', checked: currentNewlineDelay ===  20, click: (_menuItem, focusedWindow) => setNewlineDelayValue(focusedWindow,  20) },
            { label: '50 ms', type: 'radio', checked: currentNewlineDelay ===  50, click: (_menuItem, focusedWindow) => setNewlineDelayValue(focusedWindow,  50) },
            { label:'100 ms', type: 'radio', checked: currentNewlineDelay === 100, click: (_menuItem, focusedWindow) => setNewlineDelayValue(focusedWindow, 100) },
            { label:'200 ms', type: 'radio', checked: currentNewlineDelay === 200, click: (_menuItem, focusedWindow) => setNewlineDelayValue(focusedWindow, 200) },
            { type: 'separator' },
            {
              label: 'カスタム...',
              click: (_menuItem, focusedWindow) => {
                if (focusedWindow && !focusedWindow.isDestroyed()) {
                  focusedWindow.webContents.send('menu:request-custom-newline-delay');
                }
              }
            }
          ]
        },
        {
          label: `文字コード (${currentTextEncoding})`,
          submenu: [
            { label: 'UTF-8',      type: 'radio', checked: currentTextEncoding === 'utf-8',      click: (_menuItem, focusedWindow) => setTextEncodingValue(focusedWindow, 'utf-8') },
            { label: 'Shift-JIS',  type: 'radio', checked: currentTextEncoding === 'shift-jis',  click: (_menuItem, focusedWindow) => setTextEncodingValue(focusedWindow, 'shift-jis') },
            { label: 'EUC-JP',     type: 'radio', checked: currentTextEncoding === 'euc-jp',     click: (_menuItem, focusedWindow) => setTextEncodingValue(focusedWindow, 'euc-jp') },
            { label: 'ISO-8859-1', type: 'radio', checked: currentTextEncoding === 'iso-8859-1', click: (_menuItem, focusedWindow) => setTextEncodingValue(focusedWindow, 'iso-8859-1') },
          ]
        },
        { 
          label: 'ローカルエコー', type: 'checkbox', checked: localEchoEnabled, 
          click: () => { 
            localEchoEnabled = !localEchoEnabled;
            const menu = buildAppMenu();
            Menu.setApplicationMenu(menu);
          }
        },
        // 必要なら他の設定（画面サイズなど）も同じパターンで追加可能
      ]
    },
    {
      label: '送信キャンセル',
      click: (_menuItem, focusedWindow) => {
        if (focusedWindow && !focusedWindow.isDestroyed()) {
          focusedWindow.webContents.send('terminal:cancel-send');
        }
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}

function createWindow() {
  const win = new BrowserWindow({
    width:  300,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setTitle(windowTitle);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  const wcId = win.webContents.id;

  windows.add(win);

  // ウィンドウ閉じたらポートも確実に閉じる
  win.on('closed', () => {
    if (windowPorts.has(wcId)) {
      const port = windowPorts.get(wcId);
      if (port?.isOpen) {
        port.close(() => {});   // 非同期でもOK
      }
      windowPorts.delete(wcId);
    }
    windows.delete(win);
  });
}

// Rendererからサイズ変更通知を受け取る
ipcMain.on('resize-to-content', (event, { width, height }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    console.log(`resize-to-content: ${width}×${height} (window: ${win.webContents.id})`);
    win.setContentSize(Math.ceil(width), Math.ceil(height));
  }
});

ipcMain.on('menu:set-custom-char-delay', (event, value) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  setCharDelayValue(win, value);   // 下記の setCharDelayValue を呼ぶ
});

// 文字間遅延時間の変更時の処理
function setCharDelayValue(focusedWindow, newValue) {
  currentCharDelay = newValue;
  const menu = buildAppMenu();
  Menu.setApplicationMenu(menu);

  const win = focusedWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send('char-delay:change', newValue);
  }
}

ipcMain.on('menu:set-custom-newline-delay', (event, value) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  setNewlineDelayValue(win, value);   // 下記の setCharDelayValue を呼ぶ
});

// 改行後の遅延時間の変更時の処理
function setNewlineDelayValue(focusedWindow, newValue) {
  currentNewlineDelay = newValue;
  const menu = buildAppMenu();
  Menu.setApplicationMenu(menu);

  const win = focusedWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send('newline-delay:change', newValue);
  }
}

// 文字エンコーディングの変更時の処理
function setTextEncodingValue(focusedWindow, newValue) {
  currentTextEncoding = newValue;
  const menu = buildAppMenu();
  Menu.setApplicationMenu(menu);

  const win = focusedWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send('text-encoding:change', newValue);
  }
}

// buildAppMenu() の下あたりに追加
ipcMain.on('terminal:context-menu', (event, hasSelection) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'コピー',
      enabled: hasSelection,           // 選択されていなければグレーアウト
      click: () => {
        event.sender.send('terminal:do-copy');
      },
    },
    {
      label: 'ペースト',
      click: () => {
        event.sender.send('terminal:do-paste');
      },
    },
    { type: 'separator' },
    {
      label: 'すべて選択',
      click: () => event.sender.send('terminal:do-select-all'),
    },
  ]);

  contextMenu.popup({ window: win });
});

// ローカルエコーの状態をRendererに返すハンドラー
ipcMain.handle('terminal:local-echo', () => { 
  return localEchoEnabled;
});

// シリアルポート一覧（全ウィンドウ共通でOK）
ipcMain.handle('serial:list', async () => {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer || '',
    serialNumber: p.serialNumber || '',
    pnpId: p.pnpId || '',
    vendorId: p.vendorId || '',
    productId: p.productId || '',
    friendlyName: [
      p.friendlyName,
      p.manufacturer,
      p.serialNumber
    ].filter(Boolean).join(' / ')
  }));
});

// ポートオープン（各ウィンドウごとに独立したポートを作成）
ipcMain.handle('serial:open', async (event, options) => {
  const wcId = event.sender.id;
  const { path: portPath, baudRate } = options || {};

  if (!portPath) throw new Error('port path is required');

  // 同じウィンドウで既にポートが開いていたら閉じる
  if (windowPorts.has(wcId)) {
    const oldPort = windowPorts.get(wcId);
    if (oldPort?.isOpen) {
      await new Promise((resolve) => oldPort.close(() => resolve()));
    }
    windowPorts.delete(wcId);
  }

  const port = new SerialPort({
    path: portPath,
    baudRate: Number(baudRate),
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    autoOpen: false,
  });

  // データ受信は「このウィンドウだけ」に送る
  port.on('data', (data) => {
    event.sender.send('serial:data', Array.from(data));
  });

  port.on('error', (err) => {
    event.sender.send('serial:error', err.message || String(err));
  });

  await new Promise((resolve, reject) => {
    port.open((err) => (err ? reject(err) : resolve()));
  });

  windowPorts.set(wcId, port);

  // ウィンドウのタイトルを変更
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.setTitle(`${portPath} ${baudRate}bps - ${windowTitle}`);
  }

  return true;
});

// 書き込み
ipcMain.handle('serial:write', async (event, bytes) => {
  const wcId = event.sender.id;
  const port = windowPorts.get(wcId);
  if (!port?.isOpen) throw new Error('port is not open');

  const buffer = Buffer.from(bytes);
  await new Promise((resolve, reject) => {
    port.write(buffer, (err) => {
      if (err) return reject(err);
      port.drain((drainErr) => (drainErr ? reject(drainErr) : resolve()));
    });
  });
  return true;
});

// クローズ
ipcMain.handle('serial:close', async (event) => {
  const wcId = event.sender.id;
  const port = windowPorts.get(wcId);
  if (!port?.isOpen) return true;

  await new Promise((resolve, reject) => {
    port.close((err) => (err ? reject(err) : resolve()));
  });
  windowPorts.delete(wcId);

  // タイトルを元に戻す
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.setTitle(windowTitle);
  }

  return true;
});

// ==================== アプリライフサイクル ====================
function parseSerialArgs(argv) {
  const portIndex = argv.indexOf('--port');
  const baudIndex = argv.indexOf('--baud');

  let port = null;
  let baud = null;

  // --port の次の値を取得
  if (portIndex !== -1 && portIndex + 1 < argv.length) {
    port = argv[portIndex + 1];
  }
  // --baud の次の値を取得
  if (baudIndex !== -1 && baudIndex + 1 < argv.length) {
    baud = argv[baudIndex + 1];
  }

  // ★「両方指定されている場合のみ」オブジェクトを返す
  if (port && baud) {
    return { path: port, baudRate: parseInt(baud, 10) };
  }
  
  // 片方だけ、あるいは両方ない場合は null
  return null;
}

let firstWindow = true;
ipcMain.handle('app:init', () => {
  if( firstWindow ){
    // 起動時の引数を解析 (開発環境とパッケージ後で配列の位置が変わるため argv 全体を渡す)
    const config = parseSerialArgs(process.argv);
    if(config){
      for (const winel of windows) {
        winel.webContents.send('serial:autoconnect', {path: config.path, baudRate: config.baudRate});
      }
    }
    /*
    for (const winel of windows) {
      winel.webContents.send('serial:autoconnect', {path: '/dev/ttyS2', baudRate: 9600});
    }
    */
    firstWindow = false;
  }
});

app.whenReady().then(() => {
  createWindow();
  const menu = buildAppMenu();
  Menu.setApplicationMenu(menu);
});

app.on('window-all-closed', async () => {
  // 全ウィンドウのポートを安全に閉じる
  for (const port of windowPorts.values()) {
    if (port?.isOpen) {
      await new Promise((resolve) => port.close(() => resolve()));
    }
  }
  windowPorts.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
