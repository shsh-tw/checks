#!/usr/bin/env node
'use strict';

// EP03 起的關卡檢查器。零依賴，只用 Node 內建模組（避免 Node 22+ 才有的 API，runner 是 Node 20）。
//
// v3 架構（規格：週次/EP04_Vibe coding部署/闖關/checks_spec_ep04.md 第一節）：
//   程式集中在公開 repo shsh-tw/checks，學生 repo 的 workflow 用第二個 checkout 把它放到 .checks/。
//   ROOT＝process.cwd()（學生 repo 根），模組從 __dirname 載（也就是 .checks/ 或 checks/，看放哪）。
//
// 用法：
//   GITHUB_ACTIONS=true node .checks/run.js   → 更新 Issue「🏁 闖關進度」＋寫 $GITHUB_STEP_SUMMARY＋stdout
//   node .checks/run.js                        → 只印完整 Markdown 到 stdout（本機用）
//   node .checks/run.js --json                 → 只印一行 JSON（尾註那段），給老師儀表板 --local 用
//   CHECKS_EVER_JSON='{"ep04_1":"2026-09-07T01:23:00.000Z"}' node .checks/run.js
//                                              → 本機模式注入「曾經通過」紀錄（測試用；Actions 模式改讀 Issue 尾註）

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const CHECKS_DIR = __dirname;

// 掃描 repo 檔案時一律排除的路徑前綴（檢查器自己、git 內部、workflow）。
const EXCLUDE_DIR_PREFIXES = ['.checks/', 'checks/', '.git/', '.github/'];
// std_secret 額外排除的檔名（AI 指針與說明檔，本來就會寫到 key 這個詞）。
const SECRET_SKIP_BASENAMES = ['AGENTS.md', 'CLAUDE.md', 'README.md'];
const SECRET_MAX_BYTES = 200 * 1024;

// ---------- 基本工具 ----------

function readFile(relPath) {
  try {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  } catch (e) {
    return null;
  }
}

function existsPath(relPath) {
  try {
    fs.accessSync(path.join(ROOT, relPath));
    return true;
  } catch (e) {
    return false;
  }
}

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, cwd: ROOT });
}

function getCommits() {
  let raw = '';
  try {
    raw = sh('git log --format=%H%x1f%ae%x1f%ce%x1f%s');
  } catch (e) {
    raw = '';
  }
  const rows = raw.split('\n').filter((l) => l.length > 0);
  const commits = rows.map((row) => {
    const parts = row.split('\x1f');
    const sha = parts[0] || '';
    const authorEmail = parts[1] || '';
    const committerEmail = parts[2] || '';
    const subject = parts.slice(3).join('\x1f');
    return { sha, authorEmail, committerEmail, subject };
  });

  let rootShas = new Set();
  try {
    const rootRaw = sh('git rev-list --max-parents=0 HEAD');
    rootRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => rootShas.add(s));
  } catch (e) {
    // 沒有 git 歷史或指令失敗：視為沒有 root（不理想但不讓整支掛掉）
  }

  return commits.map((c) => Object.assign({}, c, { isRoot: rootShas.has(c.sha) }));
}

// git 追蹤中的檔案清單（排除檢查器自己與 .git／.github）。
function getTrackedFiles() {
  let raw = '';
  try {
    raw = sh('git ls-files -z');
  } catch (e) {
    return [];
  }
  return raw
    .split('\0')
    .filter((p) => p.length > 0)
    .filter((p) => !EXCLUDE_DIR_PREFIXES.some((pre) => p === pre.slice(0, -1) || p.startsWith(pre)));
}

// 模組可以用 ctx.emit(key, value) 往尾註 JSON 的 data 塞旁路資料（規格 5.2）——
// 例如學生貼的網址、repo 的 index.html title，讓老師端儀表板不必重跑判定就能自己再驗一次。
// 不影響任何燈的判定；值一律轉字串並截 300 字，免得撐爆 Issue 內文。
const emitted = {};
function emit(key, value) {
  const k = String(key == null ? '' : key);
  if (!k) return;
  const v = String(value == null ? '' : value);
  emitted[k] = v.length > 300 ? v.slice(0, 300) : v;
}

