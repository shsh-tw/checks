'use strict';

// EP04 Vibe coding 部署 的關卡判定。
// 規則正本：週次/EP04_Vibe coding部署/闖關/checks_spec_ep04.md 第二節（與本檔衝突時以規格為準）。
// 本模組自帶 markdown 解析小工具（不依賴 run.js 的內部函式，ctx 契約只提供 readFile/exists/commits/trackedFiles）。

const crypto = require('crypto');

// 關 1 上線的是「上週那一頁」；關 2 要的是新作品。用 index.html 的內容雜湊記住關 1 當下的那一份，
// 關 2 再比對——一樣就代表根本沒做新東西（v2 6.3）。去掉 CRLF 才不會因為換行風格誤判成不同檔。
function indexSha(ctx) {
  const html = ctx.readFile('index.html');
  if (html === null) return null;
  return crypto.createHash('sha1').update(html.replace(/\r/g, ''), 'utf8').digest('hex');
}

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
  // v2 補洞：第 2 題的 starter 提示行本身就長得像答案（含 weather.example.com…?key=xxxx），
  // 不擋掉的話「完全沒動 starter」也會過第 2 題。這一行只出現在 starter，學生貼真的那條不會有「長得像」。
  if (t.includes('貼出來，長得像')) return true;
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

