'use strict';

// EP06 專題時間 01 的關卡判定。
// 規則正本：00_規劃/06_專題週共用契約_v1.md 第二節（三關）與第五節（模組形狀）。
//
// ★ 這一支是 EP06–EP12 七週的樣板。要做下一週時整檔複製，**只改三處**：
//     ★1 module.exports.id      'ep06' → 'ep07'
//     ★2 module.exports.title   'EP06 專題時間 01' → 'EP07 專題時間 02'
//     ★3 WEEK                   'EP06' → 'EP07'（check 的 id 前綴、emit key、dataColumns key、
//                               關 1 要比對的「上一堂」都是從 WEEK 算出來的，不用手改）
//   其餘一個字都不要動。刻意不做參數化工廠：七個獨立檔案比一個會被七席同時改的工廠安全。
//
// 判定對象是 proj-<隊名> repo 根目錄的 專題日誌.md（七週同一份、每週一段），
// 段落解析與「該週提交」的判定都在共用層（ctx.weekStarted／weekSection／weekAuthors），本檔不自己重寫。

const WEEK = 'EP07';   // ★3
const ID = WEEK.toLowerCase();   // 'ep06'：check id 與 emit／dataColumns 的 key 前綴
// 上一堂（EP06 沒有上一堂；EP05 是 README 不是日誌，不算）——關 1 拿它比對「抄上一堂」。
const PREV_WEEK = WEEK === 'EP06' ? null : 'EP' + String(Number(WEEK.slice(2)) - 1).padStart(2, '0');

const LOG_FILE = '專題日誌.md';

// 小節標題（七週都一樣；共用層是用「開頭相符」比對，所以不必寫括號那一段）
const H_DID = '這堂做出什麼';
const H_STUCK = '卡在哪';
const H_NEXT = '下一堂各自要做什麼';

const DID_MIN = 15;
const STUCK_MIN = 10;
const NEXT_LINE_MIN = 8;
// `mrcoolsea：` 這種帳號標籤不算內容（只吃英數與連字號的帳號，中文暱稱不在此列）
const NAME_LABEL_RE = /^[A-Za-z0-9-]+[：:]\s*/;
const NEXT_LINE_COUNT = 2;
const AUTHOR_MIN = 2;

// ---------- 亂打過濾（沿用 ep03／ep04／ep05 同一套語意） ----------
// 「啊啊啊啊啊啊啊啊啊啊」湊得到 10 個字，但那不是答案。
// 兩關：① 連續重複的同一字元壓成 1 個之後再算長度 ② 去重後不同字元數要 ≥ min(5, 門檻)。
function collapseRepeats(text) {
  return String(text == null ? '' : text).replace(/(.)\1+/gu, '$1');
}
function distinctCount(text) {
  return new Set(Array.from(String(text == null ? '' : text))).size;
}
const GIBBERISH_NOTE = '像亂打的（同一個字一直重複）';
// 比對「有沒有抄上一堂」時用：去掉所有空白（含換行），只比字。
function squeeze(text) {
  return String(text == null ? '' : text).replace(/\s+/g, '');
}
function lengthCheck(text, min) {
  const collapsed = collapseRepeats(text);
  if (collapsed.length < min) return 'short';
  if (distinctCount(collapsed) < Math.min(5, min)) return 'gibberish';
  return null;
}

// 編碼閘（沿用 EP03 v3）：Big5／ANSI 存檔被當 UTF-8 讀會出現 U+FFFD，
// 這種日誌在 GitHub 上是亂碼，且中文標題錨點全失效會誤判成「已填」。一律 ❌。
const BAD_ENC_NOTE =
  '存成了 Big5／ANSI，GitHub 上看到的是亂碼：用 VS Code 打開它 → 右下角點編碼 → Save with Encoding → UTF-8 → 重新 commit push';

const HEADING_NOTE = '標題不要改名或刪掉（`## ' + WEEK + ' …`、`### ' + H_DID + '…`）';

// 讀該週某個小節：回 { err } 或 { lines, text }。
// lines＝已扣提示行與空行的內容行；text＝整段接起來（算字數用）。
function loadSection(ctx, subHeading) {
  const raw = ctx.readFile(LOG_FILE);
  if (raw === null) {
    return { err: `找不到 ${LOG_FILE}（這週要 pull 最新的 proj-隊名 repo；檔案是老師種好的，不要改檔名）` };
  }
  if (raw.includes('�')) {
    return { err: `${LOG_FILE} ${BAD_ENC_NOTE}` };
  }
  const content = ctx.weekSection(WEEK, subHeading);
  if (content === null) {
    return { err: `找不到「## ${WEEK}」底下的「### ${subHeading}」：${HEADING_NOTE}` };
  }
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return { lines, text: lines.join('') };
}

