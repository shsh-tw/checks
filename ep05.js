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
// 規則：一行去頭尾空白，**再去掉行首前綴**之後，同時「以（開頭且以）結尾」**且**長度 < 60 才算提示行。
//
// 前綴這一步是 v2 補的洞：starter 有兩種提示語不是「整行都在括號裡」——
//   `**先不做**：（列 2 到 3 個這學期不碰的東西。）`
//   `- coolsea：（下週看得出有沒有做的一件事）`   ← seed_proj.sh 會把 A（帳號） 換成真帳號
// 舊規則判它們「不是提示行」，於是學生一個字沒動也算填了，關 2、關 4 白亮。
// 去前綴＝去掉行首空白／清單符號／粗體標記，以及「標籤：」（含 `A（帳號）：` 這種括號在標籤裡的）。
// 長度上限 40 → 60：「我們要幫誰」那句提示語本身就 42 字，40 會漏掉它。
// 上限存在的理由不變（v3 那條「不要把學生用括號寫的正常內容吃掉」），只是門檻放寬。
const PLACEHOLDER_MAX_CHARS = 60;

// 去掉行首前綴，只為了判「這行是不是提示語」；真的算內容時整行原樣留著。
function stripHintPrefix(text) {
  let s = String(text == null ? '' : text);
  s = s.replace(/^[\s\-*＊+•]+/, '');          // 空白與清單符號（半形 - * +、全形＊、•）
  s = s.replace(/^\*\*([^*]*)\*\*\s*/, '$1');  // **粗體標籤**
  s = s.replace(/^.*[：:]\s*(?=（)/, '');       // 「標籤：」——貪婪吃到最後一個後面就接（的冒號
  return s.trim();
}

