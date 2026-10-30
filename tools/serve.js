#!/usr/bin/env node
'use strict';
/* =========================================================
 * iPhone で開くための配信サーバー（開発用）
 *  - このフォルダのアプリを、同じ Wi-Fi の iPhone から開けるようにします
 *  - 起動すると、iPhone のカメラで読み取れる QR コードを表示します
 *
 *  使い方:
 *    VS Code で F5（「iPhoneで開く」）  … いちばん簡単
 *    node tools/serve.js [--port 8080] [--host 0.0.0.0] [--open]
 *      --open  起動後に PC のブラウザで接続用ページ（大きな QR）を開く
 * ========================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const qr = require('./qr');

const ROOT = path.resolve(__dirname, '..');
const args = parseArgs(process.argv.slice(2));
const HOST = args.host || process.env.HOST || '0.0.0.0';
const START_PORT = Number(args.port || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// 配信するのはアプリに必要なファイルだけ（開発用ファイルは見せない）
// ※ アプリ用に新しいフォルダを作ったら PUBLIC_DIRS に追加してください
const PUBLIC_FILES = new Set(['index.html', 'sw.js', 'manifest.webmanifest']);
const PUBLIC_DIRS = new Set(['css', 'js', 'icons']);
const SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/; // 英数字のみ・ドットで始まらない

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

const visitors = new Set();
let lanUrls = [];
let localUrl = '';

/* ---------- 起動 ---------- */

const stop = () => {
  console.log(`\n${C.dim}サーバーを止めました。${C.reset}`);
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

listen(START_PORT, 0);

function listen(port, attempt) {
  const server = http.createServer(handle);
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      listen(port + 1, attempt + 1); // 使用中なら次の番号を試す
    } else {
      console.error(`${C.yellow}サーバーを起動できませんでした: ${err.message}${C.reset}`);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    localUrl = `http://localhost:${port}`;
    lanUrls = HOST === '0.0.0.0' ? lanAddresses().map(a => ({ ...a, url: `http://${a.address}:${port}` })) : [];
    printBanner();
    warnIfPublicNetwork();
    if (args.open) openBrowser(`${localUrl}/connect`);
  });
}

/* ---------- リクエスト処理 ---------- */

function handle(req, res) {
  // どんなリクエストが来てもサーバーが落ちないようにする
  try {
    route(req, res);
  } catch (err) {
    console.error(`${C.yellow}リクエストの処理中にエラー: ${err.message}${C.reset}`);
    sendText(res, 500, 'エラーが発生しました');
  }
}

function route(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    sendText(res, 400, 'Bad Request');
    return;
  }

  if (pathname === '/connect') {
    sendConnectPage(res);
    return;
  }

  const filePath = publicFilePath(pathname);
  if (!filePath) {
    sendText(res, 404, '見つかりません');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, '見つかりません');
      return;
    }
    if (pathname === '/' || pathname === '/index.html') noteVisitor(req);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store', // 編集した内容がすぐ iPhone に反映されるように
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

/** 配信してよいファイルなら実際のパスを、それ以外は null を返す */
function publicFilePath(pathname) {
  if (pathname === '/') return path.join(ROOT, 'index.html');
  const segments = pathname.slice(1).split('/');
  if (!segments.every(s => SAFE_SEGMENT.test(s))) return null;
  if (segments.length === 1 && PUBLIC_FILES.has(segments[0])) return path.join(ROOT, segments[0]);
  if (segments.length >= 2 && PUBLIC_DIRS.has(segments[0])) return path.join(ROOT, ...segments);
  return null;
}

function sendText(res, status, text) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

/** 別の端末から開かれたら知らせる */
function noteVisitor(req) {
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!ip || ip === '127.0.0.1' || ip === '::1' || visitors.has(ip)) return;
  visitors.add(ip);
  const ua = String(req.headers['user-agent'] || '');
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : '端末';
  console.log(`${C.green}✔ ${device}（${ip}）から接続されました${C.reset}`);
}

/* ---------- 表示 ---------- */

function printBanner() {
  const line = '─'.repeat(52);
  const out = [];
  out.push('');
  out.push(`${C.cyan}${line}${C.reset}`);
  out.push(`  ${C.bold}ボドゲタイマー を配信しています${C.reset}`);
  out.push(`${C.cyan}${line}${C.reset}`);

  if (lanUrls.length) {
    const main = lanUrls[0];
    out.push('');
    out.push(`  ${C.bold}iPhone で開く${C.reset}  （PC と同じ Wi-Fi で、カメラを QR にかざす）`);
    out.push(`  ${C.bold}${C.green}${main.url}${C.reset}`);
    out.push('');
    for (const row of qr.toTerminal(qr.encode(main.url))) out.push('    ' + row);
    if (lanUrls.length > 1) {
      out.push('');
      out.push(`  ${C.dim}開けないときは、こちらも試してください:${C.reset}`);
      for (const other of lanUrls.slice(1)) out.push(`    ${other.url}  ${C.dim}(${other.name})${C.reset}`);
    }
  } else if (HOST === '0.0.0.0') {
    out.push('');
    out.push(`  ${C.yellow}Wi-Fi などのネットワークに接続されていないようです。${C.reset}`);
  }

  out.push('');
  out.push(`  PC で開く       ${localUrl}`);
  out.push(`  大きな QR を表示 ${localUrl}/connect`);
  out.push(`  ${C.dim}止めるときは、このターミナルで Ctrl + C${C.reset}`);
  out.push('');
  console.log(out.join('\n'));
}