// 持久記憶（規格 6.2）：跟 ever 一樣存在 Issue 尾註裡，跨 push 活著。
// 用途是「這件事之前發生過」——例如關 1 上線時 index.html 長什麼樣，關 2 才判得出有沒有換新作品。
// 只寫一次（第一次寫入後就不再覆蓋），值截 200 字。
const mem = {};
// recall 讀的是「這次跑之前就已經存在的記憶」的快照，不是這次剛寫進去的。
// 不這樣分開的話，同一次 push 裡先跑的 check 寫入、後跑的 check 立刻讀到，
// 「一次 push 就把整週做完」的學生會被自己剛寫的記憶判死（ep04_2 會誤判成沒做新作品）。
let memAtStart = {};
function snapshotMem() {
  memAtStart = Object.assign({}, mem);
}
function remember(key, value) {
  const k = String(key == null ? '' : key);
  if (!k) return;
  if (Object.prototype.hasOwnProperty.call(mem, k)) return; // 只在尚未存在時寫入
  const v = String(value == null ? '' : value);
  mem[k] = v.length > 200 ? v.slice(0, 200) : v;
}
function recall(key) {
  const k = String(key == null ? '' : key);
  return Object.prototype.hasOwnProperty.call(memAtStart, k) ? memAtStart[k] : null;
}

const ctx = {
  readFile,
  exists: existsPath,
  commits: getCommits(),
  trackedFiles: getTrackedFiles(),
  emit,
  remember,
  recall,
};

// ---------- 載入 ep*.js 模組（依檔名排序，從 __dirname） ----------

function loadEpModules() {
  let files = [];
  try {
    files = fs
      .readdirSync(CHECKS_DIR)
      .filter((f) => /^ep.*\.js$/.test(f))
      .sort();
  } catch (e) {
    files = [];
  }
  return files.map((f) => {
    try {
      return require(path.join(CHECKS_DIR, f));
    } catch (e) {
      return {
        id: f,
        title: f,
        checks: [
          {
            id: f,
            name: f,
            howTo: '',
            test() {
              return { pass: false, note: `檢查器錯誤：模組載入失敗：${e && e.message ? e.message : String(e)}` };
            },
          },
        ],
      };
    }
  });
}

// ---------- 內建「每週都看」模組 ----------

const EMAIL_RE = /^\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com$/;
const MSG_BLACKLIST = [
  'update', 'updated', '修改', '作業', '交作業', '上傳', '更新',
  'aaa', 'asd', 'qwe', 'test', 'fix', 'commit', 'wip', 'done', 'ok', '123', '完成', '交',
  'test1', '測試',
];
// 這幾句就算包在更長的訊息裡也一樣沒說做了什麼，改用子字串比對。
const MSG_BLACKLIST_SUBSTR = ['改了一些東西', '修改一些東西', '改東西', '一些東西'];
// 9.1 最終清單（簡體字，去重後）：判定用，不分 notes.md／index.html。
const SIMPLIFIED_CHARS = [
  '这', '说', '们', '网', '页', '电', '脑', '编', '码', '浏', '览', '时', '间', '进', '开',
  '应', '该', '会', '让', '请', '帮', '写', '学', '习', '为', '问', '题', '记', '录', '讲',
  '释', '认', '识', '错', '误', '显', '标', '签', '结', '构', '样', '设', '计', '运', '执',
  '现', '实', '际',
];

// 🔒 沒有 secret（EP04 起常駐）：規格 checks_spec_ep04.md 第一節 5.
// 值一律只印前 4 碼，絕不印完整值。
const SECRET_PATTERNS = [
  { name: 'OpenAI 型', re: /\bsk-[A-Za-z0-9_-]{16,}/, group: 0 },
  { name: 'Google API', re: /\bAIza[0-9A-Za-z_-]{30,}/, group: 0 },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/, group: 0 },
  { name: 'Slack', re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/, group: 0 },
  { name: '私鑰', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, group: 0 },
  { name: 'Cloudflare claim 權杖', re: /claimToken=([A-Za-z0-9_.-]{6,})/, group: 1 },
  { name: 'Cloudflare claim 權杖', re: /dash\.cloudflare\.com\/claim-preview/, group: 0 },
  {
    name: '一般指派',
    re: /\b(?:api[_-]?key|apikey|secret|token|password)\s*[:=]\s*["']([^"'\s]{12,})["']/i,
    group: 1,
  },
];

