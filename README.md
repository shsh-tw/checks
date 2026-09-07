# 闖關檢查器

規格正本：`週次/EP03_git迴圈與AI助教/闖關/checks_spec.md`（EP03 判定、第八／九節為準）＋`週次/EP04_Vibe coding部署/闖關/checks_spec_ep04.md`（架構升級與 EP04）。本 README 只是操作指引，判定規則以規格為準。

> 這份 README 同時是公開 repo `shsh-tw/checks` 的 README（`scripts/seed_checks.sh` 會把它一起推上去）。裡面沒有任何 secret——判定規則本來就在學生看得到的地方。

## 架構（v3，2026-09-07）

檢查器程式**集中在公開 repo `shsh-tw/checks`**，學生 repo 只留一個薄 workflow：

```
學生 repo
├─ .github/workflows/checks.yml   ← 本資料夾的 checks.yml（薄版）
├─ .github/copilot-instructions.md
├─ notes.md
└─ index.html

shsh-tw/checks（公開）
├─ run.js      ← 本資料夾的 run.js
├─ ep03.js     ← 本資料夾的 ep03.js
├─ ep04.js     ← 本資料夾的 ep04.js
└─ README.md   ← 這一份
```

workflow 做兩次 checkout：學生 repo 到工作目錄、`shsh-tw/checks` 到 `.checks/`，然後跑 `node .checks/run.js`。

**為什麼要這樣**：template 改了不會回頭更新已經建好的學生 repo。之後每週加一個 `epNN.js`，只要更新 `shsh-tw/checks`，全班既有 repo 下一次 push 就吃到新關卡，不用碰任何學生 repo。

- `run.js` 的 `ROOT` 是 `process.cwd()`（學生 repo 根），模組從 `__dirname` 載（也就是 `.checks/`）。
- 掃描 repo 檔案時一律排除 `.checks/`、`checks/`、`.git/`、`.github/`。
- 舊 repo 裡殘留的 `checks/` 不影響判定；`scripts/seed_repo.sh` 會順手清掉。

## 兩支種檔腳本

```bash
scripts/seed_checks.sh                      # 檢查器正本 → shsh-tw/checks（無差異不 commit）
scripts/seed_repo.sh shsh-tw/hw-template    # 薄 workflow＋copilot 指針＋notes.md → 學生 repo／template
```

`seed_repo.sh` 對 `notes.md` 是**追加制**：沒有檔案就放完整 starter（EP03 段＋EP04 段），已經有就只補缺的週次段落，絕不覆蓋學生寫過的東西。

## 每次 push 會發生什麼

- 讀 git log 與 repo 裡的檔案判定關卡。
- 把結果組成 Markdown，寫進（或建立）標題為 `🏁 闖關進度` 的 Issue，同時寫 Job Summary 並印到 stdout。
- Issue 更新失敗（例如 org 預設 workflow 權限被鎖成唯讀）不會讓 job 失敗：印一行 `⚠ 無法更新 Issue：…` 後照常 exit 0。這是老師儀表板判斷「無 Issue」的依據。
- 全綠時尾行印「🎉 這週的燈都亮了……」；有任一 ❌ 才印「❌ 怎麼辦：……」。

## 通過後保留（sticky）

`ep04_1`、`ep04_3` 這種「去抓網址」的關，預覽網址會過期——過期不該把已經拿到的燈弄熄。

- Actions 模式：`run.js` 開跑前先讀既有 Issue 的尾註 JSON，取出 `ever`（`{check id: ISO 時間}`）。
- check 宣告 `sticky: true` 後：本次 ❌ 但 `ever[id]` 有紀錄 → 狀態改 ✅、說明改「曾於 MM-DD HH:mm 通過（現在抓不到／預覽已過期）」；本次 ✅ → 更新 `ever[id]` 為現在。
- 尾註 JSON 因此多了 `ever` 欄。
- 本機模式沒有 Issue 可讀，預設是純當下；測試時用環境變數注入：
  ```bash
  CHECKS_EVER_JSON='{"ep04_1":"2026-09-07T01:23:00.000Z"}' node .checks/run.js
  ```

## 「每週都看」五燈

| id | 名稱 | 判定 |
|---|---|---|
| `std_email` | 🪪 專用信箱 | 最新一則 commit 的 authorEmail 是 `數字+帳號@users.noreply.github.com` |
| `std_msg` | ✍️ commit 訊息 | 最近 5 則非 root commit 的訊息 ≥4 字且不在黑名單 |
| `std_local` | 💻 本機 commit | 至少一則非 root commit 的 committerEmail 不是 `noreply@github.com`（走網頁備援的人 ❌ 是正常的） |
| `std_zh` | 🇹🇼 正體中文 | `notes.md`／`index.html` 沒有簡體字（清單見 EP03 規格 9.1），也不是 Big5／ANSI 亂碼 |
| `std_secret` | 🔒 沒有 secret | 追蹤中的文字檔沒有像 key 的東西，也沒有 `.env`（EP04 起常駐） |

