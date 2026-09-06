'use strict';

// EP04 Vibe coding 部署 的關卡判定。
// 規則正本：週次/EP04_Vibe coding部署/闖關/checks_spec_ep04.md 第二節（與本檔衝突時以規格為準）。
// 本模組自帶 markdown 解析小工具（不依賴 run.js 的內部函式，ctx 契約只提供 readFile/exists/commits/trackedFiles）。

const crypto = require('crypto');

// 通關密語只以 SHA-256 進程式（密語本身不寫進任何檔案；正本在 週次/EP04…/闖關/secret_challenge.json）。
const PASSPHRASE_SHA256 = '07dae7b20ce9fd7564a53686d44f75e8ab0e2680f14581f6564fb177391f4369';
const PASSPHRASE_MIN = 6;
const PASSPHRASE_MAX = 12;

const FETCH_TIMEOUT_MS = 10000;
const FETCH_UA = 'shsh-checks';

// ---------- markdown 小工具（與 ep03.js 同一套語意） ----------

function headingLevel(line) {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}

function findSection(lines, matchFn) {
  let startIdx = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (matchFn(lines[i])) {
      startIdx = i;
      level = headingLevel(lines[i]);
      break;
    }
  }
  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const lvl = headingLevel(lines[i]);
    if (lvl > 0 && lvl <= level) {
      endIdx = i;
      break;
    }
  }
  return { startIdx, endIdx, bodyLines: lines.slice(startIdx + 1, endIdx) };
}

// placeholder：只有含「換成你的」或含「把這一行換成」的行才算提示行（EP03 規格 9.1）。
function isPlaceholderLine(raw) {
  const t = raw.trim();
  if (t.includes('換成你的')) return true;
  if (t.includes('把這一行換成')) return true;
  return false;
}

function contentLines(bodyLines) {
  return bodyLines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !isPlaceholderLine(l));
}

function mergeContent(bodyLines) {
  return contentLines(bodyLines).join('');
}

const BAD_ENC_NOTE = '存成了 Big5／ANSI，GitHub 上看到的是亂碼：用 VS Code 打開它 → 右下角點編碼 → Save with Encoding → UTF-8 → 重新 commit push';
function badEncoding(text) {
  return typeof text === 'string' && text.includes('�');
}

function findEp04Section(notesText) {
  const lines = notesText.split('\n');
  return findSection(lines, (l) => /^##\s+EP04/.test(l.trim()));
}

// 讀 notes.md 的 EP04 段，回 { err } 或 { section }
function loadEp04Section(ctx) {
  const notes = ctx.readFile('notes.md');
  if (notes === null) return { err: '找不到 notes.md' };
  if (badEncoding(notes)) return { err: 'notes.md ' + BAD_ENC_NOTE };
  const section = findEp04Section(notes);
  if (!section) {
    return { err: 'notes.md 還沒有「## EP04」那一段（把這週的段落貼進去，或找老師拿 starter）' };
  }
  return { section };
}

function subSection(section, headingPrefix) {
  return findSection(section.bodyLines, (l) => l.trim().startsWith(headingPrefix));
}

// ---------- 網址 ----------

// 從一段文字裡抓第一個網址（含非 https 的，才能給出「不是 https」這種具體原因）。
const URL_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>（）()【】\[\]、，。]+/;
const TRAILING_JUNK_RE = /[.,;:。，、）)】」』>`*_]+$/;

function pickUrl(text) {
  const m = String(text || '').match(URL_RE);
  if (!m) return null;
  return m[0].replace(TRAILING_JUNK_RE, '');
}

// 回 { ok:true, url } 或 { ok:false, note }
function classifyUrl(raw) {
  if (!raw) {
    return { ok: false, note: '這一段還沒貼網址（要 https 開頭，Drop 給你的那一串）' };
  }
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return { ok: false, note: `這看起來不是網址：${raw.slice(0, 30)}` };
  }
  const proto = u.protocol.toLowerCase();
  if (proto === 'file:') {
    return { ok: false, note: 'file:// 是你自己電腦上的檔案，別人打不開——要貼 Drop 給你的 https 網址' };
  }
  if (proto !== 'https:') {
    return { ok: false, note: `網址要 https:// 開頭（現在是 ${proto}//）` };
  }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.')) {
    return { ok: false, note: `${host} 只有你自己的電腦看得到——要貼 Drop 給你的公開網址` };
  }
  return { ok: true, url: u.toString() };
}

