'use strict';

// EP05 專題啟動 的關卡判定。
// 規則正本：週次/EP05_專題啟動/闖關/checks_spec_ep05.md 第二節（與本檔衝突時以規格為準）。
// 判定對象是 proj-<隊名> repo 根目錄的 README.md（專題週兩人共用一個 repo，不是個人 repo 的 notes.md）。
// 本模組自帶 markdown 解析小工具（不依賴 run.js 的內部函式，ctx 契約只用 readFile／commits／emit）。

// ---------- markdown 小工具（與 ep03.js／ep04.js 同一套語意） ----------

function headingLevel(line) {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}

// 找出第一個符合 matchFn 的標題行，回傳它到下一個「同級或更高級」標題之間的內容（body）。
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

// 提示行（本模組自帶判定，規格第二節）：
// EP03／EP04 認的是「含『換成你的』字樣」，那套在這裡不適用——EP05 的 starter 提示語是整行括號包起來的。
// 規則：一行去頭尾空白後，同時「以（開頭且以）結尾」**且**長度 < 40 才算提示行。
// 長度上限是 v3 那條「不要把學生用括號寫的正常內容吃掉」的延續：真的寫了東西的人不會剛好整行括號又這麼短。
const PLACEHOLDER_MAX_CHARS = 40;
function isPlaceholderLine(raw) {
  const t = String(raw == null ? '' : raw).trim();
  if (t.length === 0) return false;
  if (!t.startsWith('（') || !t.endsWith('）')) return false;
  return Array.from(t).length < PLACEHOLDER_MAX_CHARS;
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

// 編碼閘（沿用 EP03 v3）：Big5／ANSI 存檔被當 UTF-8 讀會出現 U+FFFD，
// 這種 README 在 GitHub 上是亂碼，且中文標題錨點全失效會誤判成「已填」。一律 ❌。
const BAD_ENC_NOTE = '存成了 Big5／ANSI，GitHub 上看到的是亂碼：用 VS Code 打開它 → 右下角點編碼 → Save with Encoding → UTF-8 → 重新 commit push';
function badEncoding(text) {
  return typeof text === 'string' && text.includes('�');
}

// 亂打過濾（沿用 v3 7.1）：「啊啊啊啊啊啊啊啊啊啊」湊得到 10 個字，但那不是答案。
// 兩關：① 連續重複的同一字元壓成 1 個之後再算長度 ② 去重後不同字元數要 ≥ min(5, 門檻)。
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
  if (distinctCount(collapsed) < Math.min(5, min)) return 'gibberish';
  return null;
}

// ---------- 段落錨點 ----------

const H_WHO = '## 我們要幫誰';
const H_PROBLEM = '## 解決什麼問題';
const H_WORTH = '## 為什麼值得做';
const H_MIN = '## 第一版最小能做什麼';
const H_AI = '## AI 挑了什麼漏洞、我們怎麼回答';
const H_NEXT = '## 下一步';

// AGENTS.md 擋得住 AI 代寫程式，擋不住代寫企劃書：學生可能把 AI 生的整份企劃貼進 README，
// 把五個 `## ` 標題蓋掉。不加偵測器（D-018 禁止再堆防作弊機制），靠結構自然擋——
// 標題不見時四關本來就找不到段落，這句話負責把「為什麼找不到」講給學生聽。
const HEADING_NOTE = 'README 的五個標題不要改名或刪掉；AI 給的企劃書不要整份貼上來';

// 缺標題的 note 統一長這樣（四關共用）。run.js 把機器可讀的 notes 截到 60 字，
// 所以前綴要短，HEADING_NOTE 那句才不會被切掉。
function missingNote(names) {
  return `缺${names.map((n) => `『${n}』`).join('')}段：${HEADING_NOTE}`;
}

// 空泛詞黑名單（規格第二節）：出現在「我們要幫誰」段即 ❌。
const VAGUE_WORDS = ['大家', '所有人', '全世界', '每個人', '人們', '使用者們', '同學們', '全校', '社會大眾', '任何人'];

const WHO_MIN = 8;
const PROBLEM_MIN = 15;
const WORTH_MIN = 15;
const MIN_FEATURE_MIN = 15;
const NOT_DOING_MARK = '先不做';
const NOT_DOING_MIN = 6;
const AI_MIN = 60;
const AI_QUESTION_MIN = 3;
const NEXT_LINE_MIN = 8;
const NEXT_LINE_COUNT = 2;
const AUTHOR_MIN = 2;

// ---------- 共用讀檔 ----------

