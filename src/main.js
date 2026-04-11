import './style.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ImageAddon } from '@xterm/addon-image';
import '@xterm/xterm/css/xterm.css';

const $ = (id) => document.getElementById(id);

const el = {
  connectBtn: $('connectBtn'),
  disconnectBtn: $('disconnectBtn'),
  baudRate: $('baudRate'),
  charDelay: $('charDelay'),
  newlineDelay: $('newlineDelay'),
  resetBtn: $('resetBtn'),
  clearBtn: $('clearBtn'),
  terminal: $('terminal'),
  electronPortArea: $('electronPortArea'),
  portSelect: $('portSelect'),
  refreshPortsBtn: $('refreshPortsBtn'),
  connectToolBar: $('connectToolBar'),
  delayToolBar: $('delayToolBar'),
};

const isElectron = !!window.electronSerial?.isElectron;

const baseTheme = {
  foreground: '#F8F8F8',
  background: '#2D2E2C',
  selection: '#5DA5D533',
  black: '#1E1E1D',
  brightBlack: '#656565',
  red: '#CE5C5C',
  brightRed: '#FF7272',
  green: '#5BCC5B',
  brightGreen: '#72FF72',
  yellow: '#CCCC5B',
  brightYellow: '#FFFF72',
  blue: '#5D5DD3',
  brightBlue: '#7279FF',
  magenta: '#BC5ED1',
  brightMagenta: '#E572FF',
  cyan: '#5DA5D5',
  brightCyan: '#72F0FF',
  white: '#F8F8F8',
  brightWhite: '#FFFFFF'
};

/* ---------------------------------
 * xterm.js
 * --------------------------------- */
const term = new Terminal({
  cols: 80,
  rows: 25,
  scrollback: 5000,
  convertEol: true,
  cursorBlink: true,
  allowProposedApi: true,
  fontSize: 14,
  theme: baseTheme,
});

const fitAddon = new FitAddon();
const imageAddon = new ImageAddon({
  enableSizeReports: true,
  sixelSupport: true,
  sixelScrolling: true,
  iipSupport: true,
  storageLimit: 128,
});

term.loadAddon(fitAddon);
term.loadAddon(imageAddon);
term.open(el.terminal);

/* ---------------------------------
 * utility
 * --------------------------------- */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCharDelay() {
  return Math.max(0, Number(el.charDelay.value) || 0);
}

function getNewlineDelay() {
  return Math.max(0, Number(el.newlineDelay.value) || 0);
}

function setUiConnected(connected) {
  el.connectBtn.disabled = connected;
  el.disconnectBtn.disabled = !connected;
  el.baudRate.disabled = connected;
  if (isElectron) {
    el.portSelect.disabled = connected;
    el.refreshPortsBtn.disabled = connected;
  }
}

/* ---------------------------------
 * Transport interface
 * --------------------------------- */
class WebSerialTransport {
  constructor() {
    this.port = null;
    this.reader = null;
    this.keepReading = false;
    this.onDataCallback = null;
  }

  onData(callback) {
    this.onDataCallback = callback;
  }

  async connect({ baudRate }) {
    if (!('serial' in navigator)) {
      throw new Error('このブラウザでは Web Serial API が使えません');
    }

    this.port = await navigator.serial.requestPort();
    await this.port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    });

    this.keepReading = true;
    this.readLoop();
  }

  async readLoop() {
    while (this.port?.readable && this.keepReading) {
      this.reader = this.port.readable.getReader();
      try {
        while (this.keepReading) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && this.onDataCallback) {
            this.onDataCallback(value);
          }
        }
      } finally {
        try {
          this.reader.releaseLock();
        } catch {
          // ignore
        }
        this.reader = null;
      }
    }
  }

  async write(bytes) {
    if (!this.port?.writable) {
      throw new Error('ポートが開かれていません');
    }
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() {
    this.keepReading = false;

    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
    } catch {
      // ignore
    }

    if (this.port) {
      try {
        await this.port.close();
      } finally {
        this.port = null;
      }
    }
  }

  async listPorts() {
    if (!('serial' in navigator)) return [];
    const ports = await navigator.serial.getPorts();
    return ports.map((_, index) => ({
      path: `web-serial-${index}`,
      label: `許可済みポート ${index + 1}`,
    }));
  }
}

class ElectronSerialTransport {
  constructor() {
    this.onDataCallback = null;
    window.electronSerial.onData((bytes) => {
      if (this.onDataCallback) {
        this.onDataCallback(new Uint8Array(bytes));
      }
    });
    window.electronSerial.onError((message) => {
      term.writeln(`\r\n[Serial Error] ${message}`);
    });
  }

  onData(callback) {
    this.onDataCallback = callback;
  }

  async connect({ path, baudRate }) {
    await window.electronSerial.open({ path, baudRate });
  }