`std_secret` 掃 `git ls-files`，排除 `.checks/`、`checks/`、`.github/`、`AGENTS.md`、`CLAUDE.md`、`README.md`，以及 >200KB 或二進位檔。抓 OpenAI 型 `sk-`、Google `AIza`、GitHub `ghp_` 等、Slack `xox`、私鑰標頭，以及 `api_key/secret/token/password = "…"` 這種指派。
**❌ 的說明只印前 4 碼**（`sk-d`…），絕不印完整值——說明會出現在 Issue 與儀表板上，印全值等於再洩一次。

## 本週關卡

- `ep03.js`：關 1 第一個腳印／關 2 第一個網頁／關 3 解釋權／關 4 登出儀式（永遠 👀，互查）。
- `ep04.js`：關 1 先上線再說 🌐（sticky）／關 2 做一個想要的東西／關 3 上線給別人看 🌐（sticky，比對上線那頁的 `<title>` 與 repo 的 `index.html` 一致）／關 4 秘密藏不住（第 3 題要含通關密語，用 SHA-256 比對，密語本身不寫進程式）。
- 抓網址：只收 `https://`，拒絕 `localhost`／`127.`／`file:`；10 秒逾時、UA `shsh-checks`；失敗種類（非 https／逾時／4xx／5xx／title 不符）都寫進說明。

### 🌐 判定是三段的（v1.1，2026-09-07 實證）

GitHub runner 的 IP 抓 Drop 的 `*.workers.dev` 會被 Cloudflare 擋成 **HTTP 403 + `cf-mitigated: challenge`**，同一個網址老師的 Mac 抓是 200。所以不能把 403 一律當「沒上線」：

| 抓到 | 關 1 | 關 3 |
|---|---|---|
| 2xx | ✅ | 比對 title：相符 ✅／不符 ❌ |
| 403 且 `cf-mitigated` 含 `challenge`（或 body 有 `Just a moment`） | ✅「網址活著（Cloudflare 擋機器人…）」 | ✅「網址活著（…標題沒比對…）」 |
| 其他 4xx／5xx／逾時／DNS 失敗 | ❌ | ❌ |

403 這一格的內容驗證改由老師端儀表板的「真抓」欄（老師的 Mac 直接抓）＋隔壁同學的手機負責。

網址還要符合白名單樣式（Drop、作品牆、`shsh-tw.github.io/hw-*`、任何 `*.pages.dev/`），否則 ❌「這不像 Drop 或作品牆的網址」——擋掉隨便貼一個網址想過關。

check 回傳可以帶 `showNote: true`，讓 ✅ 那一格改印 note 而不是 `howTo`（上面那兩句但書就是靠它顯示的）。

## 之後每週怎麼加關卡

新增 `epNN.js`，格式：

```js
module.exports = {
  id: 'epNN',
  title: 'EPNN ……',
  checks: [
    { id: 'epNN_1', name: '關 1 ……', howTo: '……', test(ctx) { return { pass, note }; } },
    { id: 'epNN_2', name: '關 2 ……', howTo: '……', sticky: true, async test(ctx) { … } },
    // 永遠 👀 的關（例如互查）：不要給 test，run.js 看到沒有 test 就畫 👀、不計入 results。
  ],
};
```

`run.js` 依檔名排序自動載入所有 `ep*.js`，不用改 `run.js`。寫完跑 `scripts/seed_checks.sh` 推上去就生效。

`ctx` 提供四個東西：
- `ctx.readFile(path)`：相對 repo 根目錄讀檔，不存在回 `null`。
- `ctx.exists(path)`：相對 repo 根目錄判斷檔案是否存在。
- `ctx.commits`：陣列，最新在前，每筆 `{ sha, authorEmail, committerEmail, subject, isRoot }`。
- `ctx.trackedFiles`：`git ls-files` 的結果，已排除 `.checks/`、`checks/`、`.git/`、`.github/`。
- `ctx.emit(key, value)`：把旁路資料寫進尾註 JSON 的 `data`（不影響任何燈）。EP04 用它送出 `ep04_1_url`／`ep04_3_url`／`index_title`，老師端儀表板才能自己再抓一次網址驗內容。值會轉字串並截 300 字。

`test(ctx)` 可以是 async（要 `fetch` 的關卡就用），要回 `{ pass: boolean, note?: string }`；丟例外會被 `run.js` 接住變成 `{ pass:false, note:'檢查器錯誤：…' }`，不會讓整支 workflow 掛掉。

## 本機除錯

在**學生 repo 根目錄**（不是這個資料夾）：

```bash
node /路徑/共用元件/檢查器/run.js            # 印完整 Markdown（本機模式，不會動 Issue）
node /路徑/共用元件/檢查器/run.js --json     # 只印一行 JSON（尾註那段），給老師儀表板 --local 用
```

離線回歸測試（不碰網路以外的任何東西，跑完自動清暫存夾）：

```bash
scripts/test_checker.sh              # EP03 17 case ＋ EP04 13 case
scripts/test_checker.sh --week ep03  # 只跑 EP03（純離線）
```

## 設計上刻意不做的事

- 不用任何第三方 action（除 `actions/checkout@v4`），不裝任何 npm 套件，不用任何 secret。
- 不寫回 repo（不 commit、不 push），只更新 Issue 內文與 Job Summary。
- 不留言、只改 Issue 內文，避免每次 push 都通知轟炸。
- 不印完整的 key、不印學生姓名。