function isPlaceholderLine(raw) {
  const t = stripHintPrefix(String(raw == null ? '' : raw).trim());
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
// v2（學生冷讀 P0-A）：這份清單是這一關的**主力**，字數門檻退成 2 字。
// 原因是教材自己拿「我媽」（2 字）、「社團學弟」、「值日生」當正確示範，8 字門檻會把示範答案退掉，
// 而退件訊息又叫學生寫那三個例子——自相矛盾。真正要擋的是「全校同學」這種指不到人的答案。
// 注意：清單是子字串比對，加詞前先確認不會誤傷「社團學弟」「值日生」「吉他社學弟阿凱」。
const VAGUE_WORDS = [
  // 只擋「加上修飾也還是一群人」的純泛稱。刻意不放『同學』『學生』『社員』——
  // 那些加了修飾就是具體的人（「三班同學小美」「隔壁班的轉學生阿哲」），子字串比對會誤傷。
  '大家', '所有人', '全世界', '每個人', '人們', '使用者們', '同學們', '學生們',
  '全校', '全班', '社會大眾', '任何人', '高三的同學', '高三同學',
];
const WHO_EXAMPLES = '寫一個叫得出來的人（例：我媽、吉他社學弟阿凱、三班值日生）';

const WHO_MIN = 2;
const PROBLEM_MIN = 15;
const WORTH_MIN = 15;
const MIN_FEATURE_MIN = 15;
const NOT_DOING_MARK = '先不做';
const NOT_DOING_MIN = 6;
const AI_MIN = 60;
const AI_QUESTION_MIN = 3;
const AI_ANSWER_MIN = 8;
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

// 「我們的回答：」這種標籤不算答案本身（只吃冒號前 6 字以內的短標籤，免得把真的內容切掉）。
function stripAnswerLabel(text) {
  return String(text == null ? '' : text)
    .replace(/^[-*＊+•\s]+/, '')
    .replace(/^.{0,6}[：:]\s*/, '')
    .trim();
}

// 把「AI 挑了什麼漏洞」那一段拆成一題一題（學生冷讀 P0-B）。
// 只數問號的話，三個問題各回一句「有。」也會亮燈——那不是「被 AI 挑過」，是把問號貼上來而已。
// 拆法：含問號的行＝問句行（一行有幾個問號就算幾個問號，總數仍拿去比 ≥3）；
// 它的回答＝該行最後一個問號之後的殘字，加上後面到下一個問句行為止的所有行。
// 整段寫成一大段散文（問句與回答混在同一行）也數得到——那時「回答」就是最後一個問號之後那一段。
function collectQa(bodyLines) {
  const items = [];
  let cur = null;
  for (const line of contentLines(bodyLines)) {
    const marks = (line.match(/[？?]/g) || []).length;
    if (marks > 0) {
      const lastIdx = Math.max(line.lastIndexOf('？'), line.lastIndexOf('?'));
      cur = { marks, parts: [] };
      const tail = line.slice(lastIdx + 1).trim();
      if (tail.length > 0) cur.parts.push(tail);
      items.push(cur);
    } else if (cur) {
      cur.parts.push(line);
    }
    // 第一個問句出現之前的文字不屬於任何一題的回答
  }
  return items.map((it) => ({
    marks: it.marks,
    // 只在第一段去標籤：後面接續的行照原樣算，免得每行都被切一次
    answer: (it.parts.length === 0 ? '' : stripAnswerLabel(it.parts[0]) + it.parts.slice(1).join('')).replace(/\s+/g, ''),
  }));
}

// run.js 提供 ctx.emit(key, value)，寫進尾註 JSON 的 data（老師端儀表板用；不影響任何燈）。
function emit(ctx, key, value) {
  if (ctx && typeof ctx.emit === 'function') ctx.emit(key, String(value == null ? '' : value));
}

// 關 4 數「幾個人動過手」時要把老師排掉（P0-1）。
// seed_proj.sh 對**新** repo 已改成單一 root commit，但「repo 已存在、補缺的檔案」那條冪等路徑
// 仍會留下老師的 non-root commit；只要有一筆，學生一個人 push 就湊到兩個作者，
// 「一個人代打燈不會亮」就變成假的。所以判定這一層也要自己防。
// 換老師或多人共管時用環境變數 CHECKS_TEACHER_EMAILS 覆蓋（逗號分隔）。
const TEACHER_EMAILS = ['4925989+coolsea@users.noreply.github.com'];
function teacherEmailSet() {
  const raw = process.env.CHECKS_TEACHER_EMAILS;
  const list = raw ? String(raw).split(',') : TEACHER_EMAILS;
  return new Set(list.map((s) => String(s).trim().toLowerCase()).filter((s) => s.length > 0));
}

// 回 { size, summary }：size 是幾個人（燈 4 用），summary 是給老師看的 `2(3/1)`＝兩個人、
// 一個 3 筆一個 1 筆。老師掃儀表板就看得出「B 只補了一個句號」這種假分工，不加判定條件。
function nonRootAuthorStats(ctx) {
  const skip = teacherEmailSet();
  const nonRoot = ((ctx && ctx.commits) || []).filter((c) => !c.isRoot);
  const counts = new Map();
  for (const c of nonRoot) {
    const e = String(c.authorEmail || '').trim().toLowerCase();
    if (e.length === 0 || skip.has(e)) continue;
    counts.set(e, (counts.get(e) || 0) + 1);
  }
  const size = counts.size;
  const each = [...counts.values()].sort((a, b) => b - a);
  return { size, summary: size === 0 ? '0' : `${size}(${each.join('/')})` };
}

module.exports = {
  id: 'ep05',
  title: 'EP05 專題啟動',
  // 老師端儀表板的 data 欄位（規格第四節）：「要幫誰」掃一眼就知道誰還在寫「大家」，
  // 「作者」是關 4 真正的分母——老師不用點進 repo 就看得出那一組是不是一個人在代打。
  dataColumns: [
    { key: 'who', label: '要幫誰', width: 20 },
    { key: 'authors', label: '作者', width: 12 },   // 值長得像 2(3/1)，寬度要放得下
  ],
  // 這一週判的是 proj-<隊名> 兩人共用 repo 的 README.md。個人 repo（hw-<帳號>）有 notes.md，
  // 那裡不該出現 EP05 這張表——所以「有 README.md 且沒有 notes.md」才適用。
  appliesTo(ctx) {
    return ctx.exists('README.md') && !ctx.exists('notes.md');
  },
  checks: [
    {
      id: 'ep05_1',
      name: '關 1 我們要幫誰',
      short: '幫誰',
      howTo: 'README「## 我們要幫誰」寫一個叫得出來的人（例：我媽、吉他社學弟阿凱、三班值日生；不能寫「大家」「全校同學」這種泛稱），「## 解決什麼問題」寫他卡住的那個場景（≥15 字）',
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
        const vagueHit = VAGUE_WORDS.find((w) => whoText.includes(w));
        if (whoBad) {
          problems.push(`「我們要幫誰」還太短或太籠統：${WHO_EXAMPLES}`);
        } else if (vagueHit) {
          problems.push(`「我們要幫誰」不能是「${vagueHit}」這種泛稱：${WHO_EXAMPLES}`);
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
      howTo: 'README「## AI 挑了什麼漏洞、我們怎麼回答」把 AI 問的問題貼上來（≥3 個問號），每題下面寫你們自己的回答（每題 ≥8 字、整段 ≥60 字）',
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

        // 逐題檢查回答（P0-B）：問號數夠、總字數夠，但每題只寫「有。」不算回答過。
        const qa = collectQa(ai.bodyLines);
        const thin = qa.filter((it) => lengthCheck(it.answer, AI_ANSWER_MIN) !== null);
        if (thin.length > 0) {
          problems.push(
            `AI 的問題要一題一題回答，每個回答至少 ${AI_ANSWER_MIN} 個字（現在有 ${thin.length} 題只寫了幾個字）`
          );
        }

        if (problems.length > 0) return { pass: false, note: problems.join('；') };
        return { pass: true, note: 'AI 挑過漏洞了，而且你們自己一題一題回答了' };
      },
    },
    {
      id: 'ep05_4',
      name: '關 4 兩人各自動手',
      short: '兩人',
      howTo: 'README「## 下一步」兩人各一行（`- ` 開頭、各 ≥8 字），而且兩個人都要用自己的帳號 commit push',
      test(ctx) {
        const authors = nonRootAuthorStats(ctx);
        emit(ctx, 'authors', authors.summary);

        const doc = loadReadme(ctx);
        if (doc.err) return { pass: false, note: doc.err };

        const next = sectionOf(doc.lines, H_NEXT);
        if (!next) return { pass: false, note: missingNote(['下一步']) };

        const problems = [];

        // contentLines 已經把提示行濾掉了——`- coolsea：（下週看得出有沒有做的一件事）`
        // 原封不動就不算一行（v2 修的洞），兩人真的各寫一句才數得到兩行。
        // v3.1（2026-09-07，task-008 第二輪授權的單點修正，與專題週共用契約 v1.1 第二節同步）：
        // 字數要**先去掉行首的 `- ` 與 `帳號：` 標籤**再算。不去掉的話，學生把提示語刪掉、
        // 只留 `- coolsea：` 一個字都不寫，也有 11 個字，這一關會白亮。
        const bullets = contentLines(next.bodyLines)
          .filter((l) => /^-\s/.test(l))
          .map((l) => l.replace(/^-\s+/, '').replace(/^[A-Za-z0-9-]+[：:]\s*/, '').trim())
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
        return { pass: true, note: `下一步兩人各一句，repo 裡有 ${authors.summary} 個人的 commit` };
      },
    },
  ],
};