// 回 { ok:true, status, body } 或 { ok:false, note }
async function fetchPage(url, wantBody) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': FETCH_UA },
      signal: controller.signal,
    });
    const status = res.status;
    let body = '';
    if (wantBody) {
      try {
        body = await res.text();
      } catch (e) {
        body = '';
      }
    }
    if (status >= 200 && status < 300) {
      return { ok: true, status, body };
    }
    if (status >= 400 && status < 500) {
      return { ok: false, note: `網址打不開（HTTP ${status}，通常是網址貼錯或那一頁已經不在了）` };
    }
    if (status >= 500) {
      return { ok: false, note: `對方網站出錯（HTTP ${status}），等一下再 push 一次` };
    }
    return { ok: false, note: `抓到不是 2xx 的回應（HTTP ${status}）` };
  } catch (e) {
    const name = e && e.name ? e.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { ok: false, note: `抓網址逾時（${FETCH_TIMEOUT_MS / 1000} 秒還沒回應）` };
    }
    return { ok: false, note: `連不上這個網址（${(e && e.message ? e.message : String(e)).slice(0, 40)}）` };
  } finally {
    clearTimeout(timer);
  }
}

function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  return m[1];
}

function squash(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '');
}

// ---------- 通關密語（雜湊比對，密語不寫進程式） ----------

function hasPassphrase(text) {
  const t = squash(text);
  const arr = Array.from(t.length > 4000 ? t.slice(0, 4000) : t);
  for (let i = 0; i < arr.length; i++) {
    for (let len = PASSPHRASE_MIN; len <= PASSPHRASE_MAX; len++) {
      if (i + len > arr.length) break;
      const sub = arr.slice(i, i + len).join('');
      const h = crypto.createHash('sha256').update(sub, 'utf8').digest('hex');
      if (h === PASSPHRASE_SHA256) return true;
    }
  }
  return false;
}

// ---------- 關卡 ----------

const H_FIRST_URL = '### 第一次上線的網址';
const H_WHAT = '### 這次做的東西';
const H_LIVE_URL = '### 上線網址';