/** Windows でネットワークが「パブリック」だと、iPhone から接続できないことがあるので知らせる */
function warnIfPublicNetwork() {
  if (process.platform !== 'win32' || !lanUrls.length) return;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '(Get-NetConnectionProfile).NetworkCategory -join ","'],
    { timeout: 8000, windowsHide: true },
    (err, stdout) => {
      if (err || !/Public/i.test(String(stdout))) return;
      console.log([
        `  ${C.yellow}⚠ この PC のネットワークは「パブリック」に設定されています。${C.reset}`,
        `  ${C.yellow}  iPhone から開けないときは、README.md の「つながらないとき」を見てください。${C.reset}`,
        '',
      ].join('\n'));
    }
  );
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    // ブラウザが開けなくてもサーバーはそのまま使える
  }
}

/** PC のブラウザで見る「接続用ページ」（大きな QR コード付き） */
function sendConnectPage(res) {
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const cards = lanUrls.length
    ? lanUrls.map((a, i) => `
      <section class="card${i ? ' sub' : ''}">
        <div class="qr">${qr.toSvg(qr.encode(a.url), { scale: i ? 5 : 8 })}</div>
        <div class="info">
          <p class="label">${i ? 'うまくいかないときはこちら' : 'iPhone のカメラで読み取る'}</p>
          <p class="url">${esc(a.url)}</p>
          <p class="nic">${esc(a.name)}</p>
        </div>
      </section>`).join('')
    : '<p class="warn">Wi-Fi などのネットワークに接続されていないようです。</p>';

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iPhone で開く - ボドゲタイマー</title>
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #0b0f14; color: #eef2f6;
    font-family: system-ui, -apple-system, "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif; line-height: 1.7; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 20px 60px; }
  header { display: flex; align-items: center; gap: 14px; }
  header img { width: 52px; height: 52px; border-radius: 13px; }
  h1 { margin: 0; font-size: 24px; }
  .lead { margin: 2px 0 0; color: #9ba8b6; font-size: 14px; }
  .card { display: flex; align-items: center; gap: 28px; margin-top: 28px; padding: 24px;
    background: #141b24; border: 1px solid rgba(255,255,255,.08); border-radius: 22px; }
  .card.sub { margin-top: 14px; padding: 16px 24px; }
  .qr { flex: none; padding: 10px; background: #fff; border-radius: 14px; line-height: 0; }
  .qr svg { display: block; max-width: 280px; height: auto; }
  .card.sub .qr svg { max-width: 150px; }
  .label { margin: 0; color: #9ba8b6; font-size: 13px; font-weight: 700; }
  .url { margin: 4px 0 0; color: #35d6b8; font-size: 22px; font-weight: 800; word-break: break-all; }
  .card.sub .url { font-size: 17px; }
  .nic { margin: 2px 0 0; color: #6c7988; font-size: 12px; }
  h2 { margin: 36px 0 8px; font-size: 16px; }
  ol, ul { margin: 0; padding-left: 1.4em; color: #c9d2dc; font-size: 14.5px; }
  li { margin: 4px 0; }
  .warn { color: #ffb547; }
  a { color: #35d6b8; }
  .note { margin-top: 32px; padding: 14px 16px; background: rgba(255,181,71,.08);
    border: 1px solid rgba(255,181,71,.25); border-radius: 14px; color: #ffd9a1; font-size: 13.5px; }
  @media (max-width: 560px) { .card { flex-direction: column; align-items: flex-start; } }
</style>
</head>
<body>
<main>
  <header>
    <img src="/icons/icon.svg" alt="">
    <div>
      <h1>iPhone で開く</h1>
      <p class="lead">ボドゲタイマーを配信中です。このページは PC だけに表示されます。</p>
    </div>
  </header>
  ${cards}
  <h2>手順</h2>
  <ol>
    <li>iPhone を、この PC と<strong>同じ Wi-Fi</strong> につなぐ</li>
    <li>iPhone の<strong>カメラ</strong>を上の QR コードにかざし、表示されたリンクを開く</li>
    <li>Safari の<strong>共有ボタン</strong> →<strong>「ホーム画面に追加」</strong>で、アプリのように全画面で使える</li>
  </ol>
  <h2>つながらないとき</h2>
  <ul>
    <li>サーバー起動時に Windows の「ファイアウォールの警告」が出たら<strong>「アクセスを許可する」</strong>を押す</li>
    <li>大学・ホテル・カフェなどの Wi-Fi は、端末どうしの通信が禁止されていることが多いです。<br>
      iPhone の<strong>インターネット共有（テザリング）</strong>をオンにして、PC をその Wi-Fi につなぐと確実です</li>
    <li>QR を読み取る前に、上の URL を Safari に直接入力しても開けます</li>
  </ul>
  <p class="note">PC で動作を確かめるときは <a href="/">${esc(localUrl)}</a> を開いてください。</p>
</main>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

/* ---------- 補助 ---------- */

/** iPhone から届きそうな IP アドレスを、それらしい順に並べる */
function lanAddresses() {
  const result = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      const isV4 = a.family === 'IPv4' || a.family === 4;
      if (!isV4 || a.internal || a.address.startsWith('169.254.')) continue;
      let score = 0;
      if (/wi-?fi|wlan|wireless|無線/i.test(name)) score += 10;
      if (/^172\.20\.10\./.test(a.address)) score += 5; // iPhone のインターネット共有
      if (/^192\.168\./.test(a.address)) score += 3;
      if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) score += 2;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|vboxnet|Tailscale|ZeroTier/i.test(name)) score -= 20;
      result.push({ name, address: a.address, score });
    }
  }
  return result.sort((x, y) => y.score - x.score);
}

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(list[i]);
    if (!m) continue;
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (list[i + 1] && !list[i + 1].startsWith('--')) out[m[1]] = list[++i];
    else out[m[1]] = true;
  }
  return out;
}