function isTrackedEnvFile(p) {
  const base = p.split('/').pop();
  if (base === '.env.example') return false;
  return base === '.env' || base.startsWith('.env.');
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function scanSecrets(files) {
  for (const p of files) {
    if (isTrackedEnvFile(p)) {
      return { kind: 'env', file: p };
    }
  }
  for (const p of files) {
    const base = p.split('/').pop();
    if (SECRET_SKIP_BASENAMES.includes(base)) continue;
    let buf;
    try {
      const st = fs.statSync(path.join(ROOT, p));
      if (!st.isFile() || st.size > SECRET_MAX_BYTES) continue;
      buf = fs.readFileSync(path.join(ROOT, p));
    } catch (e) {
      continue;
    }
    if (looksBinary(buf)) continue;
    const text = buf.toString('utf8');
    for (const pat of SECRET_PATTERNS) {
      const m = text.match(pat.re);
      if (m) {
        const value = String(pat.group === 0 ? m[0] : m[pat.group] || m[0]);
        return { kind: 'key', file: p, head4: value.slice(0, 4), patternName: pat.name };
      }
    }
  }
  return null;
}

const WEEKLY = {
  checks: [
    {
      id: 'std_email',
      name: '🪪 專用信箱',
      test(c) {
        if (!c.commits || c.commits.length === 0) {
          return { pass: false, note: '還沒有任何 commit' };
        }
        const latest = c.commits[0];
        const pass = EMAIL_RE.test(latest.authorEmail || '');
        const mismatchCount = c.commits.filter(
          (x) => !x.isRoot && !EMAIL_RE.test(x.authorEmail || '')
        ).length;
        let note;
        if (pass) {
          // 9.2：✅ 但歷史有錯時，note 改成這句（不用處理，之後對就好），取代舊的附加寫法。
          note =
            mismatchCount > 0
              ? `最新一則是專用信箱（之前有 ${mismatchCount} 則用錯信箱，不用處理，之後對就好）`
              : '最新一則 commit 用的是 數字+帳號@users.noreply.github.com';
        } else {
          note = `最新一則 commit 的信箱不是專用信箱格式（目前是 ${latest.authorEmail || '（空白）'}）`;
          if (mismatchCount > 0) {
            note += `；歷史上有 ${mismatchCount} 則不是專用信箱`;
          }
        }
        return { pass, note };
      },
    },
    {
      id: 'std_msg',
      name: '✍️ commit 訊息',
      test(c) {
        const nonRoot = (c.commits || []).filter((x) => !x.isRoot);
        const recent5 = nonRoot.slice(0, 5);
        if (recent5.length === 0) {
          return { pass: false, note: '還沒有自己的 commit' };
        }
        const bad = recent5.filter((x) => {
          const s = (x.subject || '').trim();
          if (s.length < 4) return true;
          if (MSG_BLACKLIST.includes(s.toLowerCase())) return true;
          if (MSG_BLACKLIST_SUBSTR.some((b) => s.includes(b))) return true;
          return false;
        });
        if (bad.length === 0) {
          return { pass: true, note: '最近的 commit 訊息都有寫清楚做了什麼' };
        }
        const examples = bad
          .slice(0, 2)
          .map((x) => `「${x.subject}」`)
          .join('、');
        return {
          pass: false,
          note: `最近 5 則裡有 ${bad.length} 則沒寫做了什麼（例：${examples}）`,
        };
      },
    },
    {
      id: 'std_local',
      name: '💻 本機 commit',
      test(c) {
        const nonRoot = (c.commits || []).filter((x) => !x.isRoot);
        const pass = nonRoot.some((x) => (x.committerEmail || '').toLowerCase() !== 'noreply@github.com');
        const note = pass
          ? '有從自己電腦 push 的 commit'
          : '目前的 commit 都是在網頁上改的（github.dev）——走備援的人這格 ❌ 是正常的';
        return { pass, note };
      },
    },
    {
      id: 'std_zh',
      name: '🇹🇼 正體中文',
      test(c) {
        const _n = c.readFile('notes.md'); const _h = c.readFile('index.html');
        if ((typeof _n === 'string' && _n.includes('�')) || (typeof _h === 'string' && _h.includes('�'))) {
          return { pass: false, note: '檔案不是 UTF-8（看到亂碼），用 VS Code Save with Encoding → UTF-8 再 push' };
        }
        const notesText = c.readFile('notes.md') || '';
        const htmlText = c.readFile('index.html') || '';
        const combined = notesText + htmlText;
        const hits = [];
        for (const ch of SIMPLIFIED_CHARS) {
          if (combined.includes(ch)) {
            hits.push(ch);
            if (hits.length >= 5) break;
          }
        }
        if (hits.length === 0) {
          return { pass: true, note: '沒看到簡體字' };
        }
        return { pass: false, note: `notes.md 或 index.html 裡有簡體字：${hits.join('、')}` };
      },
    },
    {
      id: 'std_secret',
      name: '🔒 沒有 secret',
      test(c) {
        const hit = scanSecrets(c.trackedFiles || []);
        if (!hit) {
          return { pass: true, note: 'repo 裡沒有像 key 的東西、沒有 .env' };
        }
        if (hit.kind === 'env') {
          return {
            pass: false,
            note: `\`${hit.file}\`：這種檔不要進 repo（裡面通常是 key）。刪掉再 push；已 push 過的要找老師`,
          };
        }
        return {
          pass: false,
          note: `\`${hit.file}\`：有像 key 的東西（\`${hit.head4}\`…，${hit.patternName}）。連假的也不要放，刪掉再 push；已 push 過的要找老師`,
        };
      },
    },
  ],
};

// ---------- 模組適用性（規格 checks_spec_ep05.md 第四節之二） ----------

// 模組可宣告 appliesTo(ctx)：回 false 代表「這個 repo 不是這一週的形狀」，整張表不印、也不進 results。
// 起因是 EP05：專題週的 proj-<隊名> repo 沒有 notes.md／index.html，EP03 與 EP04 那兩張表在那裡
// 結構上必然七格全 ❌——學生打開 Issue 先看到一片紅，但那不是他沒做，是表根本不該出現。
// 沒宣告 appliesTo 的模組一律視為適用（向後相容）；宣告的函式自己炸掉也視為適用（寧可多印一張表，
// 也不要因為一個例外就讓整週的判定憑空消失）。
function moduleApplies(mod, c) {
  if (!mod || typeof mod.appliesTo !== 'function') return true;
  try {
    return mod.appliesTo(c) !== false;
  } catch (e) {
    return true;
  }
}

// ---------- 執行單一 test，捕捉例外（支援 async test） ----------

async function safeTest(check, c) {
  if (typeof check.test !== 'function') {
    return { pass: null, note: '' }; // watch-only（例如「登出儀式」），不判
  }
  try {
    const r = await check.test(c);
    if (!r || typeof r.pass !== 'boolean') {
      return { pass: false, note: '檢查器錯誤：test() 回傳格式不正確' };
    }
    return r;
  } catch (e) {
    return { pass: false, note: `檢查器錯誤：${e && e.message ? e.message : String(e)}` };
  }
}

// ---------- 台灣時間格式化 ----------

function taipeiParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  if (parts.hour === '24') parts.hour = '00'; // 部分 ICU 版本午夜會給 24，修正成 00
  return parts;
}

