#!/usr/bin/env node
'use strict';
/* =========================================================
 * アイコン画像（PNG）を作り直す
 *  - icons/icon.svg を描き変えたら、これを実行してください
 *      node tools/make-icons.js
 *  - PC に入っている Microsoft Edge（または Chrome）で SVG を描画して PNG にします
 * ========================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ICONS = path.resolve(__dirname, '..', 'icons');
const SVG = fs.readFileSync(path.join(ICONS, 'icon.svg'), 'utf8');

// maskable 版は、端末によって丸く切り抜かれても欠けないように中身を少し小さくする
const MASKABLE_SVG = SVG.replace('<g id="fg">', '<g id="fg" transform="translate(512 512) scale(0.84) translate(-512 -512)">');

const OUTPUTS = [
  { file: 'apple-touch-icon.png', size: 180, svg: SVG },
  { file: 'icon-192.png', size: 192, svg: SVG },
  { file: 'icon-512.png', size: 512, svg: SVG },
  { file: 'icon-maskable-512.png', size: 512, svg: MASKABLE_SVG },
];

function findBrowser() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find(p => p && fs.existsSync(p));
}

const browser = findBrowser();
if (!browser) {
  console.error('Microsoft Edge または Google Chrome が見つかりませんでした。');
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bgtimer-icons-'));
try {
  for (const out of OUTPUTS) {
    const html = path.join(work, `${out.size}-${out.file}.html`);
    fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;width:${out.size}px;height:${out.size}px;overflow:hidden;background:#0b0f14}
      svg{display:block;width:${out.size}px;height:${out.size}px}
    </style></head><body>${out.svg}</body></html>`);
    const target = path.join(ICONS, out.file);
    execFileSync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${out.size},${out.size}`,
      `--user-data-dir=${path.join(work, 'profile')}`,
      `--screenshot=${target}`,
      pathToFileURL(html).href,
    ], { stdio: 'ignore', timeout: 60000 });
    console.log(`作成しました: icons/${out.file}（${out.size}×${out.size}）`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
