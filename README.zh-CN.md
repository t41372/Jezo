<p align="center"><img src="docs/brand/icon.svg" width="128" alt=""></p>

<h1 align="center">Jezo</h1>

<p align="center">本地优先的个人 agent，帮你把目标变成计划，再一件件跟进，让你专注在当下。</p>

<p align="center"><a href="README.md">English</a> · 简体中文</p>

名字来自「节奏」（jiézòu）。

方向你来定。Jezo 的 agent 帮你排好每一天、让清单保持最新、到时候提醒你跟进。事情由你来做。

Jezo 是为有 ADHD、试过一个又一个待办应用又都放弃了的人做的。那些应用不是功能不够，而是收集上下文、维护清单比做事本身还累；离开一个礼拜再回来，清单早就过时了。这些维护工作交给 Jezo 的 agent。你的数据留在你自己的电脑上，是看得懂的普通文件，可以自己备份、搬走、删除。

<p align="center"><img src="docs/screenshots/zh-CN/chat.jpg" alt="一段对话：agent 的思考过程收起来了，下面是它提议的今天的安排，等你确认"></p>

## 能做什么

- **跟你一起排，而不是替你决定。** 让它帮你排明天，或者跟它说今天不太顺。它提议的计划都是草稿，你说好了才算。它想了什么、看了哪些文件，都收在每个回答下面。
- **今天**：现在该做什么、接下来做什么、哪些快截止了。
- **待办** 有时间、截止日、在什么情境下做（「到公司倒完咖啡之后」）、步骤、笔记和附件。可以设成重复，截止前会提醒。
- **日历。** 这台 Mac 的日历、用你自己的客户端连接的 Google 日历，还有任何 ICS 订阅，都和待办放在一起。把待办拖到这周的某个时间就排好了。Jezo 只读，不会改你的日历。
- **目标** 拆成「在什么情境下做什么」的规则，agent 会看哪些规则对你真的有用。
- **随手记和 ⌥X。** 在任何地方按 ⌥X，问 Jezo 一个问题或记一笔；按住就能语音输入。随手记交给 agent 后，它会提议每一条变成待办、目标还是要记住的事。
- **自动化。** 早上安排、晚上 check-in、每周回顾会自己开始，你也可以加自己的。电脑睡着时错过的，醒来会补上。
- **小实验。** 想知道「早上先做最难的事」对你有没有用？Jezo 可以用几周时间做 A/B 对比，告诉你你自己的记录怎么说。
- **记忆。** 记住你说过的事，你删掉的就忘掉。
- **撤销。** agent 做的每个改动都列在「修改记录」里，都能撤销。
- **方法是你的。** 每一种安排方法都是一个 skill，可以关掉、修改或换掉；Jezo 也能安装 skill、MCP 服务器和 pi 包。

<p align="center">
  <img src="docs/screenshots/zh-CN/today.jpg" width="49%" alt="深色模式的今天页：现在、等一下、做完的">
  <img src="docs/screenshots/zh-CN/todos.jpg" width="49%" alt="待办，按安排的时间分组">
</p>
<p align="center"><img src="docs/screenshots/zh-CN/calendar.jpg" alt="深色模式的日历：这一周，旁边是还没排时间的待办"></p>

界面有简体中文、繁体中文和英文，默认跟随系统语言。

## 安装

Jezo 支持 Apple 芯片的 Mac。

1. 从 [Releases](../../releases) 下载 `.dmg`，把 Jezo 拖进「应用程序」。
2. Jezo 还没有签名，第一次打开时 macOS 会拦下来。打开 **系统设置 → 隐私与安全性**，往下找到关于 Jezo 的那一行，点 **仍要打开**。
3. 选一个模型。如果 [LM Studio](https://lmstudio.ai) 或 [Ollama](https://ollama.com) 正在运行，Jezo 会自己找到。也可以在 **设置 → 模型服务商** 填入 Anthropic、OpenAI、Google、OpenRouter 等服务商的密钥。
4. 想用语音代替打字，在设置的 **语音识别** 点 **安装**。它会下载一个在你 Mac 上运行的小型语音模型。

你的数据在 `~/Jezo`：都是 markdown 文件，每个待办、目标、笔记各一个。密钥存在 macOS 的钥匙串里。

## 开发

需要 [Bun](https://bun.sh)、Node 26，以及 Xcode Command Line Tools（用来构建原生组件：⌥X 快捷键、Mac 日历和 Apple 的端侧模型）。

```sh
bun install
bun run dev        # 启动 app，带热更新
bun run typecheck
bun run test       # 单元测试
bun run e2e        # 在构建好的 app 里跑端到端测试
bun run package    # 在 dist/ 生成未签名的 app
```

端到端测试会在一个临时工作区里运行真正的 app。需要模型的测试要用 LM Studio 加载 `qwen3.6-35b-a3b-splash`（设置 `JEZO_TEST_MODEL` 可以换成别的），没有本地模型服务时会自动跳过。标了 `@speech` 的测试需要先装好语音识别。其他的都在 CI 里跑。

上面的截图来自 `node scripts/screenshots.ts`（先 `bun run build`）：它为每种语言用测试用的范例工作区（写成该语言）从构建好的 app 截图，再把半透明的窗口叠在 `docs/screenshots/backdrops/` 里的画上。要加一张图，在脚本里加一项就行。

## 怎么做的

- [AGENTS.md](AGENTS.md)：原则和信任模型，从这里开始看。
- [docs/design/](docs/design/)：每个决定、原因，以及放弃了哪些做法。主要是 [backend.md](docs/design/backend.md) 和 [frontend.md](docs/design/frontend.md)。

Jezo 是 Electron 应用。它的 agent 是在主进程里运行的 [pi](https://github.com/earendil-works/pi)，工作目录就是工作区文件夹：它像编程 agent 一样，用文件和工具读写你的数据。界面用 React，聊天部分用 [assistant-ui](https://www.assistant-ui.com)。

## 许可证

[Apache-2.0](LICENSE)