function loadReadme(ctx) {
  const text = ctx.readFile('README.md');
  if (text === null) {
    return { err: '找不到 README.md（這週要 clone 的是 proj-隊名 repo，不是 hw-你的帳號）' };
  }
  if (badEncoding(text)) {
    return { err: 'README.md ' + BAD_ENC_NOTE };
  }
  return { lines: text.split('\n') };
}

function sectionOf(lines, heading) {
  return findSection(lines, (l) => l.trim().startsWith(heading));
}

// run.js 提供 ctx.emit(key, value)，寫進尾註 JSON 的 data（老師端儀表板用；不影響任何燈）。
function emit(ctx, key, value) {
  if (ctx && typeof ctx.emit === 'function') ctx.emit(key, String(value == null ? '' : value));
}

function nonRootAuthors(ctx) {
  const nonRoot = ((ctx && ctx.commits) || []).filter((c) => !c.isRoot);
  return new Set(
    nonRoot.map((c) => String(c.authorEmail || '').trim().toLowerCase()).filter((e) => e.length > 0)
  );
}

module.exports = {
  id: 'ep05',
  title: 'EP05 專題啟動',
  // 老師端儀表板的 data 欄位（規格第四節）：巡班時掃這一欄就知道誰還在寫「大家」。
  dataColumns: [{ key: 'who', label: '要幫誰', width: 20 }],
  checks: [
    {
      id: 'ep05_1',
      name: '關 1 我們要幫誰',
      short: '幫誰',
      howTo: 'README「## 我們要幫誰」寫一個你叫得出來的人（≥8 字，不能寫「大家」），「## 解決什麼問題」寫他卡住的那個場景（≥15 字）',
      test(ctx) {
        const doc = loadReadme(ctx);
        if (doc.err) return { pass: false, note: doc.err };

        const who = sectionOf(doc.lines, H_WHO);
        const problem = sectionOf(doc.lines, H_PROBLEM);
        const missing = [];
        if (!who) missing.push('我們要幫誰');
        if (!problem) missing.push('解決什麼問題');
        if (missing.length > 0) return { pass: false, note: missingNote(missing) };

        const whoText = mergeContent(who.bodyLines);
        // 儀表板的「要幫誰」欄：段首 20 字。不管過不過都送，老師才掃得到還在寫「大家」的組。
        emit(ctx, 'who', Array.from(whoText).slice(0, 20).join(''));

        const problems = [];
        const whoBad = lengthCheck(whoText, WHO_MIN);
        if (whoBad === 'gibberish') {
          problems.push(`「我們要幫誰」${GIBBERISH_NOTE}`);
        } else if (whoBad) {
          problems.push(`「我們要幫誰」還沒寫到 ${WHO_MIN} 個字：寫一個你叫得出來的人（社團學弟、我媽、值日生）`);
        } else {
          const hit = VAGUE_WORDS.find((w) => whoText.includes(w));
          if (hit) {
            problems.push(`「我們要幫誰」要寫一個你叫得出來的人，不能是「${hit}」這種：改成一個叫得出名字的人再 push`);
          }
        }

        const problemText = mergeContent(problem.bodyLines);
        const pBad = lengthCheck(problemText, PROBLEM_MIN);
        if (pBad === 'gibberish') {
          problems.push(`「解決什麼問題」${GIBBERISH_NOTE}`);
        } else if (pBad) {
          problems.push(`「解決什麼問題」還沒寫到 ${PROBLEM_MIN} 個字：寫他上週因為這件事卡住的那個場景`);
        }

        if (problems.length > 0) return { pass: false, note: problems.join('；') };
        return { pass: true, note: '幫的是一個叫得出來的人，問題也寫清楚了' };
      },
    },
    {
      id: 'ep05_2',
      name: '關 2 值得做＋最小可行',
      short: '最小',
      howTo: 'README「## 為什麼值得做」≥15 字；「## 第一版最小能做什麼」≥15 字，而且要寫「先不做」＋列 2 到 3 個這學期不碰的東西',
      test(ctx) {
        const doc = loadReadme(ctx);
        if (doc.err) return { pass: false, note: doc.err };

        const worth = sectionOf(doc.lines, H_WORTH);
        const min = sectionOf(doc.lines, H_MIN);
        const missing = [];
        if (!worth) missing.push('為什麼值得做');
        if (!min) missing.push('第一版最小能做什麼');
        if (missing.length > 0) return { pass: false, note: missingNote(missing) };

        const problems = [];

        const worthText = mergeContent(worth.bodyLines);
        const wBad = lengthCheck(worthText, WORTH_MIN);
        if (wBad === 'gibberish') {
          problems.push(`「為什麼值得做」${GIBBERISH_NOTE}`);
        } else if (wBad) {
          problems.push(`「為什麼值得做」還沒寫到 ${WORTH_MIN} 個字：為什麼是這件事，不是別的`);
        }

        const minText = mergeContent(min.bodyLines);
        const mBad = lengthCheck(minText, MIN_FEATURE_MIN);
        if (mBad === 'gibberish') {
          problems.push(`「第一版最小能做什麼」${GIBBERISH_NOTE}`);
        } else if (mBad) {
          problems.push(`「第一版最小能做什麼」還沒寫到 ${MIN_FEATURE_MIN} 個字：一個畫面講得完的功能`);
        }

        const at = minText.indexOf(NOT_DOING_MARK);
        if (at === -1) {
          problems.push('「第一版最小能做什麼」少了「先不做」：這堂課最重要的一句，列 2 到 3 個這學期不碰的東西');
        } else {
          const after = minText.slice(at + NOT_DOING_MARK.length);
          const aBad = lengthCheck(after, NOT_DOING_MIN);
          if (aBad === 'gibberish') {
            problems.push(`「先不做」後面${GIBBERISH_NOTE}`);
          } else if (aBad) {
            problems.push(`「先不做」後面還沒寫到 ${NOT_DOING_MIN} 個字：列 2 到 3 個這學期不碰的東西`);
          }
        }

        if (problems.length > 0) return { pass: false, note: problems.join('；') };
        return { pass: true, note: '值得做的理由有了，第一版砍到一個畫面講得完，也寫了先不做' };
      },
    },
    {
      id: 'ep05_3',
      name: '關 3 被 AI 挑過',
      short: '刁難',
      howTo: 'README「## AI 挑了什麼漏洞、我們怎麼回答」把 AI 問的問題貼上來（≥3 個問號），每題下面寫你們的回答（整段 ≥60 字）',
      test(ctx) {
        const doc = loadReadme(ctx);
        if (doc.err) return { pass: false, note: doc.err };

        const ai = sectionOf(doc.lines, H_AI);
        if (!ai) return { pass: false, note: missingNote(['AI 挑了什麼漏洞、我們怎麼回答']) };

        const text = mergeContent(ai.bodyLines);
        const problems = [];

        const marks = (text.match(/[？?]/g) || []).length;
        if (marks < AI_QUESTION_MIN) {
          problems.push(`只看到 ${marks} 個問號：要它挑五個漏洞，把它問的問題原樣貼進來（至少 ${AI_QUESTION_MIN} 個）`);
        }

        const bad = lengthCheck(text, AI_MIN);
        if (bad === 'gibberish') {
          problems.push(`這一段${GIBBERISH_NOTE}`);
        } else if (bad) {
          problems.push(`這一段還沒寫到 ${AI_MIN} 個字：每個問題下面要有你們自己的回答`);
        }

        if (problems.length > 0) return { pass: false, note: problems.join('；') };
        return { pass: true, note: 'AI 挑過漏洞了，而且你們自己回答了' };
      },
    },
    {
      id: 'ep05_4',
      name: '關 4 兩人各自動手',
      short: '兩人',
      howTo: 'README「## 下一步」兩人各一行（`- ` 開頭、各 ≥8 字），而且兩個人都要用自己的帳號 commit push',
      test(ctx) {
        const authors = nonRootAuthors(ctx);
        emit(ctx, 'authors', authors.size);

        const doc = loadReadme(ctx);
        if (doc.err) return { pass: false, note: doc.err };

        const next = sectionOf(doc.lines, H_NEXT);
        if (!next) return { pass: false, note: missingNote(['下一步']) };

        const problems = [];

        const bullets = next.bodyLines
          .map((l) => l.trim())
          .filter((l) => /^-\s/.test(l))
          .map((l) => l.replace(/^-\s+/, '').trim())
          .filter((l) => lengthCheck(l, NEXT_LINE_MIN) === null);
        if (bullets.length < NEXT_LINE_COUNT) {
          problems.push(`「下一步」要有兩行「- 」開頭、各至少 ${NEXT_LINE_MIN} 個字（A 一句、B 一句，下週看得出有沒有做）`);
        }

        if (authors.size < AUTHOR_MIN) {
          problems.push(
            `repo 只有 ${authors.size} 個人的 commit：另一個人要用自己的帳號 commit push，一個人代打燈不會亮`
          );
        }

        if (problems.length > 0) return { pass: false, note: problems.join('；') };
        return { pass: true, note: `下一步兩人各一句，repo 裡有 ${authors.size} 個人的 commit` };
      },
    },
  ],
};