// 老師的 commit 被扣掉時要說出來（不然那幾筆會整個消失）：學生坐老師的示範機、
// 或全域 git 身分還留著老師時，訊息只說「只有 1 個人」，跟「身分沒設回來」疊在一起會非常難查。
// 這一句擺在人數後面（不是句尾）：run.js 把機器可讀的 note 截到 60 字，擺句尾會被切掉。
function teacherNote(authors) {
  return authors.teacherCommits > 0 ? `（其中 ${authors.teacherCommits} 筆是老師帳號，不算）` : '';
}

// run.js 提供 ctx.emit(key, value)，寫進尾註 JSON 的 data（老師端儀表板用；不影響任何燈）。
function emit(ctx, key, value) {
  if (ctx && typeof ctx.emit === 'function') ctx.emit(key, String(value == null ? '' : value));
}

// 關 3 的分母：該週起點（含）之後、扣掉老師、去重的作者，連同 `2(3/1)` 這個給老師看的摘要，
// 全部由共用層算好（契約第三節演算法、第四節 v1.1 回傳）。各週模組不自己數。
function weekAuthors(ctx) {
  const wa =
    typeof ctx.weekAuthors === 'function'
      ? ctx.weekAuthors(WEEK)
      : { started: false, startSha: null, authors: [], names: [], summary: '0', shallow: false, teacherCommits: 0 };
  const names = Array.isArray(wa && wa.names) ? wa.names : [];
  const summary = (wa && wa.summary) || '0';
  return {
    size: Array.isArray(wa && wa.authors) ? wa.authors.length : 0,
    shallow: Boolean(wa && wa.shallow),
    teacherCommits: Number(wa && wa.teacherCommits) || 0,
    // 儀表板的「作者」欄：`2(5/3) mrcoolsea,yuting`——人數與各自筆數之後接帳號，
    // 老師掃到不認識的帳號才看得出「這一組多了一個人／少了一個人」（P1-11）。
    summary: names.length > 0 ? `${summary} ${names.join(',')}` : summary,
  };
}