module.exports = {
  id: 'ep04',
  title: 'EP04 Vibe coding 部署',
  checks: [
    {
      id: 'ep04_1',
      name: '關 1 先上線再說 🌐',
      howTo: '把上週那一頁 Drop 上去，網址（https 開頭）貼進 notes.md「### 第一次上線的網址」',
      sticky: true,
      async test(ctx) {
        const loaded = loadEp04Section(ctx);
        if (loaded.err) return { pass: false, note: loaded.err };
        const sub = subSection(loaded.section, H_FIRST_URL);
        if (!sub) {
          return { pass: false, note: `notes.md 少了『${H_FIRST_URL}』那一行標題（標題不要刪，只換下面那行）` };
        }
        const cls = classifyUrl(pickUrl(mergeContent(sub.bodyLines)));
        if (!cls.ok) return { pass: false, note: cls.note };
        const res = await fetchPage(cls.url, false);
        if (!res.ok) return { pass: false, note: res.note };
        return { pass: true, note: `上週那一頁抓得到（HTTP ${res.status}）` };
      },
    },
    {
      id: 'ep04_2',
      name: '關 2 做一個想要的東西',
      howTo: 'index.html 換成自己的新作品（≥20 行、有自己的 <title>、有 <h1>／按鈕／script），notes.md「### 這次做的東西」寫一句話',
      test(ctx) {
        const problems = [];

        if (!ctx.exists('index.html')) {
          problems.push('根目錄沒有 index.html');
        } else {
          const html = ctx.readFile('index.html') || '';
          if (badEncoding(html)) {
            return { pass: false, note: 'index.html ' + BAD_ENC_NOTE };
          }
          const lineCount = html.split('\n').length;
          if (lineCount < 20) {
            problems.push(`index.html 只有 ${lineCount} 行（這週要 20 行以上）`);
          }
          const titleText = squash(extractTitle(html) || '');
          if (titleText.length < 1) {
            problems.push('index.html 的 <title> 裡沒有字');
          } else if (titleText === '我的第一個網頁') {
            problems.push('把「我的第一個網頁」換成你這次做的主題');
          }
          if (!/<h1|<button|<script|<input/i.test(html)) {
            problems.push('index.html 裡沒有 <h1>／<button>／<script>／<input>（做一個看得出來是你的東西）');
          }
        }

        const loaded = loadEp04Section(ctx);
        if (loaded.err) {
          problems.push(loaded.err);
        } else {
          const sub = subSection(loaded.section, H_WHAT);
          if (!sub) {
            problems.push(`notes.md 少了『${H_WHAT}』那一行標題`);
          } else {
            const what = mergeContent(sub.bodyLines);
            if (what.length < 6) {
              problems.push('notes.md「這次做的東西」還沒寫到 6 個字');
            }
          }
        }

        if (problems.length > 0) {
          return { pass: false, note: problems.join('；') };
        }
        return { pass: true, note: '新作品有了，notes 也寫了一句話' };
      },
    },
    {
      id: 'ep04_3',
      name: '關 3 上線給別人看 🌐',
      howTo: '新作品 Drop 上去，網址貼進 notes.md「### 上線網址」，而且上線那一頁要跟 repo 裡的 index.html 是同一份',
      sticky: true,
      async test(ctx) {
        const loaded = loadEp04Section(ctx);
        if (loaded.err) return { pass: false, note: loaded.err };
        const sub = subSection(loaded.section, H_LIVE_URL);
        if (!sub) {
          return { pass: false, note: `notes.md 少了『${H_LIVE_URL}』那一行標題（標題不要刪，只換下面那行）` };
        }
        const cls = classifyUrl(pickUrl(mergeContent(sub.bodyLines)));
        if (!cls.ok) return { pass: false, note: cls.note };

        const localHtml = ctx.readFile('index.html');
        if (localHtml === null) {
          return { pass: false, note: '根目錄沒有 index.html，沒東西可以比對' };
        }
        const localTitle = squash(extractTitle(localHtml) || '');
        if (localTitle.length < 1) {
          return { pass: false, note: 'repo 裡的 index.html 沒有 <title>，先把關 2 弄好' };
        }

        const res = await fetchPage(cls.url, true);
        if (!res.ok) return { pass: false, note: res.note };

        const remoteTitleRaw = extractTitle(res.body);
        if (remoteTitleRaw === null) {
          return { pass: false, note: '上線的那一頁沒有 <title>，Drop 的可能不是你的 index.html' };
        }
        const remoteTitle = squash(remoteTitleRaw);
        if (remoteTitle !== localTitle) {
          return {
            pass: false,
            note: `上線那一頁的 title 是「${remoteTitleRaw.trim().slice(0, 20)}」，跟 repo 裡的 index.html 不一樣（Drop 的是舊檔？重傳一次）`,
          };
        }
        return { pass: true, note: `上線網址抓得到（HTTP ${res.status}），而且就是你 repo 裡的那一頁` };
      },
    },
    {
      id: 'ep04_4',
      name: '關 4 秘密藏不住',
      howTo: 'notes.md EP04 三個問題都用自己的話寫（每題至少 10 個字），第 3 題要把解鎖拿到的通關密語寫進去',
      test(ctx) {
        const loaded = loadEp04Section(ctx);
        if (loaded.err) return { pass: false, note: loaded.err };
        const section = loaded.section;

        const q1 = subSection(section, '### 1.');
        const q2 = subSection(section, '### 2.');
        const q3 = subSection(section, '### 3.');

        const missing = [];
        if (!q1) missing.push('### 1.');
        if (!q2) missing.push('### 2.');
        if (!q3) missing.push('### 3.');
        if (missing.length > 0) {
          return {
            pass: false,
            note: `notes.md 的 EP04 段少了『${missing.join('、')}』那一行標題（標題不要刪，只換下面那行）`,
          };
        }

        const c1 = mergeContent(q1.bodyLines);
        const c2 = mergeContent(q2.bodyLines);
        const c3 = mergeContent(q3.bodyLines);

        const problems = [];
        if (c1.length < 10) problems.push('第 1 題還沒寫到 10 個字');
        if (c2.length < 10) problems.push('第 2 題還沒寫到 10 個字');
        if (c3.length < 10) problems.push('第 3 題還沒寫到 10 個字');
        if (problems.length > 0) {
          return { pass: false, note: `還沒寫完：${problems.join('、')}` };
        }

        if (!hasPassphrase(c3)) {
          return {
            pass: false,
            note: '第 3 題還沒有通關密語：去任務卡的解鎖框，把假網站原始碼裡的 key 貼進去，拿到密語再寫進來',
          };
        }
        return { pass: true, note: '三題都寫了，密語也對' };
      },
    },
  ],
};
