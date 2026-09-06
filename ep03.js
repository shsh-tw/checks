'use strict';

// EP03 git 迴圈＋AI 助教 的關卡判定。規則見 週次/EP03_git迴圈與AI助教/闖關/checks_spec.md 第四節。
// 本模組自帶 markdown 解析小工具（不依賴 run.js 的內部函式，ctx 契約只提供 readFile/exists/commits）。

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

// placeholder 判定（v3／第九節 9.1 改嚴）：去頭尾空白後，只有含「換成你的」或含「把這一行換成」才算提示行。
// 取消 v1 的「全形括號包頭尾即為提示」規則——學生把答案寫在括號裡是合法內容。
function isPlaceholderLine(raw) {
  const t = raw.trim();
  if (t.includes('換成你的')) return true;
  if (t.includes('把這一行換成')) return true;
  return false;
}

// 段落內容：去掉空白行與提示行（分開兩步，語意對齊規格第四節「去掉提示行與空白行後合併」）後合併的文字。
function mergeContent(bodyLines) {
  return bodyLines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !isPlaceholderLine(l))
    .join('');
}


// 編碼閘（Windows 審查 P0-1）：Big5／ANSI 存檔被當 UTF-8 讀會出現 U+FFFD；
// 這種檔在 GitHub 上是亂碼，且中文錨點（### 自我介紹、換成你的）全失效會誤判成「已填」。一律 ❌。
const BAD_ENC_NOTE = '存成了 Big5／ANSI，GitHub 上看到的是亂碼：用 VS Code 打開它 → 右下角點編碼 → Save with Encoding → UTF-8 → 重新 commit push';
function badEncoding(text) {
  return typeof text === 'string' && text.includes('\uFFFD');
}

function findEp03Section(notesText) {
  const lines = notesText.split('\n');
  return findSection(lines, (l) => /^##\s+EP03/.test(l.trim()));
}

// 9.1 救援：「### 自我介紹」標題被刪 → 改取「## EP03 之後、第一個 ### 1. 之前」的內容當自我介紹。
function extractSelfIntro(section) {
  const sub = findSection(section.bodyLines, (l) => l.trim().startsWith('### 自我介紹'));
  if (sub) {
    return mergeContent(sub.bodyLines);
  }
  let endIdx = section.bodyLines.length;
  for (let i = 0; i < section.bodyLines.length; i++) {
    if (section.bodyLines[i].trim().startsWith('### 1.')) {
      endIdx = i;
      break;
    }
  }
  return mergeContent(section.bodyLines.slice(0, endIdx));
}

module.exports = {
  id: 'ep03',
  title: 'EP03 git 迴圈＋AI 助教',
  checks: [
    {
      id: 'ep03_1',
      name: '關 1 第一個腳印',
      short: '腳印',
      howTo: 'notes.md 的「自我介紹」換成自己的話',
      test(ctx) {
        const notes = ctx.readFile('notes.md');
        if (notes === null) {
          return { pass: false, note: '找不到 notes.md' };
        }
        if (badEncoding(notes)) {
          return { pass: false, note: 'notes.md ' + BAD_ENC_NOTE };
        }
        const section = findEp03Section(notes);
        if (!section) {
          return { pass: false, note: '找不到 notes.md 裡的「## EP03」段落' };
        }
        const content = extractSelfIntro(section);
        const hasNonRootCommit = (ctx.commits || []).some((c) => !c.isRoot);

        if (content.length < 4) {
          return {
            pass: false,
            note: content.length === 0 ? '自我介紹還沒寫' : '自我介紹還沒換成自己的話（少於 4 字）',
          };
        }
        if (!hasNonRootCommit) {
          return { pass: false, note: '還沒有自己的 commit' };
        }
        return { pass: true, note: '自我介紹已換成自己的話' };
      },
    },
    {
      id: 'ep03_2',
      name: '關 2 第一個網頁',
      short: '網頁',
      howTo: '根目錄要有 index.html，而且 <title> 裡有字',
      test(ctx) {
        if (!ctx.exists('index.html')) {
          return { pass: false, note: '根目錄沒有 index.html' };
        }
        const html = ctx.readFile('index.html') || '';
        if (badEncoding(html)) {
          return { pass: false, note: 'index.html ' + BAD_ENC_NOTE };
        }
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const titleText = titleMatch ? titleMatch[1].replace(/\s+/g, '') : '';
        if (!titleMatch || titleText.length < 1) {
          return { pass: false, note: '<title> 裡沒有字' };
        }
        if (titleText === '我的第一個網頁') {
          return { pass: false, note: '把「我的第一個網頁」換成你的主題（兩處）' };
        }
        const hasBody = /<body/i.test(html);
        const lineCount = html.split('\n').length;
        if (!hasBody && lineCount < 5) {
          return { pass: false, note: '缺少 <body 或內容太少（少於 5 行）' };
        }
        return { pass: true, note: 'index.html 已完成' };
      },
    },
    {
      id: 'ep03_3',
      name: '關 3 解釋權',
      short: '解釋',
      howTo: 'notes.md 三個問題都用自己的話寫（每題至少 10 個字，第 3 題要貼出那一行）',
      test(ctx) {
        const notes = ctx.readFile('notes.md');
        if (notes === null) {
          return { pass: false, note: '找不到 notes.md' };
        }
        if (badEncoding(notes)) {
          return { pass: false, note: 'notes.md ' + BAD_ENC_NOTE };
        }
        const section = findEp03Section(notes);
        if (!section) {
          return { pass: false, note: '找不到 notes.md 裡的「## EP03」段落' };
        }
        const q1 = findSection(section.bodyLines, (l) => l.trim().startsWith('### 1.'));
        const q2 = findSection(section.bodyLines, (l) => l.trim().startsWith('### 2.'));
        const q3 = findSection(section.bodyLines, (l) => l.trim().startsWith('### 3.'));

        // 9.1 救援：### 1./2./3. 任一標題被刪 → 該關 ❌，明寫少了哪一行標題。
        const missingTitles = [];
        if (!q1) missingTitles.push('### 1.');
        if (!q2) missingTitles.push('### 2.');
        if (!q3) missingTitles.push('### 3.');
        if (missingTitles.length > 0) {
          return {
            pass: false,
            note: `notes.md 少了『${missingTitles.join('、')}』那一行標題（標題不要刪，只換下面那行）`,
          };
        }

        const c1 = mergeContent(q1.bodyLines);
        const c2 = mergeContent(q2.bodyLines);
        const c3 = mergeContent(q3.bodyLines);

        const problems = [];
        if (c1.length < 10) problems.push('第 1 題還沒寫到 10 個字');
        if (c2.length < 10) problems.push('第 2 題還沒寫到 10 個字');
        if (c3.length < 10) {
          problems.push('第 3 題還沒寫到 10 個字');
        } else if (!/index\.html|<|html/i.test(c3)) {
          problems.push('第 3 題沒貼出那一行程式碼');
        }

        if (problems.length > 0) {
          return { pass: false, note: `還沒寫完：${problems.join('、')}` };
        }

        // 9.1 追加：三題內容去空白後任兩題相同 → ❌。
        if (c1 === c2 || c1 === c3 || c2 === c3) {
          return { pass: false, note: '三題不能寫一樣的' };
        }

        return { pass: true, note: '三個問題都寫完了' };
      },
    },
    {
      id: 'ep03_4',
      name: '關 4 登出儀式',
      short: '登出',
      howTo: '隔壁互查，這裡不判',
      // 沒有 test：永遠 👀，run.js 看到沒有 test function 就不判、也不計入機器可讀 results。
    },
  ],
};