module.exports = {
  id: 'ep07',                       // ★1
  title: 'EP07 專題時間 02',         // ★2
  // 該週段落還沒被填＝這堂還沒開始（或這個 repo 根本不是專題 repo）：整張表不印。
  // 沒有這條的話，學生 EP06 打開 Issue 會看到 EP07–EP12 六張全紅的表。
  appliesTo(ctx) {
    return typeof ctx.weekStarted === 'function' && ctx.weekStarted(WEEK);
  },
  // 老師端儀表板的 data 欄位（契約第二節 v1.1）：「這堂做了什麼」掃一眼知道誰停在原地，
  // 「作者」是關 3 真正的分母——老師不用點進 repo 就看得出哪一組是一個人在代打。
  // key 一律帶週次前綴：尾註的 data 是一張平表，七週共用 `did`／`authors` 會互相覆蓋
  // （實測 EP06 的表印在畫面上、data.did 卻是 EP07 的文字）。
  dataColumns: [
    { key: `${ID}_did`, label: '這堂做了什麼', width: 20 },
    { key: `${ID}_authors`, label: '作者', width: 26 },   // 值長得像 2(1/1) mrcoolsea,yuting，寬度要放得下
  ],
  checks: [
    {
      id: `${ID}_1`,
      name: '關 1 這堂做出什麼',
      short: '進度',
      howTo: `專題日誌「## ${WEEK}」的「### ${H_DID}（看得到的）」寫這堂多出來的那個東西（≥${DID_MIN} 字，寫看得到的：多了哪個畫面、哪個按鈕會動了）`,
      test(ctx) {
        const sec = loadSection(ctx, H_DID);
        if (sec.err) return { pass: false, note: sec.err };

        // 儀表板的「這堂做了什麼」欄：段首 20 字。不管過不過都送，老師才掃得到停在原地的組。
        emit(ctx, `${ID}_did`, Array.from(sec.text).slice(0, 20).join(''));

        const bad = lengthCheck(sec.text, DID_MIN);
        if (bad === 'gibberish') return { pass: false, note: `「${H_DID}」${GIBBERISH_NOTE}` };
        if (bad) {
          return {
            pass: false,
            note: `「${H_DID}」還沒寫到 ${DID_MIN} 個字：寫看得到的那一個（多了哪個畫面、哪個按鈕會動了）`,
          };
        }

        // 抄上一堂（D4）：七週共用同一份日誌，把上一段整段複製貼下來，
        // 字數與亂打過濾都擋不住——那是「這學期最貴的洞」，因為七週會重複七次。
        // 上一堂讀不到（EP06 沒有上一堂、或那一段還沒填）就跳過，不影響其他判定。
        if (PREV_WEEK && typeof ctx.weekSection === 'function') {
          const prev = ctx.weekSection(PREV_WEEK, H_DID);
          if (prev !== null && squeeze(prev).length > 0 && squeeze(prev) === squeeze(sec.text)) {
            return { pass: false, note: '這一段跟上一堂一模一樣，寫這一堂真的做了什麼' };
          }
        }

        return { pass: true, note: '這堂多出來的東西寫下來了' };
      },
    },
    {
      id: `${ID}_2`,
      name: '關 2 卡在哪',
      short: '卡點',
      howTo: `專題日誌「## ${WEEK}」的「### ${H_STUCK}」寫這堂被什麼擋住（≥${STUCK_MIN} 字；沒卡住也要寫「沒卡住，因為…」）`,
      test(ctx) {
        const sec = loadSection(ctx, H_STUCK);
        if (sec.err) return { pass: false, note: sec.err };

        const bad = lengthCheck(sec.text, STUCK_MIN);
        if (bad === 'gibberish') return { pass: false, note: `「${H_STUCK}」${GIBBERISH_NOTE}` };
        if (bad) {
          return {
            pass: false,
            note: `「${H_STUCK}」還沒寫到 ${STUCK_MIN} 個字：真的沒卡住就寫「沒卡住，因為…」，也要寫滿`,
          };
        }
        return { pass: true, note: '卡在哪寫清楚了（下一堂老師先看這一格）' };
      },
    },
    {
      id: `${ID}_3`,
      name: '關 3 兩人各自動手',
      short: '兩人',
      howTo: `專題日誌「## ${WEEK}」的「### ${H_NEXT}」兩人各一行（\`- \` 開頭、各 ≥${NEXT_LINE_MIN} 字），而且這一堂兩個人都要用自己的帳號 commit push`,
      test(ctx) {
        const authors = weekAuthors(ctx);
        emit(ctx, `${ID}_authors`, authors.summary);

        const sec = loadSection(ctx, H_NEXT);
        if (sec.err) return { pass: false, note: sec.err };

        const problems = [];

        // 提示行已經在共用層濾掉了——`- 帳號：（換成你的話）` 原封不動就不算一行，
        // 兩人真的各寫一句才數得到兩行。
        // 字數要**先去掉行首的 `- ` 與 `帳號：` 標籤**再算（契約第二節 v1.1）：
        // 不去掉的話，留著 `- mrcoolsea：` 後面一個字都不寫也有 11 字，燈會白亮。
        const bullets = sec.lines
          .filter((l) => /^-\s/.test(l))
          .map((l) => l.replace(/^-\s+/, '').replace(NAME_LABEL_RE, '').trim())
          .filter((l) => lengthCheck(l, NEXT_LINE_MIN) === null);
        if (bullets.length < NEXT_LINE_COUNT) {
          problems.push(
            `「${H_NEXT}」要有兩行「- 」開頭、各至少 ${NEXT_LINE_MIN} 個字（A 一句、B 一句，下一堂看得出有沒有做）`
          );
        }

        if (authors.shallow) {
          // 歷史不完整（淺 clone）：判不了「這一堂誰動手」，不要給一個錯的答案。
          problems.push('歷史不完整，這一關請看老師端');
        } else if (authors.size < AUTHOR_MIN) {
          problems.push(
            `這一堂只有 ${authors.size} 個人 commit${teacherNote(authors)}：另一個人要用自己的帳號 commit push，一個人代打燈不會亮`
          );
        }

        if (problems.length > 0) return { pass: false, note: problems.join('；') };
        return { pass: true, note: `下一堂兩人各一句，這一堂有 ${authors.summary} 個人 commit${teacherNote(authors)}` };
      },
    },
  ],
};
