## Recommendation for Jezo

**Adopt Vercel Streamdown for rendering and shadcn’s official Base UI chat primitives for the conversation surface. Keep pi, Jezo’s IPC, plugin cards, shared composer, and undo handling authoritative.** Use selected AI Elements components as copy-in material for actions and tool details. Treat assistant-ui as the strongest alternative if Jezo later wants a complete chat interaction framework. **(inference)**

Two 2026 developments materially change this decision:

- **shadcn now ships official chat primitives**, including `MessageScroller`, with Base UI support. They cover streaming follow, turn anchoring, saved-thread opening, prepended history, and message navigation without owning messages or the runtime. [June 2026 announcement](https://ui.shadcn.com/docs/changelog/2026-06-chat-components), [Base UI source](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/message-scroller.tsx).
- **assistant-ui now has a pi adapter**, including steering, follow-up queues, streaming tool output, and model/thinking controls. However, its documented limitations include no fork/tree-navigation methods and no per-item queue editing. It therefore does not remove Jezo’s branching work. [Pi adapter](https://github.com/assistant-ui/assistant-ui/blob/main/packages/react-pi/README.md).

The recommendations below reflect sources inspected on **2026-09-30**. Package versions mentioned are repository-manifest snapshots, not independently verified npm release tags.

## 1. Streaming Markdown, LaTeX, and code

### Streamdown: the recommended renderer

The inspected manifest identifies Streamdown as **2.6.0**, Apache-2.0 licensed, ESM, with React 18 and 19 peer support. Code, math, Mermaid, and CJK support are separate plugins. It does not require the Vercel AI SDK: its input is Markdown text and rendering props. [Manifest](https://github.com/vercel/streamdown/blob/main/packages/streamdown/package.json), [usage](https://streamdown.ai/docs/usage).

| Requirement | What Streamdown supplies |
|---|---|
| Markdown and tables | GFM parsing, styled Markdown elements, and tables with scrolling and optional copy/download/fullscreen controls. [Components](https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/components.tsx), [table implementation](https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/table/index.tsx). |
| Incomplete streaming syntax | Remend repairs the presentation of incomplete emphasis, inline code, links, images, and math. Incomplete links receive an inert placeholder destination; incomplete images are withheld. [Remend](https://github.com/vercel/streamdown/blob/main/packages/remend/README.md). |
| Code highlighting | Optional Shiki plugin, dual themes, lazy language loading, and token caching. [Code documentation](https://streamdown.ai/docs/plugins/code). |
| Incremental code highlighting | The inspected code plugin, version **2.0.0**, retains grammar state and completed rows for growing code blocks rather than repeatedly tokenizing their entire contents. This matters when evaluating older performance complaints. [Manifest](https://github.com/vercel/streamdown/blob/main/packages/streamdown-code/package.json), [implementation](https://github.com/vercel/streamdown/blob/main/packages/streamdown-code/index.ts). |
| LaTeX | Optional KaTeX plugin, inline and display math, and MathML output. [Math documentation](https://streamdown.ai/docs/plugins/math). |
| Mermaid | Optional diagram plugin with copy, download, fullscreen, theming, and error handling. [Mermaid documentation](https://streamdown.ai/docs/plugins/mermaid). |
| Traditional Chinese | Optional CJK plugin addressing emphasis and autolink behavior around CJK punctuation. [CJK documentation](https://streamdown.ai/docs/plugins/cjk). |
| Tailwind v4 | Documented `@source` directives for core and installed plugins. [Installation](https://streamdown.ai/docs/getting-started). |

**Incomplete Markdown is a rendering concern, not a transcript transformation.** Keep the exact model output in pi’s transcript; let Streamdown repair the displayed intermediate state. Its streaming implementation splits and memoizes blocks, while Remend operates before Markdown parsing. [Rendering source](https://github.com/vercel/streamdown/blob/main/packages/streamdown/index.tsx), [Remend pipeline](https://github.com/vercel/streamdown/blob/main/packages/remend/README.md).

This does not guarantee that every partial table or ambiguous delimiter has its final layout immediately. A growing table can still change shape, and highlighting, math, and images can change height. Scroll handling must accommodate those changes independently. **(inference)**

### Math configuration needs an explicit decision

Streamdown’s math plugin defaults to **double-dollar delimiters**, including inline `$$…$$`. Single-dollar `$…$` syntax is opt-in through `createMathPlugin({ singleDollarTextMath: true })`; Remend’s corresponding `inlineKatex` option also defaults off because of currency ambiguity. [Math configuration](https://streamdown.ai/docs/plugins/math), [Remend options](https://github.com/vercel/streamdown/blob/main/packages/remend/README.md).

For Jezo, keep currency-safe defaults and tell the agent which math delimiters the UI supports. Add bracket-delimiter normalization only if real model output requires it, with code spans/fences protected from that transformation. **(inference)** LibreChat, Jan, and big-AGI each have additional math handling beyond simply installing `remark-math`, illustrating this integration detail. [LibreChat configuration](https://github.com/LibreChat-AI/LibreChat/blob/main/client/src/components/Chat/Messages/Content/markdownConfig.ts), [Jan renderer](https://github.com/janhq/jan/blob/main/web-app/src/containers/RenderMarkdown.tsx), [big-AGI renderer](https://github.com/enricoros/big-AGI/blob/main/src/modules/blocks/markdown/CustomMarkdownRenderer.tsx).

### Mermaid should be a second step

Streamdown exposes `useIsCodeFenceIncomplete()` so an expensive diagram can wait until its fence closes. Its Mermaid documentation recommends avoiding repeated diagram rendering while syntax is still arriving. [Streaming Mermaid](https://streamdown.ai/docs/plugins/mermaid).

Ship Markdown, code, math, and CJK first. Add Mermaid in a separate, locally bundled chunk, rendering incomplete diagrams as source or a placeholder. This keeps an uncommon feature out of the initial chat path. **(inference)**

### Security defaults require configuration

Streamdown combines raw HTML parsing, sanitization, and URL hardening. **Its hardening defaults permit all image prefixes, link prefixes, and protocols, and permit data images**; the sanitizer still applies its own HTML and protocol restrictions. Replacing `rehypePlugins` replaces the default array, so custom configuration must retain sanitization deliberately. [Security documentation](https://streamdown.ai/docs/security), [default plugin source](https://github.com/vercel/streamdown/blob/main/packages/streamdown/index.tsx).

Its link-safety feature defaults to a confirmation modal showing the destination, with callbacks and a custom-modal hook. That modal is separate from URL filtering and image loading. [Link safety](https://streamdown.ai/docs/link-safety).

For Jezo, the relevant threat is outside content causing execution or unintended network requests. Rendering an email-derived tracking image is already an outgoing action, even if nobody clicks it. Use a Jezo-owned link/image policy rather than assuming the renderer’s defaults implement the project’s trust model. **(inference)** See the concrete policy in section 5.

### Theming it to Jezo

Streamdown uses shadcn token names and exposes `data-streamdown` selectors for local overrides. Jezo already defines the relevant tokens, including `--foreground`, `--muted`, `--border`, `--ring`, and `--radius`. [Streamdown styling](https://github.com/vercel/streamdown/blob/main/apps/website/content/docs/styling.mdx), [Jezo tokens](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/renderer/src/styles/globals.css).

Recommended integration **(inference)**:

- Preserve Jezo’s existing card surface, 14.5px text, line height, and rounded corners.
- Put Streamdown inside that surface; remove `whitespace-pre-wrap` from the Markdown container.
- Scope overrides under `.chat-markdown`, using `data-streamdown` selectors.
- Keep code and table scrolling inside the message; give their containing flex/grid children `min-width: 0`.
- Retain Streamdown’s code pipeline. Overriding `components.code` replaces inline code, highlighted blocks, Mermaid, and custom code renderers together. [Component override behavior](https://streamdown.ai/docs/components).
- Hoist plugin objects, component maps, and security configuration so their identities remain stable.

The proposed Tailwind sources, relative to Jezo’s existing `styles/globals.css`, are:

```css
@source "../../../../node_modules/streamdown/dist/*.js";
@source "../../../../node_modules/@streamdown/code/dist/*.js";
@source "../../../../node_modules/@streamdown/math/dist/*.js";
@source "../../../../node_modules/@streamdown/cjk/dist/*.js";
```

Import KaTeX’s stylesheet through Vite so its fonts ship locally. Add Mermaid’s source directive only when that plugin is installed. The upstream documentation requires these source directives and the KaTeX CSS import. [Installation](https://streamdown.ai/docs/getting-started), [math setup](https://streamdown.ai/docs/plugins/math).

### Bundle size: separate startup cost from installed size

I did **not** obtain a defensible current combined gzip figure for Streamdown 2.6.0 plus its selected plugins. No installation or build measurement was performed in this read-only task.

The verified architecture is more useful than an old headline number:

- Core does not list Shiki, KaTeX, or Mermaid as production dependencies; those features are plugin additions. [Core manifest](https://github.com/vercel/streamdown/blob/main/packages/streamdown/package.json).
- The inspected code plugin uses Shiki with its JavaScript regex engine and loads language/theme resources as needed. [Code source](https://github.com/vercel/streamdown/blob/main/packages/streamdown-code/index.ts).
- Streamdown has a bundle-size script distinguishing core and Shiki configurations, but it stubs CSS and fonts; that is not the complete Electron asset footprint. [Measurement script](https://github.com/vercel/streamdown/blob/main/packages/streamdown/scripts/bundle-size.js).
- Shiki documents different full, web, and custom bundle strategies. Import choice affects the result. [Shiki bundles](https://shiki.style/guide/bundles).

For implementation, record **initial renderer JS, lazy chunks, KaTeX CSS/fonts, total packaged assets, and parsing/highlighting time separately**. Keep all dynamic chunks local; lazy loading must not become CDN loading. **(inference)**

### Alternatives

| Renderer | License and architecture | Assessment for Jezo |
|---|---|---|
| **react-markdown + remark/rehype** | MIT; CommonMark renderer with replaceable components and plugins. GFM, math, and highlighting are additional pieces. Raw HTML needs explicit handling; plugins and URL transforms can change its security properties. [README](https://github.com/remarkjs/react-markdown/blob/main/readme.md). | Excellent for static Markdown or an established custom pipeline. Jezo would still own partial-syntax repair, block caching, code controls, overflow, and streaming performance. Prefer Streamdown here. **(inference)** |
| **markstream-react** | MIT; inspected manifest 2.0.14. Accepts raw content or pre-parsed nodes, with optional math/diagram/code dependencies. The React README exposes `final`, custom components, and HTML policy. [Manifest](https://github.com/Simon-He95/markstream-vue/blob/main/packages/markstream-react/package.json), [React README](https://github.com/Simon-He95/markstream-vue/blob/main/packages/markstream-react/README.md). | Serious alternative for long responses and externally owned parsing. Evaluate the React package specifically; do not assume every Vue feature or virtual-timeline feature exists in React. More adaptation to Jezo’s tokens than Streamdown. **(inference)** |
| **LobeHub Markdown, `@lobehub/ui`** | MIT; static rendering uses react-markdown, streaming uses `@lobehub/streamdown`. Includes custom code, tables, math, CJK, and optional sanitized HTML. [Static renderer](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/MarkdownRender.tsx), [stream renderer](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx), [plugins](https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/useMarkdownRehypePlugins.ts). | Mature behavior, but importing the whole UI package introduces another styling/theme system and Ant Design peers. Avoid for Jezo’s Markdown alone. **(inference)** |
| **`@lobehub/streamdown`** | Separate MIT project—not Vercel Streamdown. Headless React 19 engine with block caching, paced reveal, Remend, and LaTeX guarding. It documents a cross-block-reference limitation affecting footnotes and reference links/images. [README](https://github.com/lobehub/streamdown/blob/main/README.md). | Attractive if Jezo wants to own every rendered element. It supplies less ready-made code/table/security UI than Vercel Streamdown. **(inference)** |
| **llm-ui** | MIT; headless output segmentation, incomplete-syntax handling, throttled reveal, custom blocks, and Shiki code support. [README](https://github.com/richardgill/llm-ui/blob/main/README.md). | Useful for mixed structured output. It is not a conversation kit; math, actions, queues, branches, scrolling, and attachments remain separate work. **(inference)** |
| **HyperMarkdown** | MIT; React 18/19, incomplete Markdown, GFM, KaTeX, Mermaid, sanitized HTML, and sub-block caching for code lines/table rows/list items. Its September 2026 benchmarks are author-run comparisons. [README](https://github.com/Aeven-AI/HyperMarkdown/blob/main/README.md). | Worth a performance spike if giant streaming blocks remain slow. Do not treat its benchmark ratios as Jezo results, particularly against the newly inspected incremental Streamdown code plugin. **(inference)** |

## 2. Chat component kits

### Runtime and styling fit

| Kit | License / adoption model | Runtime relationship | Base UI / Tailwind v4 fit |
|---|---|---|---|
| **Official shadcn chat primitives** | MIT. Copy-in styled components plus `@shadcn/react` headless dependency. [License](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md), [package](https://github.com/shadcn-ui/ui/blob/main/packages/react/package.json). | Does not own messages, transport, persistence, branching, or model state. [Scroller README](https://github.com/shadcn-ui/ui/blob/main/packages/react/src/message-scroller/README.md). | Direct Base UI registry implementation; strongest fit. **(inference)** [Source](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/message-scroller.tsx). |
| **Vercel AI Elements** | Apache-2.0; copy-in component source. [License](https://github.com/vercel/ai-elements/blob/main/LICENSE), [repository](https://github.com/vercel/ai-elements). | Examples use AI SDK; many components are presentational. Some types and state names use AI SDK message/tool types. [Message](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/message.tsx), [tool](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/tool.tsx). | Tailwind/shadcn styling fits, but reviewed source still contains Radix-style `asChild` composition. Port selected components to Jezo’s `render` composition. **(inference)** |
| **assistant-ui** | MIT dependency for runtime/primitives, with editable UI elements/examples. [React manifest](https://github.com/assistant-ui/assistant-ui/blob/main/packages/react/package.json), [repository](https://github.com/assistant-ui/assistant-ui). | Custom `ExternalStoreRuntime` supports an existing Zustand store and callbacks; AI SDK is not required. Also has a pi adapter. [External-store API](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/runtimes/custom/external-store.mdx). | React 19 supported. Core still declares `radix-ui`; newer UI workspace includes both Base UI and Radix. Inspect individual elements rather than assuming a Radix-free installation. [Core manifest](https://github.com/assistant-ui/assistant-ui/blob/main/packages/react/package.json), [UI manifest](https://github.com/assistant-ui/assistant-ui/blob/main/packages/ui/package.json). |
| **prompt-kit** | MIT, copy-in components/registry. [Manifest](https://github.com/ibelick/prompt-kit/blob/main/package.json), [repository](https://github.com/ibelick/prompt-kit). | Controlled component APIs do not require AI SDK runtime; its demo application includes AI SDK dependencies. [Prompt input](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/prompt-input.tsx). | Repository uses React 19 and Tailwind v4; reviewed components use Radix-style composition. Good visual material, with a Base UI port cost. **(inference)** |
| **`@lobehub/ui` chat components** | MIT dependency; inspected version 5.51.2. [Manifest](https://github.com/lobehub/lobe-ui/blob/master/package.json). | Callback-driven UI; no Vercel runtime requirement. [ChatList API](https://github.com/lobehub/lobe-ui/blob/master/src/chat/ChatList/type.ts). | Now includes Base UI components, but chat styling still uses `antd-style`, and `ChatInputArea` uses Ant Design textarea types. Not a shadcn theme drop-in. [ChatList](https://github.com/lobehub/lobe-ui/blob/master/src/chat/ChatList/ChatList.tsx), [input types](https://github.com/lobehub/lobe-ui/blob/master/src/chat/ChatInputArea/type.ts). |
| **CopilotKit** | MIT dependency/framework. [Repository](https://github.com/CopilotKit/CopilotKit). | Current chat uses CopilotKit agent/thread services and AG-UI message contracts. A pi integration would need an adapter or the lower-level controlled view. [Chat implementation](https://github.com/CopilotKit/CopilotKit/blob/main/packages/react-core/src/v2/components/chat/CopilotChat.tsx). | Customizable slots and its own styling surface. More integration machinery than Jezo needs. **(inference)** |
| **llm-ui** | MIT dependency. [README](https://github.com/richardgill/llm-ui/blob/main/README.md). | Consumes model output; no prescribed conversation backend. | Headless and easy to theme, but solves output rendering rather than chat interaction. **(inference)** |

“Shadcn chat blocks” is not one library with one license or capability contract. The official primitives above are now the relevant baseline; third-party blocks need their own source/license review.

### What each actually handles

**Official shadcn: best conversation surface for Jezo.** `MessageScroller` owns opening position, new-turn anchoring, follow-output, prepend preservation, visibility, and navigation. `Message`, `Bubble`, `Attachment`, and `Marker` provide surrounding presentation. They deliberately leave edit, regenerate, branch persistence, queue delivery, steering, and tool execution to the application. [Announcement](https://ui.shadcn.com/docs/changelog/2026-06-chat-components), [scroller API](https://github.com/shadcn-ui/ui/blob/main/packages/react/src/message-scroller/README.md).

It is **not virtualized by default**. The styled items use `content-visibility:auto`; the project separately benchmarks substantial real-DOM transcripts. This avoids conflating reduced offscreen rendering with DOM virtualization. [Performance document](https://github.com/shadcn-ui/ui/blob/main/packages/react/src/message-scroller/PERFORMANCE.md), [styled items](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/message-scroller.tsx).

**AI Elements: good parts, not a persisted conversation engine.** It supplies message actions and response-version arrows; the branch component owns local branch-index state and emits `onBranchChange`. Its documentation explicitly leaves branching to application design. `Conversation` wraps `use-stick-to-bottom`; `Tool` exposes input/output/error states; `Queue` displays queued messages/todos and attachments but does not schedule them. [Message source](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/message.tsx), [branching documentation](https://elements.ai-sdk.dev/components/message), [conversation](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/conversation.tsx), [queue](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/queue.tsx).

Copy actions and tool presentation selectively. Avoid copying its complete `MessageResponse` unchanged: the inspected source imports code, math, CJK, and Mermaid plugins together. **(inference)** [Imports](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/message.tsx).

**assistant-ui: most complete interaction framework.** Its external-store adapter has explicit handlers for new messages, edit, reload/regenerate, cancel, tool results, attachments, and branch changes. Branch repositories can be imported/exported. Missing callbacks disable the corresponding capabilities rather than inventing backend behavior. [External-store API](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/runtimes/custom/external-store.mdx).

It also supports a queue adapter with ordinary and steering lanes. Its pi adapter maps running Enter to follow-up and a separate shortcut to steering. Native pi queue items can be displayed and cleared together, but per-item remove/promote controls are documented as unsupported. Virtualization is provided as a TanStack Virtual example requiring additional integration. [External-store queue](https://www.assistant-ui.com/docs/runtimes/custom/external-store), [pi queue limitations](https://github.com/assistant-ui/assistant-ui/blob/main/packages/react-pi/README.md), [virtualized thread example](https://github.com/assistant-ui/assistant-ui/blob/main/examples/with-virtualized-thread/app/VirtualizedThread.tsx).

For Jezo, use `ExternalStoreRuntime` if adopting assistant-ui—not its standalone Node supervisor. Jezo’s host already supplies tools, checks, memory, calendars, and undo context. Replacing that host would create a second owner of important behavior. **(inference)** [Jezo host](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts), [adapter boundary](https://github.com/assistant-ui/assistant-ui/blob/main/packages/react-pi/README.md).

**prompt-kit: polished presentation with substantial application work remaining.** Its chat container wraps `use-stick-to-bottom`; Markdown splits blocks with `marked` and renders them through react-markdown; tool components have streaming/input/output/error states. Its controlled composer is usable with IPC, but it does not provide a persisted branch repository or pi queue semantics. [Container](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/chat-container.tsx), [Markdown](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/markdown.tsx), [tool](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/tool.tsx), [composer](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/prompt-input.tsx).

**LobeHub UI: reusable chat visuals, with application-owned semantics.** `ChatList` exposes edit/action/render callbacks and maps its supplied data; it is not the application’s virtualized transcript engine. `ChatInputArea` has addon slots for controls and attachments. Branching, retry requests, queue delivery, upload processing, and scroll policy must still come from the host application. [ChatList implementation](https://github.com/lobehub/lobe-ui/blob/master/src/chat/ChatList/ChatList.tsx), [API](https://github.com/lobehub/lobe-ui/blob/master/src/chat/ChatList/type.ts), [input API](https://github.com/lobehub/lobe-ui/blob/master/src/chat/ChatInputArea/type.ts).

**CopilotKit: more capable in 2026 than older comparisons suggest.** Current message components expose copy, edit, regenerate, branch-navigation callbacks, tool calls, and attachments. The message view has automatic TanStack virtualization; the scroll view uses `use-stick-to-bottom` and additional pinning logic. These are useful features, but backend branch persistence and pi steering remain an integration contract. [User message](https://github.com/CopilotKit/CopilotKit/blob/main/packages/react-core/src/v2/components/chat/CopilotChatUserMessage.tsx), [assistant message](https://github.com/CopilotKit/CopilotKit/blob/main/packages/react-core/src/v2/components/chat/CopilotChatAssistantMessage.tsx), [virtualization](https://github.com/CopilotKit/CopilotKit/blob/main/packages/react-core/src/v2/components/chat/CopilotChatMessageView.tsx), [scrolling](https://github.com/CopilotKit/CopilotKit/blob/main/packages/react-core/src/v2/components/chat/CopilotChatView.tsx).

Its maintainers document why bundle figures need context: approximately 3MB gzip in one bundled esbuild regression measurement versus approximately 386kB initial JS in a Vite consumer, with heavy resources in separate chunks. These are CopilotKit measurements, not Streamdown or Jezo sizes. [Bundle-size methodology](https://github.com/CopilotKit/CopilotKit/blob/main/dev-docs/bundle-size.md).

## 3. How the larger projects built theirs

### LobeHub / LobeChat

LobeHub separates the reusable UI library from the application:

- Static Markdown uses react-markdown; streaming Markdown uses its own headless `@lobehub/streamdown`. [Renderers](https://github.com/lobehub/lobe-ui/tree/master/src/Markdown/SyntaxMarkdown).
- Markdown plugins cover GFM, CJK, math, custom footnotes, and optional raw HTML followed by sanitization. Streaming highlighting uses Shiki and a separate stream-highlighting path. [Remark plugins](https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/useMarkdownRemarkPlugins.ts), [rehype plugins](https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/useMarkdownRehypePlugins.ts), [stream highlighter](https://github.com/lobehub/lobe-ui/blob/master/src/Highlighter/SyntaxHighlighter/StreamRenderer.tsx).
- The application transcript uses **virtua**, with custom user-scroll-intent detection, per-topic restoration, selection handling, and auto-scroll policy. [Virtualized list](https://github.com/lobehub/lobehub/blob/main/src/features/Conversation/ChatList/components/VirtualizedList.tsx).
- The composer uses `@lobehub/editor` and Lexical integration, with explicit IME and paste-file handling. [Input editor](https://github.com/lobehub/lobehub/blob/main/src/features/ChatInput/InputEditor/index.tsx).

The lesson is that **a mature Markdown component and a mature chat product are separate layers**. Adopting `@lobehub/ui` does not import LobeHub’s conversation-state or scroll behavior. **(inference)**

Code reuse also needs the correct license boundary: `@lobehub/ui` and `@lobehub/streamdown` are MIT, while the inspected application license adds commercial-derivative conditions to Apache-2.0. [UI manifest](https://github.com/lobehub/lobe-ui/blob/master/package.json), [stream engine](https://github.com/lobehub/streamdown), [application license](https://github.com/lobehub/lobehub/blob/main/LICENSE).

### Paseo

The requested project is **[getpaseo/paseo](https://github.com/getpaseo/paseo)**. Its app uses React Native/Expo with web-specific implementations, rather than a shadcn React DOM chat kit. Its own code is Apache-2.0, with third-party components retaining their licenses. [App manifest](https://github.com/getpaseo/paseo/blob/main/packages/app/package.json), [license](https://github.com/getpaseo/paseo/blob/main/LICENSE).

Its relevant choices are:

- Markdown parsing through **markdown-it**, rendered through custom rules around `react-native-markdown-display`; HTML parsing is off. [Renderer](https://github.com/getpaseo/paseo/blob/main/packages/app/src/components/markdown/renderer.tsx), [parser](https://github.com/getpaseo/paseo/blob/main/packages/app/src/utils/markdown-parser.ts).
- A custom **Lezer-based highlighting package**, not Shiki. KaTeX was not present in the inspected app dependency list; it should not be cited as Paseo’s math implementation. [Highlight dependencies](https://github.com/getpaseo/paseo/blob/main/packages/highlight/package.json), [app dependencies](https://github.com/getpaseo/paseo/blob/main/packages/app/package.json).
- **TanStack Virtual** on web, with separate history and live-content handling, resize compensation, history pagination, and message-addressed navigation. [Web strategy](https://github.com/getpaseo/paseo/blob/main/packages/app/src/agent-stream/strategy-web.tsx).
- An explicit bottom-anchor controller distinguishing sticky-bottom from detached reading. [Controller](https://github.com/getpaseo/paseo/blob/main/packages/app/src/agent-stream/bottom-anchor-controller.ts).
- A custom composer handling platform input, dictation, attachments, selection, and IME composition. [Composer input](https://github.com/getpaseo/paseo/blob/main/packages/app/src/composer/input/input.tsx).

Its performance document is especially useful. It records a pipeline of server coalescing, frame-batched store commits, cached Markdown blocks, and paced presentation. It documents concrete failures: trailing-only coalescing delayed the first character; repeated history-row renders cost substantial JS time; treating fetched history differently from live messages broke message-addressed features. It also insists that display-row IDs and message IDs remain distinct. [Performance decisions and measurements](https://github.com/getpaseo/paseo/blob/main/docs/agent-stream-performance.md).

For Jezo, copy those architectural lessons rather than the cross-platform renderer: stable identities, immutable completed blocks, cheap live-tail updates, and an explicit reading/following state. **(inference)**

### LibreChat

LibreChat uses react-markdown with GFM, KaTeX, highlight.js through `rehype-highlight`, and additional citation/artifact/math plugins. Its 2026 Markdown code maintains completed blocks and reparses the changing portion. [Pipeline](https://github.com/LibreChat-AI/LibreChat/blob/main/client/src/components/Chat/Messages/Content/markdownConfig.ts), [block renderer](https://github.com/LibreChat-AI/LibreChat/blob/main/client/src/components/Chat/Messages/Content/MarkdownBlocks.tsx).

The transcript has a custom progressive row-mount window, not simply “react-virtualized because that package appears in dependencies.” Its scrolling hook uses separate attach/detach thresholds and explicitly separates scroll-button visibility from whether the reader is following output. [Messages view](https://github.com/LibreChat-AI/LibreChat/blob/main/client/src/components/Chat/Messages/MessagesView.tsx), [row window](https://github.com/LibreChat-AI/LibreChat/blob/main/client/src/components/Chat/Messages/Thread/List.tsx), [scroll policy](https://github.com/LibreChat-AI/LibreChat/blob/main/client/src/hooks/Messages/useMessageScrolling.ts).

It also has sibling-version arrows, queued/in-flight steer presentation, and a textarea-based composer. These are application behavior, not capabilities supplied by react-markdown. [Sibling switch](https://github.com/LibreChat-AI/LibreChat/blob/main/client/src/components/Chat/Messages/SiblingSwitch.tsx), [steer menu](https://github.com/LibreChat-AI/LibreChat/blob/main/client/src/components/Chat/Input/SteerMenu.tsx), [composer](https://github.com/LibreChat-AI/LibreChat/blob/main/client/src/components/Chat/Input/ChatForm.tsx).

Its useful lesson is to give **reader intent one authority**. A visibility observer, resize handler, and incoming-message effect should not independently decide to move the viewport. **(inference)**

### Other implementations worth inspecting

| Project | Verified rendering, scrolling, and composer choices | Useful lesson for Jezo |
|---|---|---|
| **Open WebUI** | Svelte; `marked` plus custom KaTeX extensions, highlight.js code blocks, custom throttled transcript updates and prepend compensation. Composer uses its Tiptap/ProseMirror-based `RichTextInput`. [Markdown](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Messages/Markdown.svelte), [code](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Messages/CodeBlock.svelte), [messages](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Messages.svelte), [composer](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/MessageInput.svelte), [dependencies](https://github.com/open-webui/open-webui/blob/main/package.json). | Throttle content work separately from structural changes; do not infer transcript virtualization from a manifest dependency. **(inference)** Its current license has branding conditions, so treat it as a behavioral reference before copying code. [License](https://github.com/open-webui/open-webui/blob/main/LICENSE). |
| **Cherry Studio** | Current shared UI wraps **Vercel Streamdown**, defaults to code+CJK, and makes math/Mermaid opt-in. Transcript uses **virtua**, with separate chat scroll ownership/runtime and `keepMounted` support. [Markdown](https://github.com/CherryHQ/cherry-studio/blob/main/packages/ui/src/components/composites/markdown/streaming-markdown.tsx), [presets](https://github.com/CherryHQ/cherry-studio/blob/main/packages/ui/src/components/composites/markdown/presets.ts), [virtual list](https://github.com/CherryHQ/cherry-studio/blob/main/src/renderer/components/chat/messages/list/MessageVirtualList.tsx). | Particularly relevant Electron precedent. Selection, focus, and expansion state must survive virtualization. **(inference)** The application is AGPL-3.0; avoid casually copying it into Apache-2.0 Jezo. [Repository/license](https://github.com/CherryHQ/cherry-studio). |
| **Chatbox** | react-markdown, GFM, KaTeX, custom Shiki wrapper, Mermaid, and streaming-segment effects. **react-virtuoso** transcript with a separate smooth-follow controller. Mantine textarea composer with explicit IME handling. [Markdown](https://github.com/chatboxai/chatbox/blob/main/src/renderer/components/Markdown.tsx), [list](https://github.com/chatboxai/chatbox/blob/main/src/renderer/components/chat/MessageList.tsx), [input](https://github.com/chatboxai/chatbox/blob/main/src/renderer/components/InputBox/MessageInputField.tsx). | A general virtualizer still needs chat follow policy. The app is GPL-3.0. [Repository/license](https://github.com/chatboxai/chatbox). |
| **big-AGI** | react-markdown, GFM, KaTeX, custom tables/task lists, Prism code path, and custom scroll-to-bottom handling. The inspected list renders mapped messages rather than a virtualized list. Composer uses MUI Joy `Textarea` and custom attachment parts. [Markdown](https://github.com/enricoros/big-AGI/blob/main/src/modules/blocks/markdown/CustomMarkdownRenderer.tsx), [Prism](https://github.com/enricoros/big-AGI/blob/main/src/modules/blocks/code/code-highlight/codePrism.ts), [list](https://github.com/enricoros/big-AGI/blob/main/src/apps/chat/components/ChatMessageList.tsx), [composer](https://github.com/enricoros/big-AGI/blob/main/src/apps/chat/components/composer/Composer.tsx). | Its source explicitly discusses expensive preprocessing during progressive rendering. Avoid adding repeated whole-response regex passes. **(inference)** |
| **Jan** | Current renderer uses Streamdown, Shiki/CJK/Mermaid plugins, and custom remark/KaTeX preprocessing. Transcript `Conversation` uses **use-stick-to-bottom**; composer uses `react-textarea-autosize` and queue chips. [Renderer](https://github.com/janhq/jan/blob/main/web-app/src/containers/RenderMarkdown.tsx), [conversation](https://github.com/janhq/jan/blob/main/web-app/src/components/ai-elements/conversation.tsx), [composer](https://github.com/janhq/jan/blob/main/web-app/src/containers/ChatInput.tsx). | A local-first desktop app can adopt existing pieces while retaining its own runtime. Its code notes the importance of stable plugin/component objects and expensive active-code highlighting. **(inference)** Jan’s inspected license is Apache-2.0. [License](https://github.com/janhq/jan/blob/main/LICENSE). |
| **OpenCode** | Additional 2026 agent-UI reference: its MIT UI package includes `marked`, Shiki, KaTeX, Remend, DOMPurify, and morphdom; its actual parser combines `Marked`, custom math syntax, and `marked-shiki`. [UI manifest](https://github.com/anomalyco/opencode/blob/dev/packages/ui/package.json), [parser](https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/context/marked-parser.tsx), [highlighter](https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/context/marked.tsx). | Worth studying for agent-oriented presentation, but its component stack is not a React/shadcn drop-in. **(inference)** |

### ChatGPT, Claude, and T3 Chat

Their public product behavior is useful evidence; their private implementation libraries are not verified here.

- **ChatGPT** documents branching into a separate conversation from a message, and current retry/model controls. The explicit “Branch in new chat” action is distinct from in-thread response versions. [Branch release note](https://help.openai.com/en/articles/6825453-chatgpt-release-notes), [model/retry controls](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes).
- **Codex** explicitly distinguishes Queue—after the current response—from Steer—guidance for current work. Its official field guide recommends Queue as the default. [Queue versus Steer](https://developers.openai.com/blog/mastering-codex-remote-for-engineering).
- **Claude Code** accepts queued input while working, displays pending entries, offers take-back behavior, and can deliver ordinary messages after current tool calls within the same turn. Its semantics therefore do not exactly equal pi’s `followUp`. [Interactive-mode queue behavior](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works).
- **T3 Chat** documents selected-model reasoning effort, including fallback to the model’s default for unsupported values. I did not verify its Markdown, virtualizer, or composer implementation from public first-party source. [Official FAQ](https://t3.chat/faq).

For Jezo, use **edit → preserved alternative branch**, **regenerate → another visible version**, and **version arrows → restore that branch’s continuation**, rather than overwriting messages. Expose queue and steer as separate actions whose labels match pi’s timing. These are recommendations, not claims about every current ChatGPT/Claude client. **(inference)**

## 4. Model selector patterns

| Product | Verified pattern | What to borrow |
|---|---|---|
| **ChatGPT, September 2026** | A composer-adjacent Thinking slider with Instant/Medium/High/Extra High and Pro options depending on access. The published controls have changed during 2026. [Current help](https://help.openai.com/en/articles/20001354-gpt-56-in-chatgpt). | A compact effort control is defensible; avoid hard-coding today’s product labels as universal model capabilities. **(inference)** |
| **Claude** | Selected model and effort appear next to Send. Model menu includes “More models,” an Effort submenu, a recommended/default marker, and a separate thinking setting where supported. Changes apply to the next response. [Current controls](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings). | Keep model identity visible; distinguish model choice from effort; show supported/default levels. **(inference)** |
| **LobeHub** | Current selector combines model and effort, uses Base UI menus, and builds effort controls from supported model parameters. [Selector source](https://github.com/lobehub/lobehub/blob/main/src/features/ChatInput/ActionBar/Model/SelectorMenu.tsx). | Capability-driven controls and a compact model submenu. **(inference)** |
| **T3 Chat** | Model-specific effort with unsupported-value fallback. [FAQ](https://t3.chat/faq). | Preserve the effective value after model changes rather than assuming all providers share levels. **(inference)** |

Jezo already obtains supported thinking levels from pi, resolves the nearest supported configured level, and uses a global main-model choice. Its current chip displays only the thinking label for reasoning models, and its slider implements pointer geometry and keyboard handling manually. [Provider methods](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/providers.ts:332), [ModelChip](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/renderer/src/components/composer/ModelChip.tsx), [frontend decision](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/frontend.md:107).

Recommended polish **(inference)**:

1. Show a human-readable model name plus effort: **“Sonnet · High”**, allowing truncation of the model name.
2. Keep the existing two-stage menu: effort first, searchable models one step further in.
3. Replace manual slider mechanics with **Base UI Slider**; map numeric stops to `thinkingLevels`, preserve the visual treatment, and commit through `providers.setThinking`. Base UI supports steps, marks, labeling, and distinct change/commit callbacks. [Slider API](https://base-ui.com/react/components/slider).
4. Mark the recommended/default level and explain the tradeoff with one short line.
5. Hide the effort control when there is no meaningful choice.
6. Show the effective returned model/level after IPC completes; keep the previous selection visible on failure.
7. Preserve global selection semantics. Moving to per-conversation models is a separate product decision.

AI Elements’ model selector is useful layout material, but its default provider logos load from `models.dev`; replace them with bundled assets before adopting it. [Selector source](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/model-selector.tsx).

## 5. Concrete integration plan

### First fix the projection boundary

Jezo currently has four structural limitations:

- `SessionMessage` has no stable message/entry IDs, branch metadata, attachment model, or detailed run status. [Shared types](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/shared/session.ts).
- `view()` reads **all entries**, while `toMessages()` merges adjacent assistant text and reduces tool calls to name/target/error. Showing all entries will mix abandoned branches once branching exists. [Projection](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:360).
- `Thread` uses array indexes as keys and scrolls to the bottom whenever message count changes; text growth at the same count does not trigger that effect. [Thread](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/renderer/src/plugins/chat/Thread.tsx:18).
- `Composer` refuses submission while running, and its attachment button has no handler. `AgentHost.send()` always starts `run()` and calls `prompt(text)` without a streaming behavior. [Composer](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/renderer/src/components/composer/Composer.tsx:52), [send](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:121).

A kit cannot reconstruct identity, branches, or tool details after the projection has discarded them. **(inference)**

### What the installed pi 0.99.1 actually offers

| Need | Verified API/semantics |
|---|---|
| Normal send | `session.prompt(text, options)`; a streaming call must specify `streamingBehavior`. |
| Steer | `session.steer(text, images?, options?)`; delivered after the current assistant turn’s tool calls, before the next model call. |
| Follow-up | `session.followUp(text, images?, options?)`; delivered after pending tools and steering messages finish. |
| Queue display | `queue_update`, `getSteeringMessages()`, `getFollowUpMessages()`, `pendingMessageCount`. |
| Take back pending input | `clearQueue()` returns steering/follow-up **text arrays**. No per-item removal/reordering appears in the inspected API. |
| Stop | `abort()` aborts active work/retry/compaction/navigation and waits for idle. |
| Final lifecycle | `agent_settled` means automatic continuation has ended; `agent_end` can precede recovery or queued work. |
| Branch/tree | `navigateTree`, `getTree`, `getBranch`, `getEntry`, `getLeafId`; entries carry `id` and `parentId`. |
| Retry state | `auto_retry_start` / `auto_retry_end`, including attempt, delay, and error details. |

Sources: [installed SDK documentation](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md), [installed AgentSession declarations](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts), [SessionManager declarations](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts).

Two subtleties are important:

- Navigating to a **user entry** moves to its parent and returns that user text for editing. It does not leave that user entry as the active context leaf. [Installed implementation](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:3120).
- `SessionManager.branch()` changes an in-memory leaf pointer; reopening rebuilds the pointer from the last appended entry. Merely viewing an older branch is therefore not a durable “selected version” preference. [Installed SessionManager implementation](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js).

### Proposed ownership and files

The following changes are proposed, not implemented. **(inference)**

| Integration point | Proposed responsibility |
|---|---|
| [`src/shared/session.ts`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/shared/session.ts) | Add stable display IDs, underlying entry references, logical turn/version metadata, pending queues, attachments, and explicit run states. Keep existing plugin/card kinds. |
| [`AgentHost.view()` / `toMessages()`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:360) | Project the active branch, retain entry identity, and preserve completed objects across updates. Keep the branch tree separately available for navigation. |
| [`AgentHost.send()` / `run()` / `onEvent()`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:121) | Route idle sends to a new run; route running sends to native steer/follow-up without starting another overlapping `run()`. Publish queue/retry/compaction/settled state. |
| [`bridge.ts`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/shared/bridge.ts), [`ipc.ts`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/ipc.ts), [`preload/index.ts`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/preload/index.ts) | Add explicit delivery mode, edit/resend, retry-turn, branch selection, take-back-queue, and attachment operations. Return acknowledgment separately from run completion. |
| [`store.ts`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/renderer/src/data/store.ts:327) | Keep per-session drafts and restore a rejected send. Avoid clearing the only copy of text before acceptance. |
| [`Thread.tsx`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/renderer/src/plugins/chat/Thread.tsx) | Use stable keys, Streamdown, official `MessageScroller`, action controls, and version navigation. Preserve registered plugin views and folded step summaries. |
| [`Composer.tsx`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/renderer/src/components/composer/Composer.tsx) | Keep shared dictation and IME behavior; allow follow-up/steer submission while running; add attachment chips and pending-input presentation. |
| [`ModelChip.tsx`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/renderer/src/components/composer/ModelChip.tsx) | Keep existing provider IPC, replace slider mechanics, and show model plus effective effort. |
| Workspace-owned session metadata | Persist selected branch/version and recoverable drafts. Reopen queued drafts as unsent input after a crash rather than silently executing them. |
| [`frontend.md`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/frontend.md) and [`backend.md`](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/backend.md) | Record the chosen renderer, scroll policy, branch semantics, queue timing, and undo boundary in the implementation change. |

### Branching, retry, and undo

Recommended semantics **(inference)**:

- **Edit and resend:** navigate to the original user entry without summarizing the abandoned path, submit edited content, and retain the old branch.
- **Retry/regenerate:** replay the original logical user turn into another branch. The inspected `AgentSession` does not expose a simple public `regenerate()` method, so do not invent one or bypass the session lifecycle through low-level agent calls. [Installed public API](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts).
- **Version arrows:** select the corresponding branch continuation, not just swap the text of one bubble. Build UI versions from logical turns while retaining actual pi entry references.
- **Branch selection:** remember the chosen leaf in workspace-owned metadata.
- **Workspace effects:** switching branches changes conversation context; it does not undo files or external actions. Keep Jezo’s undo operation separate and make retrying an agentic turn visibly distinct from merely viewing another response.

For initial queue integration, preserve one undo context for the uninterrupted run and its native queued continuation. If Jezo later wants one undo entry per delivered follow-up, implement that boundary deliberately; do not reset `c.context.run` concurrently while the existing `acting.run()` is still executing. **(inference)** [Current run/undo handling](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:188).

### Queue and steer UX

Recommended first version **(inference)**:

- Enter while idle: send.
- Enter while running: **Queue next message** using `followUp`.
- A visible secondary action and shortcut: **Steer current work**.
- Pending messages appear near the composer, clearly separate from delivered transcript entries.
- Stop remains separately available while a draft exists.
- **Take back queued messages** initially clears the whole native queue and restores drafts.
- Keep full pending payloads in Jezo’s host, including attachments; pi’s `clearQueue()` returns text only.
- Do not display individual cancel/reorder/promote controls until the backend can perform those operations correctly.

### Scroll and long-thread behavior

Adopt `MessageScroller` first, keyed by session and supplied with stable message IDs. Mark delivered user turns as scroll anchors, enable follow-output, and use `defaultScrollPosition="last-anchor"` when reopening a conversation. Pending queue cards should not create transcript anchors. **(inference)** [Headless API](https://github.com/shadcn-ui/ui/blob/main/packages/react/src/message-scroller/README.md).

Avoid multiple scroll owners. Do not wrap the same transcript in both MessageScroller and `use-stick-to-bottom`, or add a token-change `scrollToBottom()` effect alongside either. **(inference)**

If profiling later shows that real-DOM history is too expensive, adopt **virtua** or TanStack Virtual as a dedicated virtualized transcript implementation. Virtua supplies dynamic measurement, prepend/shift support, scroll adjustment, and restoration; it does not by itself implement Jezo’s reading/following policy. [Virtua](https://github.com/inokawa/virtua).

Before virtualization, reduce Jezo’s update cost: its current host rebuilds and broadcasts a full `SessionView` at most every 50ms. Virtualizing the renderer alone will not reduce that projection or IPC work. [Current update path](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:346). Preserve completed-turn identities and update the live tail independently. **(inference)**

### Rendering policy for outside content

Jezo’s existing CSP already limits images to `'self' data:` in both renderer documents. The main window’s new-window handler opens only HTTP(S) externally. [Main renderer CSP](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/renderer/index.html:5), [quick-window CSP](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/renderer/quick.html:5), [external-link handler](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/app.ts:71).

Recommended policy **(inference)**:

- Render user messages as text unless the user intentionally requests a richer format.
- Disable raw HTML in ordinary agent Markdown; use registered plugin cards for rich interactive content.
- Keep sanitization when customizing Streamdown’s plugins.
- Do not automatically load remote images. Render a placeholder with a user-controlled load action if that feature is introduced.
- Resolve workspace links and attachments through a Jezo-owned local resolver.
- Open external links only on user action, with the destination visible; retain a Base UI confirmation surface where outside-derived content warrants it.
- Parse URLs and compare actual protocols/hostnames. Avoid naive prefix checks such as `startsWith("https://trusted.com")`.
- Keep KaTeX’s untrusted-command defaults and Mermaid’s strict rendering policy for outside-derived output. [KaTeX security](https://katex.org/docs/security), [Mermaid plugin](https://streamdown.ai/docs/plugins/mermaid).

Sanitization addresses executable rendering. It does not solve prompt injection into Jezo’s agent; the existing action/exit controls remain a separate layer. **(inference)**

### Order of work and validation

Recommended sequence **(inference)**:

1. **Rendering:** Streamdown, code, math, CJK, horizontal overflow, and copy.
2. **Identity and projection:** stable IDs, active branch, logical turns, explicit status.
3. **Scrolling:** official Base UI MessageScroller; remove the count-based effect.
4. **Running interaction:** follow-up, steer, queue display/take-back, stop, automatic-retry state.
5. **Message actions:** edit/resend, retry-turn, persisted versions and branch navigation.
6. **Details:** richer tool states/output and real attachment handling.
7. **Selector polish:** Base UI slider, model identity, effective capability-driven effort.
8. **Performance:** real long-thread profiling, then virtualization if needed.

Use a real Electron E2E scenario with a long existing thread: scroll upward during streaming, select text, receive a wide table and an unclosed code fence, queue a follow-up with an image, steer during a tool call, stop, retry, edit an earlier turn, switch versions, and reopen the app. Save a repeatable trace plus screenshots and the resulting session/branch evidence. Measure scroll displacement, live-tail update time, and renderer/IPC cost—not merely whether the final answer appears. **(inference)**