  async write(bytes) {
    await window.electronSerial.write(Array.from(bytes));
  }

  async disconnect() {
    await window.electronSerial.close();
  }

  async listPorts() {
    const ports = await window.electronSerial.list();
    return ports.map((p) => ({
      path: p.path,
      label: p.friendlyName
        ? `${p.path} (${p.friendlyName})`
        : p.path,
    }));
  }
}

const transport = isElectron
  ? new ElectronSerialTransport()
  : new WebSerialTransport();

let decoder = new TextDecoder("utf-8");
let currentTextEncoding = "utf-8";

transport.onData((bytes) => {
  term.write( decoder.decode(bytes, { stream: true }) );
});

/* ---------------------------------
 * delayed send queue
 * --------------------------------- */
let sendQueue = Promise.resolve();
let isConnected = false;
let currentAbortController = null;

async function writeBytesWithDelay(bytes, signal = null) {
  const charDelay = getCharDelay();
  const newlineDelay = getNewlineDelay();

  for (const b of bytes) {
    await transport.write(new Uint8Array([b]));

    if (charDelay > 0) {
      await sleep(charDelay);
    }

    if ((b === 0x0a || b === 0x0d) && newlineDelay > 0) {
      await sleep(newlineDelay);
    }
    if (signal?.aborted) {
      throw new DOMException('送信がキャンセルされました', 'AbortError');
    }
  }
}

function enqueueSendBytes(bytes, signal = null) {
  sendQueue = sendQueue
    .then(() => writeBytesWithDelay(bytes, signal))
    .catch((err) => {
      term.writeln(`\r\n[送信エラー] ${err?.message || err}`);
    });
  return sendQueue;
}

/* ---------------------------------
 * electron-only port list
 * --------------------------------- */
async function refreshElectronPorts() {
  if (!isElectron) return;

  const list = await transport.listPorts();
  el.portSelect.innerHTML = '';

  if (list.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'ポートが見つかりません';
    el.portSelect.appendChild(opt);
    return;
  }

  for (const port of list) {
    const opt = document.createElement('option');
    opt.value = port.path;
    opt.textContent = port.label;
    el.portSelect.appendChild(opt);
  }
}

/* ---------------------------------
 * connect / disconnect
 * --------------------------------- */
async function connect() {
  const baudRate = Number(el.baudRate.value);

  if (isElectron) {
    const path = el.portSelect.value;
    if (!path) {
      throw new Error('ポートを選択してください');
    }
    await transport.connect({ path, baudRate });
    term.writeln(`\r\n[接続] Electron / ${path} / ${baudRate}bps`);
  } else {
    await transport.connect({ baudRate });
    term.writeln(`\r\n[接続] Web Serial / ${baudRate}bps`);
  }

  isConnected = true;
  setUiConnected(true);
}

async function disconnect() {
  try {
    await sendQueue;
  } catch {
    // ignore
  }

  await transport.disconnect();
  isConnected = false;
  setUiConnected(false);
  term.writeln('\r\n[切断]');
}

/* ---------------------------------
 * terminal input
 * --------------------------------- */
term.onData(async (data) => {
  if (!isConnected) return;
  const localEcho = await window.electronSerial.getLocalEcho();
  if ( localEcho ) term.write(data);
  const bytes = await window.electronSerial.encodeText(data, currentTextEncoding);
  enqueueSendBytes(bytes);
});

/* ---------------------------------
 * buttons
 * --------------------------------- */
el.connectBtn.addEventListener('click', async () => {
  try {
    await connect();
  } catch (err) {
    term.writeln(`\r\n[接続エラー] ${err?.message || err}`);
  }
});

el.disconnectBtn.addEventListener('click', async () => {
  try {
    await disconnect();
  } catch (err) {
    term.writeln(`\r\n[切断エラー] ${err?.message || err}`);
  }
});

el.resetBtn.addEventListener('click', () => {
  term.reset();
  term.writeln('[ローカル端末状態をリセットしました]');
});

el.clearBtn.addEventListener('click', () => {
  term.clear();
});

el.refreshPortsBtn.addEventListener('click', async () => {
  try {
    await refreshElectronPorts();
    term.writeln('\r\n[情報] ポート一覧を更新しました');
  } catch (err) {
    term.writeln(`\r\n[ポート一覧取得エラー] ${err?.message || err}`);
  }
});

/* ---------------------------------
 * drag & drop file send
 * --------------------------------- */
window.addEventListener('dragover', (ev) => {
  if ([...(ev.dataTransfer?.items || [])].some((i) => i.kind === 'file')) {
    ev.preventDefault();
  }
});

window.addEventListener('drop', (ev) => {
  if ([...(ev.dataTransfer?.items || [])].some((i) => i.kind === 'file')) {
    ev.preventDefault();
  }
});

