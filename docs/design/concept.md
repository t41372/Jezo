# Jezo 概念

Why am I building this?
- I fucking hate giving all my information, calendar, gmails, and other info away, when OpenAI, Anthropic, and other companies clearly reads/analyze you stuff. These things are mine, not theirs.
- 為有 ADHD 的人而做：想法巨多，但非常 disorganize。todo list 應用用了很多，最後都沒辦法長期用下去，因為
    - todo 建立起來很耗時間，要從各種地方 pull context (context gathering, updates)，
        - 比如學校 canvas，各種其他來源
    - 還有 calendar events，大任務要弄成小任務，遇到變化得調整... 建立 todo，建立待辦事項本身就很耗費盡力。而且耍廢或是一段時間不用，回來之後 todo 裡就整個髒掉了。
- 為什麼要允許用戶嘗試不同的方法論:
    - 有很多關於管理自己生活和任務的方法論和哲學，比如安排任務的哲學: "大任務佈置下來，不要等，有空就立刻做"，"避免 context switching"，比如組織任務和展示的方式 "艾森豪矩陣"，"Timeboxing"，kanban，各種東西。有 ADHD 的可能也有一些自己的方法論，或是他們的咨詢師可能會給他們一些 tips。畢竟心理學是個比較微妙的領域，可能再過幾年就會有新的理解和理論，告訴我們其實我們應該怎麼樣做。
    - 我不想 enforce 並限制用戶用某些方法論。他們應該要能自己決定要用什麼方法論，如果效果不好，就不用。所以我們要做徹底的插件化。UI 的呈現是插件。Agent 的方法論是 skill 和提示詞。
    - 我們應該自帶一整套足夠好的系統，但用戶可以逐漸把他們的 jezo 變成他們想要的樣子。
- 我不想要一個純聊天的 agent，軟件的 UI 介面對我來說依然重要


Open Source Personal Agent to help you manage your life, scientifically
- 用戶指定方向和目標，agent 幫你規劃、盯你完成。
- 產品形態抄 Muse (muse.ai)。Muse 是「給它目標它去做」，我們是「給它目標它幫你排、盯你做」。

核心目標
- Life management agent：管 todo、規劃生活、管長期目標，把目標拆進每天的 todo。Agent 做 planning，用戶做執行。
- Agent 是提案者不是老闆。計畫 agent 排，用戶按一下確認或改。別人指派的計畫人會反抗，自己認可的才會做。UI 上別讓「排好計畫」看起來像「有進展」，那會讓人排完就滿足了。
- "scientifically" 的意思：方法論不寫死。理論會被推翻，也沒有一套適合所有人。所有方法論都是 skill 或給 agent 的指示，可裝、可關、可改，agent 自己也能改。只有 UI 和 todo 的資料結構這種拆不開的東西，用現有理論指導設計（例如 todo 項目有「什麼情境下做」的欄位）。
- 內建的預設 skill（全部可換可關）：
    - 目標拆成 if-then（什麼情境下做什麼），不是「這週讀完第三章」
    - 用用戶自己的完成紀錄估工時，修正人天生的樂觀
    - 進度追蹤、週報
    - 某天崩了的重排流程，語氣別像老闆
    - 習慣綁到固定線索（時間 / 地點 / 前一個動作）
    - n-of-1 實驗：想試「早上先做最難的事」有沒有用，agent 排 A/B 週、記完成率、給結論
- Agent 是主要入口，不是唯一入口。聊天是 GUI。GUI 也能直接改資料。

不做（主要是不想做）
- 多用戶
- coding agent
- general agent，只做個人日程
- OpenClaw（AI commit 太多，早期中期體驗爛）
- Tauri
- 複雜的權限系統。改用 undo：agent 犯錯之後可以立刻回滾（見 undo.md）。
- 預設安裝不放要額外跑服務的記憶引擎（Hindsight 之類），那是進階選項

型態
- Electron 桌面 app。同一個後端也能 headless 跑在 docker 裡配 web UI，那是包裝問題，先做桌面。
- Harness 用 pi。理由：GUI 是我們自己的，harness 只需要 loop、檔案工具、skills 載入、session 級注入、串流事件、多 provider，pi 剛好只有這些，而且是 TS，直接在 Electron main process 裡跑，沒有跨進程邊界。Hermes 的電池（cron、approvals、dashboard plugin）我們用不到。dsh 還沒到能二次開發的程度。
- 記憶：pi-hermes-memory（Hermes 記憶的移植版，本地 markdown + FTS5，不用額外服務）。記憶後端留一個插槽，Hindsight 之類的放後面當選項；要接就接 Vectorize 官方的 pi 擴充，社群版跟它有工具名衝突。
- 內建的 pi 擴充由我們打包進 app、鎖版本，用戶不用自己裝 pi package。這是發佈方式，不是限制用戶跑自己的程式碼。native addon（better-sqlite3）要對著 Electron 的 Node rebuild，先排進去。
- Python 只剩 Standard ASR 一個 sidecar，uv 包，然後用戶安裝 standard asr compliant 的 asr 插件。
- 100% GUI。用戶任何情況下不碰命令行和設定檔，最多複製貼上。
- 用戶可能跑比較弱的本地模型，會犯錯。架構上用程序化的檢查去抓，類似 linter：agent 犯錯時，檢查器能一定程度上發現，不用等用戶自己發現東西炸了。這些檢查只抓錯，不限制模型能做什麼。