function taipeiTimeString(date) {
  const p = taipeiParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function taipeiShort(isoLike) {
  const d = new Date(isoLike);
  if (isNaN(d.getTime())) return '之前';
  const p = taipeiParts(d);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// ---------- 通過後保留（sticky，規格第一節 4.） ----------

function sanitizeEver(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw)) {
    if (typeof raw[k] === 'string' && raw[k].length > 0) out[k] = raw[k];
  }
  return out;
}

// 把既有尾註（或環境變數）裡的 mem 灌回來；只收字串值。
function loadMem(raw) {
  if (!raw || typeof raw !== 'object') return;
  for (const k of Object.keys(raw)) {
    if (typeof raw[k] === 'string' && raw[k].length > 0) mem[k] = raw[k];
  }
}

function parseTailJson(body) {
  if (!body) return null;
  const m = String(body).match(/<!--\s*checks:(\{[\s\S]*?\})\s*-->/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

// 本次 ❌ 但 ever 有紀錄 → 狀態改 ✅、note 改「曾於 …」；本次 ✅ → 更新 ever[id]=now。
async function runOneCheck(check, c, ever, nowIso) {
  const r = await safeTest(check, c);
  if (r.pass === null) return r;
  // nowPass＝本次實際判定（不含 sticky 救援），會另外記進尾註的 results_now：
  // 老師要看得出「這格是真的過，還是靠曾經過撐著」。
  if (r.pass) {
    if (check.sticky) ever[check.id] = nowIso;
    return Object.assign({}, r, { nowPass: true });
  }
  if (check.sticky && ever[check.id]) {
    return {
      pass: true,
      nowPass: false,
      rescued: true,
      note: `曾於 ${taipeiShort(ever[check.id])} 通過（本次：${truncateNote(r.note || '抓不到', 60)}）`,
    };
  }
  return Object.assign({}, r, { nowPass: false });
}

// ---------- 組 Markdown ----------

function truncateNote(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n) : t;
}

async function buildMarkdown(epModules, c, ever) {
  const lines = [];
  const results = {};
  const resultsNow = {};
  const notes = {};
  const now = new Date();
  const nowIso = now.toISOString();

  lines.push('## 🏁 闖關進度（自動更新，push 之後等十幾秒到 1 分鐘再重新整理）');
  lines.push('');

  let anyFail = false;

  for (const mod of epModules) {
    if (!moduleApplies(mod, c)) continue;   // 這個 repo 不是這一週的形狀：整張表不印、也不進 results
    lines.push(`### ${mod.title}`);
    lines.push('| 關 | 狀態 | 怎麼過／為什麼沒過 |');
    lines.push('|---|---|---|');
    for (const check of mod.checks) {
      const r = await runOneCheck(check, c, ever, nowIso);
      let status;
      let thirdCol = check.howTo;
      if (r.pass === null) {
        status = '👀';
      } else {
        status = r.pass ? '✅' : '❌';
        results[check.id] = r.pass;
        resultsNow[check.id] = r.nowPass === true;
        if (r.pass) {
          // ✅ 預設印 howTo（EP03 規格 9.2）；sticky 救回來的、或 check 自己要求的（showNote）才改印 note，
          // 例如「網址活著但 Cloudflare 擋機器人」這種學生需要知道的但書。
          if ((r.rescued || r.showNote) && r.note) thirdCol = r.note;
        } else {
          anyFail = true;
          if (r.note) notes[check.id] = truncateNote(r.note, 60);
          thirdCol = r.note || check.howTo;
        }
      }
      lines.push(`| ${check.name} | ${status} | ${thirdCol} |`);
    }
    lines.push('');
  }

  lines.push('### 每週都看');
  lines.push('| 項目 | 狀態 | 說明 |');
  lines.push('|---|---|---|');
  for (const check of WEEKLY.checks) {
    const r = await runOneCheck(check, c, ever, nowIso);
    const status = r.pass ? '✅' : '❌';
    results[check.id] = !!r.pass;
    resultsNow[check.id] = r.nowPass === true;
    if (!r.pass) {
      anyFail = true;
      if (r.note) notes[check.id] = truncateNote(r.note, 60);
    }
    lines.push(`| ${check.name} | ${status} | ${r.note} |`);
  }
  lines.push('');

  const sha = c.commits && c.commits[0] ? c.commits[0].sha.slice(0, 7) : 'unknown';
  const fullSha = c.commits && c.commits[0] ? c.commits[0].sha : '';
  const runUrl = process.env.RUN_URL || '#';
  const timeStr = taipeiTimeString(now);

  lines.push(`最後檢查：${timeStr}（台灣時間）・commit \`${sha}\`・[檢查紀錄](${runUrl})`);
  if (anyFail) {
    lines.push('❌ 怎麼辦：打開教材站這一週的任務卡，找那一關的「卡住了」。');
  } else {
    lines.push('🎉 這週的燈都亮了。關 4 登出儀式記得找隔壁互查。');
  }

  const tail = {
    ts: nowIso,
    sha: fullSha,
    results,
    results_now: resultsNow,
    notes,
    ever,
    data: emitted,
    mem,
  };
  lines.push(`<!-- checks:${JSON.stringify(tail)} -->`);

  return { markdown: lines.join('\n'), tail, anyFail };
}

// ---------- Issue（EP03 規格第五節） ----------

const ISSUE_TITLE = '🏁 闖關進度';

function findIssue() {
  try {
    const listOut = sh('gh issue list --state all --limit 100 --json number,title,state');
    const issues = JSON.parse(listOut);
    return issues.find((i) => i.title === ISSUE_TITLE) || null;
  } catch (e) {
    console.log(`⚠ 無法讀取 Issue 清單：${e && e.message ? e.message : String(e)}`);
    return null;
  }
}

function readIssueBody(number) {
  try {
    return sh(`gh issue view ${number} --json body --jq .body`);
  } catch (e) {
    console.log(`⚠ 無法讀取 Issue 內文：${e && e.message ? e.message : String(e)}`);
    return '';
  }
}

function writeIssue(found, markdown) {
  let bodyFile = null;
  try {
    bodyFile = path.join(os.tmpdir(), `checks-issue-body-${process.pid}.md`);
    fs.writeFileSync(bodyFile, markdown, 'utf8');

    if (found) {
      const state = String(found.state || '').toUpperCase();
      if (state === 'CLOSED') {
        sh(`gh issue reopen ${found.number}`);
      }
      sh(`gh issue edit ${found.number} --body-file "${bodyFile}"`);
    } else {
      sh(`gh issue create --title "${ISSUE_TITLE}" --body-file "${bodyFile}"`);
    }
  } catch (e) {
    console.log(`⚠ 無法更新 Issue：${e && e.message ? e.message : String(e)}`);
  } finally {
    if (bodyFile) {
      try {
        fs.unlinkSync(bodyFile);
      } catch (e2) {
        // 忽略清檔失敗
      }
    }
  }
}

// ---------- main ----------

async function main() {
  const epModules = loadEpModules();
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const isActions = process.env.GITHUB_ACTIONS === 'true';

  // sticky：Actions 模式先讀既有 Issue 尾註拿 ever；本機模式吃 CHECKS_EVER_JSON（沒有就是純當下）。
  let issue = null;
  let ever = {};
  if (isActions) {
    issue = findIssue();
    if (issue) {
      const tail = parseTailJson(readIssueBody(issue.number));
      ever = sanitizeEver(tail && tail.ever);
      loadMem(tail && tail.mem);
    }
  } else {
    if (process.env.CHECKS_EVER_JSON) {
      try {
        ever = sanitizeEver(JSON.parse(process.env.CHECKS_EVER_JSON));
      } catch (e) {
        ever = {};
      }
    }
    if (process.env.CHECKS_MEM_JSON) {
      try {
        loadMem(JSON.parse(process.env.CHECKS_MEM_JSON));
      } catch (e) {
        // 壞掉的 JSON 當作沒有記憶
      }
    }
  }

  snapshotMem(); // 記憶讀完了，凍結一份給 ctx.recall 用（見上面的說明）

  const { markdown, tail } = await buildMarkdown(epModules, ctx, ever);

  if (isActions) {
    writeIssue(issue, markdown);
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
      } catch (e) {
        console.log(`⚠ 無法寫入 Job Summary：${e && e.message ? e.message : String(e)}`);
      }
    }
    console.log(markdown);
  } else {
    if (jsonOnly) {
      console.log(JSON.stringify(tail));
    } else {
      console.log(markdown);
    }
  }
}

main().catch((e) => {
  console.log(`檢查器錯誤：${e && e.message ? e.message : String(e)}`);
  // 不讓整支掛掉：exit code 維持 0（不呼叫 process.exit(非0)）。
});