el.terminal.addEventListener('dragover', (ev) => {
  ev.preventDefault();
  el.terminal.style.outline = '2px dashed #4da3ff';
});

el.terminal.addEventListener('dragleave', () => {
  el.terminal.style.outline = '';
});

el.terminal.addEventListener('drop', async (ev) => {
  ev.preventDefault();
  el.terminal.style.outline = '';

  if (!isConnected) {
    term.writeln('\r\n[警告] 先にシリアル接続してください');
    return;
  }

  const files = ev.dataTransfer?.files;
  if (!files || files.length === 0) return;

  for (const file of files) {
    // すでに転送中ならスキップ（同時転送防止）
    if (currentAbortController) {
      term.writeln(`\r\n[警告] 現在別のファイル転送中です`);
      continue;
    }

    currentAbortController = new AbortController();   // ← 新規作成

    try {
      term.writeln(`\r\n[送信開始] ${file.name} (${file.size} bytes)`);
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      await enqueueSendBytes(bytes, currentAbortController.signal);
      term.writeln(`\r\n[送信完了] ${file.name}`);
    } catch (err) {
      term.writeln(`\r\n[ファイル送信エラー] ${file.name}: ${err?.message || err}`);
    } finally {
      currentAbortController = null;   // 完了・キャンセル後にクリア
    }
  }
});

async function adjustWindowSize() {
  // ブラウザがレイアウトを再計算するのを待つ
  await new Promise(resolve => requestAnimationFrame(resolve));
  await new Promise(resolve => requestAnimationFrame(resolve)); // 2回で確実らしい

  const terminalEl = document.getElementById('terminal');
  const termrect = terminalEl.getBoundingClientRect();

  // xterm の外側の大きさを計算しておく
  const addedWidth  = Math.ceil(document.documentElement.scrollWidth) - termrect.width;
  const addedHeight = Math.ceil(document.documentElement.scrollHeight) - termrect.height;

  // xterm の resize で実際の大きさが変わる部分について、サイズを取得する
  const xtermScreen = document.getElementsByClassName('xterm-screen')[0];
  const rect = xtermScreen.getBoundingClientRect();

  // 全体の必要サイズを計算
  const contentWidth = Math.ceil(rect.width)+addedWidth+15; // スクロールバーの分
  const contentHeight = Math.ceil(rect.height)+addedHeight;

  console.log(`[DEBUG renderer] 測定サイズ xterm-screen: ${rect.width}x${rect.height} added: ${addedWidth}x${addedHeight} content: ${contentWidth}x${contentHeight}`);

  // mainにサイズを通知
  window.electronSerial.resizeToContent({
    width: contentWidth,
    height: contentHeight
  });
}

/* ---------------------------------
 * startup
 * --------------------------------- */

