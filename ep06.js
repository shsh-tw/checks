'use strict';

// EP06 專題時間 01 的關卡判定。
// 規則正本：00_規劃/06_專題週共用契約_v1.md 第二節（三關）與第五節（模組形狀）。
//
// ★ 這一支是 EP06–EP12 七週的樣板。要做下一週時整檔複製，**只改三處**：
//     ★1 module.exports.id      'ep06' → 'ep07'
//     ★2 module.exports.title   'EP06 專題時間 01' → 'EP07 專題時間 02'
//     ★3 WEEK                   'EP06' → 'EP07'（check 的 id 前綴是從 WEEK 算出來的，不用手改）
//   其餘一個字都不要動。刻意不做參數化工廠：七個獨立檔案比一個會被七席同時改的工廠安全。
//
// 判定對象是 proj-<隊名> repo 根目錄的 專題日誌.md（七週同一份、每週一段），
// 段落解析與「該週提交」的判定都在共用層（ctx.weekStarted／weekSection／weekAuthors），本檔不自己重寫。

const WEEK = 'EP06';   // ★3

const LOG_FILE = '專題日誌.md';

// 小節標題（七週都一樣；共用層是用「開頭相符」比對，所以不必寫括號那一段）
const H_DID = '這堂做出什麼';
const H_STUCK = '卡在哪';
const H_NEXT = '下一堂各自要做什麼';

const DID_MIN = 15;
const STUCK_MIN = 10;
const NEXT_LINE_MIN = 8;
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

// run.js 提供 ctx.emit(key, value)，寫進尾註 JSON 的 data（老師端儀表板用；不影響任何燈）。
function emit(ctx, key, value) {
  if (ctx && typeof ctx.emit === 'function') ctx.emit(key, String(value == null ? '' : value));
}

// 關 3 的分母：該週起點（含）之後、扣掉老師、去重的作者。演算法在共用層（契約第三節）。
// 這裡只多做一件事：把每個人在該週範圍內的 commit 筆數數出來，emit 成 `2(3/1)` 給老師看——
// 「B 只補了一個句號」這種假分工掃一眼就看得出來，不加判定條件。
function weekAuthorStats(ctx) {
  const wa =
    typeof ctx.weekAuthors === 'function'
      ? ctx.weekAuthors(WEEK)
      : { started: false, startSha: null, authors: [] };
  const authors = wa && Array.isArray(wa.authors) ? wa.authors : [];
  const set = new Set(authors);
  const counts = new Map();
  if (wa && wa.startSha) {
    const all = (ctx && ctx.commits) || [];
    const idx = all.findIndex((c) => String(c.sha || '').startsWith(wa.startSha));
    const range = idx >= 0 ? all.slice(0, idx + 1) : [];
    for (const c of range) {
      const e = String(c.authorEmail || '').trim().toLowerCase();
      if (!set.has(e)) continue;
      counts.set(e, (counts.get(e) || 0) + 1);
    }
  }
  const each = [...counts.values()].sort((a, b) => b - a);
  const size = set.size;
  return { size, summary: size === 0 ? '0' : `${size}(${each.join('/')})` };
}

module.exports = {
  id: 'ep06',                       // ★1
  title: 'EP06 專題時間 01',         // ★2
  // 該週段落還沒被填＝這堂還沒開始（或這個 repo 根本不是專題 repo）：整張表不印。
  // 沒有這條的話，學生 EP06 打開 Issue 會看到 EP07–EP12 六張全紅的表。
  appliesTo(ctx) {
    return typeof ctx.weekStarted === 'function' && ctx.weekStarted(WEEK);
  },
  // 老師端儀表板的 data 欄位：掃一眼就知道每一組這堂做出了什麼。
  dataColumns: [{ key: 'did', label: '這堂做了什麼', width: 20 }],
  checks: [
    {
      id: `${WEEK.toLowerCase()}_1`,
      name: '關 1 這堂做出什麼',
      short: '進度',
      howTo: `專題日誌「## ${WEEK}」的「### ${H_DID}（看得到的）」寫這堂多出來的那個東西（≥${DID_MIN} 字，寫看得到的：多了哪個畫面、哪個按鈕會動了）`,
      test(ctx) {
        const sec = loadSection(ctx, H_DID);
        if (sec.err) return { pass: false, note: sec.err };

        // 儀表板的「這堂做了什麼」欄：段首 20 字。不管過不過都送，老師才掃得到停在原地的組。
        emit(ctx, 'did', Array.from(sec.text).slice(0, 20).join(''));

        const bad = lengthCheck(sec.text, DID_MIN);
        if (bad === 'gibberish') return { pass: false, note: `「${H_DID}」${GIBBERISH_NOTE}` };
        if (bad) {
          return {
            pass: false,
            note: `「${H_DID}」還沒寫到 ${DID_MIN} 個字：寫看得到的那一個（多了哪個畫面、哪個按鈕會動了）`,
          };
        }
        return { pass: true, note: '這堂多出來的東西寫下來了' };
      },
    },
    {
      id: `${WEEK.toLowerCase()}_2`,
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
      id: `${WEEK.toLowerCase()}_3`,
      name: '關 3 兩人各自動手',
      short: '兩人',
      howTo: `專題日誌「## ${WEEK}」的「### ${H_NEXT}」兩人各一行（\`- \` 開頭、各 ≥${NEXT_LINE_MIN} 字），而且這一堂兩個人都要用自己的帳號 commit push`,
      test(ctx) {
        const authors = weekAuthorStats(ctx);
        emit(ctx, 'authors', authors.summary);

        const sec = loadSection(ctx, H_NEXT);
        if (sec.err) return { pass: false, note: sec.err };

        const problems = [];

        // 提示行已經在共用層濾掉了——`- 帳號：（換成你的話）` 原封不動就不算一行，
        // 兩人真的各寫一句才數得到兩行。
        const bullets = sec.lines
          .filter((l) => /^-\s/.test(l))
          .map((l) => l.replace(/^-\s+/, '').trim())
          .filter((l) => lengthCheck(l, NEXT_LINE_MIN) === null);
        if (bullets.length < NEXT_LINE_COUNT) {
          problems.push(
            `「${H_NEXT}」要有兩行「- 」開頭、各至少 ${NEXT_LINE_MIN} 個字（A 一句、B 一句，下一堂看得出有沒有做）`
          );
        }

        if (authors.size < AUTHOR_MIN) {
          problems.push(
            `這一堂只有 ${authors.size} 個人 commit：另一個人要用自己的帳號 commit push，一個人代打燈不會亮`
          );
        }

        if (problems.length > 0) return { pass: false, note: problems.join('；') };
        return { pass: true, note: `下一堂兩人各一句，這一堂有 ${authors.summary} 個人 commit` };
      },
    },
  ],
};