// 亂打過濾（v3 7.1）：「啊啊啊啊啊啊啊啊啊啊」湊得到 10 個字，但那不是答案。
// 兩關：① 連續重複的同一字元壓成 1 個之後再算長度 ② 去重後不同字元數要 ≥5。
function collapseRepeats(text) {
  return String(text == null ? '' : text).replace(/(.)\1+/gu, '$1');
}
function distinctCount(text) {
  return new Set(Array.from(String(text == null ? '' : text))).size;
}
const GIBBERISH_NOTE = '像亂打的（同一個字一直重複）';
// 內容長度是否達標；不達標時回不合格的原因種類（'short'／'gibberish'）
function lengthCheck(text, min) {
  const collapsed = collapseRepeats(text);
  if (collapsed.length < min) return 'short';
  // 不同字元門檻跟著該題字數走：短答案（自我介紹 ≥4）不能用 5 種字去卡（「我是小明」是合法的）。
  if (distinctCount(collapsed) < Math.min(5, min)) return 'gibberish';
  return null;
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

// 白名單樣式（規格 5.1）：只收 Drop、作品牆、GitHub Pages 作業站，加上任何 pages.dev（老師測試用）。
// 擋掉「隨便貼一個網址就想過關」，也擋掉貼到自己 repo 首頁那種誤會。
const URL_WHITELIST = [
  /^https:\/\/drop-[0-9a-f]{8}-[0-9a-f]{3}\.[a-z]+-[a-z]+\.workers\.dev\/?$/,
  /^https:\/\/shsh-ai-class\.pages\.dev\/gallery\/[A-Za-z0-9-]+\/?$/,
  /^https:\/\/shsh-tw\.github\.io\/hw-[A-Za-z0-9-]+\/?$/,
];

// 測試用例外（v2）：本機 fixture 才設，Actions 不設。逗號分隔的 regex 字串。
// 收緊白名單的原因是「貼教材站首頁也能亮燈」——那是零工作，不是上線。
function extraAllowPatterns() {
  const raw = process.env.CHECKS_URL_ALLOW_EXTRA;
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      try {
        return new RegExp(x);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

// Cloudflare 的機器人挑戰：runner 的 IP 抓 *.workers.dev 會吃 403 + cf-mitigated: challenge，
// 但同一個網址人用瀏覽器（或老師的 Mac）抓得到 200。403+challenge 代表「網站活著、只是不給機器看」，
// 判定上視為活著，內容比對交給老師端儀表板與隔壁同學的手機。
function isCloudflareChallenge(status, headers, body) {
  if (status !== 403) return false;
  const mit = headers && typeof headers.get === 'function' ? headers.get('cf-mitigated') : null;
  if (mit && String(mit).toLowerCase().includes('challenge')) return true;
  return typeof body === 'string' && body.includes('Just a moment');
}

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
  const url = u.toString();
  if (![...URL_WHITELIST, ...extraAllowPatterns()].some((re) => re.test(url))) {
    return {
      ok: false,
      note: `這不像 Drop 或作品牆的網址：${url.slice(0, 40)}（要貼 Drop 上傳完給你的那一串）`,
    };
  }
  return { ok: true, url };
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
    if (wantBody || status === 403) {
      // 403 也要讀 body：Cloudflare 挑戰頁的辨識字串在裡面
      try {
        body = await res.text();
      } catch (e) {
        body = '';
      }
    }
    if (status >= 200 && status < 300) {
      return { ok: true, status, body };
    }
    if (isCloudflareChallenge(status, res.headers, body)) {
      return { ok: false, challenge: true, status };
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

// ---------- 給老師端儀表板用的旁路資料（規格 5.2） ----------

// run.js 提供 ctx.emit(key, value)，寫進尾註 JSON 的 data。舊版 run.js 沒有這個函式也不會炸。
function emit(ctx, key, value) {
  if (ctx && typeof ctx.emit === 'function') ctx.emit(key, String(value == null ? '' : value));
}

// run.js 提供 ctx.remember/ctx.recall（跨 push 的持久記憶，存在 Issue 尾註的 mem）。
function rememberIndex(ctx) {
  if (!ctx || typeof ctx.remember !== 'function') return;
  const sha = indexSha(ctx);
  if (sha) ctx.remember('ep04_1_index_sha', sha);
}

// ---------- 關卡 ----------

// 第 2 題要的東西（v2 6.4）：老師假網站在 Network 分頁露出來的那條請求。
const NETWORK_URL_MARK = 'weather.example.com/today?key=';
// 「整支 key 原樣貼上」的樣式：sk-demo- 後面還接著一長串就是沒遮。
const UNMASKED_KEY_RE = /sk-demo-[A-Za-z0-9_-]{16,}/;
// 遮罩：x／X／＊／* 連續 3 個以上。
const MASK_RE = /[xX*＊]{3,}/;

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
      short: '上線',
      howTo: '把上週那一頁 Drop 上去，網址（https 開頭）貼進 notes.md「### 第一次上線的網址」',
      sticky: true,
      async test(ctx) {
        const loaded = loadEp04Section(ctx);
        if (loaded.err) return { pass: false, note: loaded.err };
        const sub = subSection(loaded.section, H_FIRST_URL);
        if (!sub) {
          return { pass: false, note: `notes.md 少了『${H_FIRST_URL}』那一行標題（標題不要刪，只換下面那行）` };
        }
        const picked = pickUrl(mergeContent(sub.bodyLines));
        const cls = classifyUrl(picked);
        emit(ctx, 'ep04_1_url', cls.ok ? cls.url : picked || '');
        if (!cls.ok) return { pass: false, note: cls.note };
        const res = await fetchPage(cls.url, false);
        if (res.challenge) {
          rememberIndex(ctx);
          return {
            pass: true,
            showNote: true,
            note: '網址活著（Cloudflare 擋機器人，機器看不到內容；老師端會再驗）',
          };
        }
        if (!res.ok) return { pass: false, note: res.note };
        rememberIndex(ctx);
        return { pass: true, note: `上週那一頁抓得到（HTTP ${res.status}）` };
      },
    },
    {
      id: 'ep04_2',
      name: '關 2 做一個想要的東西',
      short: '作品',
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
          emit(ctx, 'index_title', (extractTitle(html) || '').trim());
          if (titleText.length < 1) {
            problems.push('index.html 的 <title> 裡沒有字');
          } else if (titleText === '我的第一個網頁') {
            problems.push('把「我的第一個網頁」換成你這次做的主題');
          }
          if (!/<h1|<button|<script|<input/i.test(html)) {
            problems.push('index.html 裡沒有 <h1>／<button>／<script>／<input>（做一個看得出來是你的東西）');
          }
          // v3 7.1：光有一顆按鈕不算——按下去要真的做事。空的 <script></script> 也擋掉。
          const scriptText = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
            .map((m) => m[1])
            .join('')
            .replace(/\s+/g, '');
          const hasLogic = /onclick=|addEventListener\(|function |=>/.test(html);
          if (!hasLogic || scriptText.length < 20) {
            problems.push('按鈕要真的做事：script 裡要有程式（onclick／addEventListener）');
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
            const whatBad = lengthCheck(what, 6);
            if (whatBad === 'gibberish') {
              problems.push(`notes.md「這次做的東西」${GIBBERISH_NOTE}`);
            } else if (whatBad) {
              problems.push('notes.md「這次做的東西」還沒寫到 6 個字');
            }
          }
        }

        // v2 6.3：關 1 上線的那一份 index.html 如果原封不動，就不算「這次做的東西」。
        // 沒有記憶（還沒過關 1）就不加這條，免得誤傷。
        if (ctx && typeof ctx.recall === 'function') {
          const was = ctx.recall('ep04_1_index_sha');
          if (was && was === indexSha(ctx)) {
            problems.push('index.html 還是關 1 上線的那一頁。這週要做新作品：標題換掉、加一顆按鈕，再 push');
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
      short: '分享',
      howTo: '新作品 Drop 上去，網址貼進 notes.md「### 上線網址」，而且上線那一頁要跟 repo 裡的 index.html 是同一份',
      sticky: true,
      async test(ctx) {
        const loaded = loadEp04Section(ctx);
        if (loaded.err) return { pass: false, note: loaded.err };
        const sub = subSection(loaded.section, H_LIVE_URL);
        if (!sub) {
          return { pass: false, note: `notes.md 少了『${H_LIVE_URL}』那一行標題（標題不要刪，只換下面那行）` };
        }
        const picked = pickUrl(mergeContent(sub.bodyLines));
        const cls = classifyUrl(picked);
        emit(ctx, 'ep04_3_url', cls.ok ? cls.url : picked || '');
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
        if (res.challenge) {
          return {
            pass: true,
            showNote: true,
            note: '未比對標題：網址活著（Cloudflare 擋機器人；隔壁手機打開＋老師端儀表板為準）',
          };
        }
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
      short: '密語',
      howTo: 'notes.md EP04 三問：第 1 題寫做了什麼＋驗收三件事，第 2 題貼那條帶 key 的網址（key 改成 xxxx），第 3 題寫為什麼藏不住＋通關密語',
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

        // Q1：做了什麼＋驗收三件事
        const q1bad = lengthCheck(c1, 10);
        if (q1bad === 'gibberish') problems.push(`第 1 題${GIBBERISH_NOTE}`);
        else if (q1bad) problems.push('第 1 題還沒寫到 10 個字');

        // Q2：Network 分頁那條帶 key 的網址，key 要遮起來
        if (!c2.includes(NETWORK_URL_MARK)) {
          problems.push(`第 2 題要貼出那條網址（裡面看得到 ${NETWORK_URL_MARK}）`);
        } else if (UNMASKED_KEY_RE.test(c2)) {
          problems.push('第 2 題把整支 key 原樣貼上來了——把 key 那一段改成 xxxx 再 push（連假的也不要留）');
        } else if (!MASK_RE.test(c2)) {
          problems.push('第 2 題要把 key 那一段改成 xxxx（至少三個 x）');
        }

        // Q3：為什麼藏不住＋通關密語
        const q3bad = lengthCheck(c3, 10);
        if (q3bad === 'gibberish') {
          problems.push(`第 3 題${GIBBERISH_NOTE}`);
        } else if (q3bad) {
          problems.push('第 3 題還沒寫到 10 個字');
        } else if (!hasPassphrase(c3)) {
          problems.push('第 3 題還沒有通關密語：去任務卡的解鎖框，把假網站原始碼裡的 key 貼進去，拿到密語再寫進來');
        }

        if (problems.length > 0) {
          return { pass: false, note: problems.join('；') };
        }
        return { pass: true, note: '三題都寫了，網址的 key 有遮，密語也對' };
      },
    },
  ],
};