(async () => {
  setUiConnected(false);

  if (isElectron) {
    // Electron ではボタンを隠す（ブラウザ版はそのまま残す）
    el.resetBtn.classList.add('hidden');
    el.clearBtn.classList.add('hidden');

    el.delayToolBar.style.height = '0px';
    el.delayToolBar.style.marginBottom = '0px';
    el.charDelay.readOnly = true;
    el.newlineDelay.readOnly = true;

    // メニューバーから来た操作を terminal に反映
    window.electronSerial.onTerminalReset(() => {
      term.reset();
      term.writeln('[ローカル端末状態をリセットしました]');
    });

    window.electronSerial.onTerminalClear(() => {
      term.clear();
    });
    window.electronSerial.onTerminalSizeChange80x25( async () => {
      term.resize(80, 25);
      await adjustWindowSize(); // ウィンドウサイズを調整
    });
    window.electronSerial.onTerminalSizeChange80x40(async () => {
      term.resize(80, 40);
      await adjustWindowSize(); // ウィンドウサイズを調整
    });
    window.electronSerial.onTerminalCanselSend(() => {
      if (currentAbortController) {
        currentAbortController.abort();
      }
    });

    // ── メニューから呼ばれる処理 ──
    window.electronSerial.onTerminalDoCopy( async () => {
      const text = term.getSelection();
      if (text) {
        await navigator.clipboard.writeText(text);
        // 必要なら term.writeln('\r\n[コピーしました]') などで通知
      }
    });

    window.electronSerial.onTerminalDoPaste( async () => {
      try {
        const text = await navigator.clipboard.readText();
        term.paste(text);          // xterm.js 公式のペーストAPI
      } catch (err) {
        console.error('ペースト失敗:', err);
        term.writeln('\r\n[ペーストエラー]');
      }
    });

    window.electronSerial.onTerminalDoSelectAll( () => {
      term.selectAll();        // xterm.js 公式APIで全選択
    });

    // ターミナル領域でのコンテキストメニューの表示
    el.terminal.addEventListener('contextmenu', (e) => {
      e.preventDefault();                    // ブラウザのデフォルト右クリックメニューを無効化

      const selection = term.getSelection(); // 現在選択中のテキストを取得
      const hasSelection = selection.length > 0;

      // main側にメニュー表示を依頼
      window.electronSerial.showTerminalContextMenu(hasSelection);
    });

    // テキストエンコーディングの変更
    window.electronSerial.onTextEncodingChange((value) => {
      term.writeln(`\r\n[情報] テキストエンコーディングが ${value} に変更されました`);
      decoder = new TextDecoder(value);
      currentTextEncoding = value;
    });

    /*
     * 文字間遅延設定
     */

    // 文字間の遅延設定は最終的にテキスト入力欄に反映させ、処理ではその値を参照する
    window.electronSerial.onCharDelayChange((value) => {
      el.charDelay.value = value;
    });

    // カスタム遅延時間入力のためのダイアログについての設定
    const CDdialog = document.getElementById('custom-char-delay-dialog');
    const CDinputEl = document.getElementById('custom-char-delay-dialog-input');
    const CDcancelBtn = document.getElementById('custom-char-delay-dialog-cancel');
    const CDokBtn = document.getElementById('custom-char-delay-dialog-ok');

    // OKボタン or Enter
    CDokBtn.addEventListener('click', () => {
      const value = parseInt(CDinputEl.value, 10);
      if (!isNaN(value) && value > 0 && value < 1000) {
        window.electronSerial.setCustomCharDelay(value);
      }
      CDdialog.close();
    });

    // キャンセル
    CDcancelBtn.addEventListener('click', () => { CDdialog.close(); });
    // EnterキーでもOK
    CDdialog.addEventListener('keydown', (e) => { if (e.key === 'Enter') CDokBtn.click(); });

    window.electronSerial.onMenuRequestCustomCharDelay(() => {
      CDinputEl.value = getCharDelay();
      CDinputEl.focus();
      CDdialog.showModal();
    });

    /*
     * 文字間遅延設定
     */

    // 文字間の遅延設定は最終的にテキスト入力欄に反映させ、処理ではその値を参照する
    window.electronSerial.onNewlineDelayChange((value) => {
      el.newlineDelay.value = value;
    });

    // カスタム遅延時間入力のためのダイアログについての設定
    const NDdialog = document.getElementById('custom-newline-delay-dialog');
    const NDinputEl = document.getElementById('custom-newline-delay-dialog-input');
    const NDcancelBtn = document.getElementById('custom-newline-delay-dialog-cancel');
    const NDokBtn = document.getElementById('custom-newline-delay-dialog-ok');

    // OKボタン or Enter
    NDokBtn.addEventListener('click', () => {
      const value = parseInt(NDinputEl.value, 10);
      if (!isNaN(value) && value > 0 && value < 1000) {
        window.electronSerial.setCustomNewlineDelay(value);
      }
      NDdialog.close();
    });

    // キャンセル
    NDcancelBtn.addEventListener('click', () => { NDdialog.close(); });
    // EnterキーでもOK
    NDdialog.addEventListener('keydown', (e) => { if (e.key === 'Enter') NDokBtn.click(); });

    window.electronSerial.onMenuRequestCustomNewlineDelay(() => {
      NDinputEl.value = getNewlineDelay();
      NDinputEl.focus();
      NDdialog.showModal();
    });
  }

  if (isElectron) {
    el.electronPortArea.classList.remove('hidden');
    await refreshElectronPorts();
    term.writeln('[起動] Electron モード');

    window.electronSerial.onSerialAutoConnect(async (options) => {
      term.writeln(`[接続] ${options.path} / ${options.baudRate} bps に自動接続します...`);
      baudRate.value = options.baudRate;
      const targetOption = el.portSelect.querySelector(`option[value="${options.path}"]`);
      if(targetOption){
        targetOption.selected = true;

        try {
          await connect();
          // うまく接続できた場合はツールバーを隠す
          el.connectToolBar.style.height = '0px';
          el.connectToolBar.style.marginBottom = '0px';
        } catch (err) {
          term.writeln(`\r\n[接続エラー] ${err?.message || err}`);
        }
      }
    });
    window.electronSerial.setArgumentOption();

    term.resize(80, 25); // 初期サイズを80x25に設定
    await adjustWindowSize(); // ウィンドウサイズを調整

    // リサイズ時の処理を登録
    window.addEventListener('resize', () => { 
      fitAddon.fit();
    });

  } else {
    term.writeln('[起動] ブラウザモード');
    if (!('serial' in navigator)) {
      term.writeln('[注意] このブラウザでは Web Serial API が使えません');
    }
  }
  // term.writeln('01234567890123456789012345678901234567890123456789012345678901234567890123456789');

  term.writeln('[ヒント] ターミナルにファイルをドラッグすると送信できます');
})();