架構
- 一切都是插件，「目標」也是。插件 = 一個目錄。目錄裡有：
    - manifest：資料檔的 schema。GUI 從 schema 渲染，agent 不在也能看能改
    - skills、AGENTS.md（告訴 agent 這個目錄怎麼用）
    - 這個插件的記憶
    - validator：agent 寫壞格式就過不了
    - UI layout：宣告式，引用預建 widget，讓 agent 建 UI 更方便。但不禁止 agent 有更多控制，包括自己寫 UI code。
- 目錄是 single source of truth，agent 直接在裡面工作。另外有一個從目錄衍生的索引（watcher + 快取），給跨插件查詢（「這週到期的全部東西」）和 GUI 用。索引隨時能從目錄重建。
- 檔案格式見 storage.md：散文用 markdown，要查詢的結構化資料放欄位（frontmatter、JSONL、YAML）。
- Undo（詳見 undo.md）：在 workspace 外面記錄 agent 每一輪改了哪些檔案、改之前的內容、寫入後的 hash。只撤銷 agent 的改動，用戶之後改過的檔案不動。紀錄只留短期，丟了也無妨。
- Validator 掛在寫入之後。驗證失敗不是靜默拒絕，把錯誤丟回給 agent 讓它修。這是讓小模型乖乖產出結構化資料最有效的辦法。驗證和建索引是同一個 pass。
- 每一輪結束 diff 目錄。Agent 說「排好了」但檔案沒動，標出來。任務只有在有工具結果或用戶確認時才能標完成。計畫不等於做完。
- 記憶 / 觀察類的記錄 frontmatter 要有：來源、範圍、觀察時間、有效期、stated 還是 inferred、被哪條取代。inferred 必須帶 evidence（事件 id）和 confidence，沒 evidence 的推論 validator 不讓寫。這是防「兩次沒去運動」被寫成「這人沒自律」。
- 從 connector（行事曆、email）進來的外部內容，寫進目錄前打來源標記，走和用戶輸入不同的通道。記憶投毒是真的會發生的事。
- 插件契約在第二個插件出現之前不要定死。

Session 模型
- 沒有長對話。全部是短 session：早上 cron 開一個排今天，晚上 cron 開一個 check-in，熱鍵每按一次開一個。
- 每個 session 開始注入一份小 digest：今天的 todo、進行中的目標、上次 check-in 的結論、目錄地圖。Agent 不需要猜要去哪讀，也不能不讀。
- 短 session 碰不到 compaction，每次都拿新鮮的記憶快照。
- 上次用 dsh 搭的那版爛就爛在這：一個長聊天室撐整個實驗，沒記憶、沒排程、context fetch 不到、fetch 到下一輪就忘、compaction 出問題。

功能
- 目標（第一個插件，抄 Muse）：進度條、把任務丟進每天的 todo、定期 report。Dashboard 由 agent 填 layout schema 生成。
- Todo list，給人和 AI。
- 行事曆 connector、各種 connector、MCP、skills。
- AI 有自己的文檔，用戶不知道怎麼用直接問。
- 新功能 = 新目錄，AGENTS.md + skill + manifest。可以掛 hook 到主 agent，可以註冊新的 UI 元件。

桌面 App
- 語音輸入（Standard ASR），毫無疑問
    - 簡單問答 → 懸浮窗直接顯示
    - 長任務 → 開主視窗
    - 語音輸入 context aware
- opt + x 快速喚醒，毫無疑問。短按打字，長按語音。

自己用，自己測
- 這東西我要真的用。不搞 KPI。
- 但要有幾個固定情境確認它沒退化：
    - 「幫我安排下週」：它有沒有自己去拿可用時間、最近失敗的計畫、明確限制、還有效的目標
    - 改了偏好之後，舊的還會不會冒出來
    - 沒執行的計畫有沒有被記成完成
    - 不同生活領域有沒有互相洩漏
    - 刪掉的東西有沒有再出現

一件沒定的事
- 晚上的 check-in 如果必須在手機上做才有人做，harness 該選 Hermes，它的 Telegram / WhatsApp gateway 是現成的，其他差異都比這件小。我自己是主要用戶，先看自己晚上會不會在電腦前再決定。不換的話，手機通道之後用一個 bot library 收發訊息開 session 就行，幾十行。
