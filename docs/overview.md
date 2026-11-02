# KAI Agent - Master Architectural Blueprint & System Design

This document serves as the master architectural reference and system design guide for the entire **KAI Agent** workspace, detailing component structures, cross-runtime parity, and file-by-file architectural boundaries.

---

## 1. Dual Deployment Ecosystem Overview

The KAI Agent workspace maintains two target runtime implementations sharing core modular principles:

```text
                                  ┌──────────────────────────────────────────────┐
                                  │               KAI Agent System               │
                                  └───────┬──────────────────────────────┬───────┘
                                          │                              │
                   ┌──────────────────────┴────────┐    ┌────────────────┴─────────────────────┐
                   │  VS Code / IDE Extension      │    │  Standalone Desktop Application      │
                   │  (Kai-Agent-extension/)       │    │  (KAI Agent App/)                    │
                   ├───────────────────────────────┤    ├──────────────────────────────────────┤
                   │ • Host: Node.js ExtensionHost │    │ • Main: Electron Process (TS)        │
                   │ • Webview: VS Code Webview    │    │ • Renderer: Electron Window (JS/CSS) │
                   │ • Layout: Compact Header/Dock │    │ • Layout: Left Sidebar + Chat Shell  │
                   │ • IPC: Lean VS Code Bridge    │    │ • IPC: Dual Electron / Preview Engine│
                   │ • Preview: Not Applicable     │    │ • Preview: Python CORS Proxy (run_pc)│
                   └───────────────────────────────┘    └──────────────────────────────────────┘
```

---

## 2. File-by-File Cross-Project Comparison Matrix

| Component / File Path | Extension Role & Implementation | Desktop App Role & Implementation | Architectural Divergence Rationale |
| :--- | :--- | :--- | :--- |
| **`WebviewIPCBridge.js`** | **Lean Bridge (~150 lines)**<br>`code/media/js/WebviewIPCBridge.js`<br>Forwards directly via `this.vscode.postMessage(message)`. | **Dual Bridge & Preview Engine (~1600 lines)**<br>`src/renderer/media/js/WebviewIPCBridge.js`<br>Handles `electronAPI` in Electron and runs `_handleClientSideIPC` + browser tools for `run_pc.py`. | **Boundary Isolation**: Extension runs exclusively via VS Code Extension Host; browser-preview fallback engine is unnecessary dead code in the extension. |
| **`main.js`** | **Webview Orchestrator**<br>`code/media/main.js`<br>Manages header bar, input dock, and panel views. | **Desktop Shell Orchestrator**<br>`src/renderer/media/main.js`<br>Manages Left Sidebar, chat history list, folder selection, and window controls. | **UI Layout**: Desktop App features a permanent left sidebar and multi-chat management; Extension webview uses a compact header/dock layout. |
| **`main.css`** | **Webview Stylesheet**<br>`code/media/main.css`<br>Scoped for VS Code container, uses `var(--vscode-*)` variables. | **Desktop Application Stylesheet**<br>`src/renderer/media/main.css`<br>Full desktop application CSS with custom tokens, sidebar grids, and window chrome. | **Theming**: Extension adheres to VS Code IDE themes; Desktop App owns its standalone design system. |
| **Host / Backend (`SidebarProvider.ts` vs `AppHost.ts`)** | **`code/src/SidebarProvider.ts`**<br>Manages `vscode.WebviewView` lifecycle, CSP headers, and extension message routing. | **`src/main/AppHost.ts` & `preload.ts`**<br>Manages Electron window events, native file pickers, and `ipcMain` channels. | **Runtime Target**: VS Code Webview API vs. Electron Main Process & Preload Context Bridge. |
| **`run_pc.py`** | **Not Present / Not Needed** | **`run_pc.py`**<br>Minimal Python HTTP server & CORS proxy for local browser preview. | **Browser Testing**: Standalone Python preview exists strictly for rapid browser-based desktop UI testing. |
| **`providers/*`** | **`code/src/providers/*`**<br>Dedicated TypeScript classes implementing `ILLMProvider` (`GeminiClient`, `OpenRouterClient`, etc.). | **`src/main/providers/*`**<br>Identical TypeScript provider implementations executing in Electron Main. | **OOP Parity**: 100% interface and logic parity across both backends. |
| **`ThinkingStateFormatter.js`** | **`code/media/js/ThinkingStateFormatter.js`**<br>Dynamic reasoning options resolver for OpenRouter & Gemini `Minimal` labels. | **`src/renderer/media/js/ThinkingStateFormatter.js`**<br>Identical dynamic reasoning state resolver. | **UI State Parity**: Shared model reasoning dictionary and flyout formatting logic. |

---

## 3. Project File Tree & Component Layout

```text
KAI Agent/
│
├── .agents/                               # Master Workspace Customizations & Documentation
│   ├── AGENTS.md                          # Mandatory workspace rules & architectural guidelines
│   └── overview.md                        # Master architectural blueprint and comparison matrix
│
├── docs/                                  # Shared Reference Documentation
│   └── model_reference.json               # Model inference parameters, thinking configs & provider metadata
│
├── Kai-Agent-extension/                   # VS Code / Antigravity IDE Extension
│   ├── .agents/
│   │   └── AGENTS.md                      # Synchronized agent guidelines
│   ├── docs/
│   │   ├── model_capabilities.md          # Provider feature matrices
│   │   └── overview.md                    # Dedicated Extension architectural overview
│   ├── update.bat                         # Fast build & sync script to IDE extension directories
│   └── code/                              # Extension Source Code
│       ├── package.json                   # Extension manifest, commands & settings schema
│       ├── tsconfig.json                  # TypeScript compiler options
│       ├── src/                           # Extension Host Backend (TypeScript)
│       │   ├── extension.ts               # Extension activation & command registrations
│       │   ├── SidebarProvider.ts         # Webview sidebar host, HTML compiler, CSP & IPC bridge
│       │   ├── AgentExecutor.ts           # Tool dispatch pipeline & agent loop orchestration
│       │   ├── TurnSnapshotManager.ts     # In-place file snapshot and turn rollback manager
│       │   ├── providers/                 # Dedicated LLM Client Providers (1-file-per-provider)
│       │   └── tools/                     # Agent Tool Implementations
│       └── media/                         # Webview Frontend Assets
│           ├── main.js                    # Webview entry script (Header & Input Dock layout)
│           ├── main.css                   # Webview CSS styling tokens & components
│           └── js/                        # Modular Frontend OOP Classes
│               ├── WebviewIPCBridge.js    # Lean VS Code IPC Bridge (~150 lines)
│               ├── ChatUIController.js    # Message bubble renderer & view manager
│               ├── ModelDropdownController.js # Model selector dropdown & status dots
│               └── ThinkingStateFormatter.js # Thinking state & dynamic reasoning flyout
│
└── KAI Agent App/                         # Standalone Desktop Application (Electron)
    ├── .agents/
    │   └── AGENTS.md                      # Synchronized agent guidelines
    ├── docs/
    │   └── overview.md                    # Dedicated Desktop App architectural overview
    ├── package.json                       # Electron application manifest & build scripts
    ├── tsconfig.json                      # TypeScript build configuration
    ├── run_pc.py                          # Minimal Python static server & proxy
    └── src/
        ├── main/                          # Electron Main Process (TypeScript)
        │   ├── index.ts                   # Electron app lifecycle & window manager
        │   ├── preload.ts                 # Context bridge & secure IPC exposition
        │   ├── AppHost.ts                 # Backend desktop host dispatcher
        │   ├── AgentExecutor.ts           # Desktop agent tool execution engine
        │   ├── TurnSnapshotManager.ts     # Snapshot & rollback manager
        │   └── providers/                 # Dedicated LLM Client Providers
        └── renderer/                      # Electron Renderer Process (HTML/CSS/JS)
            ├── index.html                 # Desktop app layout shell (Left Sidebar + Chat)
            └── media/                     # Static media, CSS, vendor bundles & frontend modules
                ├── main.js                # Desktop frontend orchestrator (Sidebar + Window controls)
                ├── main.css               # Desktop layout stylesheet & standalone design system
                └── js/                    # Modular OOP classes
                    ├── WebviewIPCBridge.js# Dual Electron & Browser Preview IPC Bridge (~1600 lines)
                    ├── ChatUIController.js# Message bubble renderer & view manager
                    ├── ModelDropdownController.js # Model selector dropdown & status dots
                    └── ThinkingStateFormatter.js # Thinking state & dynamic reasoning flyout
```

---

## 4. Core Subsystems & Operational Contracts

### A. Turn File Snapshots & In-Place Rollback
- Implemented via `TurnSnapshotManager.ts`.
- Automatically captures pre-mutation file snapshots prior to executing mutating tools (`write_file`, `replace_file_content`, `multi_replace_file_content`, `delete_item`).

### B. LM Studio Model Management & Single-Model Rule
- **Max 1 Loaded Model Enforcement**:
  - Prior to dispatching completions to a local model, `LMStudioClient.ensureSingleLoadedModel(model)` verifies loaded models (`lms ps`).
  - Unloads previous models (`lms unload --all`) if a different model is active before loading the target model.

### C. Universal Thinking & Dynamic Reasoning Extraction
- **OpenRouter Reasoning**: Captures `delta.reasoning`, `delta.thought`, and `delta.reasoning_content` into `<think>...</think>` tags. Dynamic reasoning levels (`Max`, `High`, `Medium`, `Low`, `Minimal`, `None`, or Thinking toggle) are enforced per model.
- **Google Gemini Thinking**: Uses `GeminiThinkingConfig.ts` with levels `HIGH`, `MEDIUM`, `LOW`, and `MINIMAL` (labeled `Minimal` instead of `Off` in UI).

### D. Desktop App Theme Architecture & Light Mode Support
- Standalone theme switcher in Desktop Settings (`SettingsController.js`) supporting **Dark**, **Light**, and **System** (OS auto-detection via `prefers-color-scheme`).
- Instant theme initialization on startup in `main.js` and live theme switching without page reload.
- Full parity across 18 languages in `AllLocales.js` and theme-aware Mermaid diagram re-rendering in `MermaidRenderer.js`.

### E. CSS Architecture & Strict Prohibition of `!important`
- **Zero `!important` Policy**: The use of `!important` is strictly prohibited across all stylesheets. Proper specificity, object-oriented CSS patterns, and clean cascading rules are required.
- **Single Source of Truth**: All shared tokens must reside in `:root` and theme overrides, with exact single base classes per UI component.

### F. Triple-File Documentation Synchronization Mandate
Whenever architecture, UI components, runtime features, or system design guidelines are modified, all 3 `AGENTS.md` and all 3 `overview.md` files must be updated simultaneously in lockstep:
1. Root workspace: `.agents/AGENTS.md` and `.agents/overview.md`
2. Desktop App: `KAI Agent App/.agents/AGENTS.md` and `KAI Agent App/docs/overview.md`
3. Extension: `Kai-Agent-extension/.agents/AGENTS.md` and `Kai-Agent-extension/docs/overview.md`

### G. Instant Sidebar Chat Registration, JSON Title Generation & Universal Icon Buttons
- **Instant Sidebar Session Addition**: On user prompt dispatch, chat records are immediately created and rendered in the Left Sidebar with prompt-derived preview fallback, eliminating turn completion lag.
- **JSON-Format AI Title Generation & Multi-Stage Parser**: AI title generation requests structured JSON (`{"title": "..."}`) with a 150-token budget and a multi-stage extraction pipeline (ignoring `<think>...</think>` traces, codeblocks, and commentary from smaller or thinking-enabled models).
- **Universal Icon Buttons**: All message bubble action buttons (copy, retry, edit, raw toggle, info) strictly utilize the unified `.icon-btn` component class with the hover outset/inset shadow token (`box-shadow: var(--app-btn-inset)`).

### H. Staggered History Zoom-In & AI Stream Word Fade-In System
- **Staggered History Item Entrance (Desktop App Only)**: The Left Sidebar chat history items load smoothly with top-to-bottom entrance animations (`@keyframes historyItemZoomIn` scaling from `0.92` to `1.0` and opacity `0` to `1`), timed via `--anim-delay: ${index * 50}ms`. In-place element diffing prevents re-render glitching when history syncs.
- **Streaming Word Fade-In (Desktop App & Extension)**: During active token streaming in `ChatUIController`, incoming words are dynamically wrapped in `<span class="kai-word-fade">` to fade into view smoothly (`@keyframes kaiWordFadeIn`) without flickering or restarting animation on already-rendered words. Markdown syntax, tags, and codeblocks are preserved intact, and HTML is cleanly finalized upon completion.

### I. Markdown Formatting & List Hierarchy Engine
- **Flanking Delimiter Italic Isolation**: The markdown italic parser strictly enforces CommonMark non-whitespace delimiter rules (`/(?:^|[\s\(\[\{])\*(?!\s)([^\*\r\n]+?)(?<!\s)\*(?=[\s\)\.\,\!\?\]\}]|$)/g`), preventing list bullet markers (`*   ...`) from ever triggering italic blocks.
- **Hierarchical List Grouping**: Supports top-level (`*`, `-`) and indented nested sub-bullets (`    *`, `  -`), compiling them into structured `<ul class="md-list">` and `<ul class="md-list md-sublist">` trees.

### J. Streaming Lookahead Delay Buffer & Syntax Settle Engine
- **Settle Delay Queue (`StreamBufferPipeline.js`)**: Buffers incoming tokens in a timestamped FIFO queue (base 300ms delay, `--stream-settle-base-delay`), allowing markdown markers (`**...**`, `---`, `###`) to settle and eliminating layout jumps. Applies uniformly to thinking and assistant response tokens.
- **Immediate End-of-Stream Flush**: Drains and commits all remaining tokens on turn completion or tool start with zero latency.
- **Double-Click User Bubble Edit**: Double-clicking any user chat bubble activates the inline prompt editor (`openInlineEditor`), matching the edit button functionality.

### K. Reasoning & Thinking Markdown Architecture
- **Rich Thinking Markdown Rendering**: Reasoning output encapsulated in `<think>...</think>` blocks is parsed into rich Markdown (headers, lists, tables, inline code, code blocks, bold, italics, blockquotes) via `MarkdownFormatter.formatThinkingMarkdown()`.
- **Placeholder Isolation**: Extracted thinking blocks are encapsulated in `%%THINKBLOCK${idx}%%` placeholders during `formatMarkdown()` to prevent cross-delimiter mangling.
- **Live Stream Diffing & Auto-Scroll**: Streaming thinking content updates smoothly via `morphDOM`, scrolling active thinking containers into view while preserving user collapse states.

### L. Unified Thinking Accordion Container Architecture
- **Enclosed Card Component Pattern**: The thinking reasoning block is unified into a single `.thinking-block` accordion component modeled on `.settings-category`.
- **Cohesive State Styling**: When collapsed, it renders as a compact pill trigger (`background: transparent; max-width: fit-content; border: 0;`). When expanded, `.thinking-content` spans the full chat width (`width: 100%; max-width: 100%;`) with a bottom border (`border: 0; border-bottom: 1px solid var(--app-border-strong); border-radius: 0; background: transparent;`) and symmetric padding.
- **Component State Management**: `ThinkingBlockComponent.toggle(header)` encapsulates collapsed state toggling and chevron rotation on the parent container.

### M. Raw Mode Reasoning & Response Separation
- **Plaintext Demarcation**: When switching to raw mode via `.toggle-raw-btn`, `MarkdownFormatter.formatRawContent()` parses reasoning traces (`<think>...</think>`) and separates them into a dedicated `.thinking-block.raw-thinking-block` accordion.
- **State Preservation**: The user's active collapsed state is preserved across mode switches (`formatRawContent(rawText, wasCollapsed)`).
- **OOCSS Modifiers**: The raw thinking block utilizes `.raw-markdown-pre--thinking` with muted text (`color: var(--app-muted)`), an accent border (`border-left: 3px solid var(--app-accent, #38bdf8)`), and a capped scrollable viewport (`max-height: 220px`). The regular response renders cleanly in `.raw-markdown-pre--response` (`color: var(--app-fg)`).

### N. Application Performance Pipeline & Rendering Optimization
- **Regex Hoisting & Static Token Compilation**: `MarkdownFormatter.js` hoists syntax highlighting regular expressions (`KW_REGEX`, `BOOLEAN_REGEX`, `NUMBER_REGEX`, etc.) to static constants, eliminating repeated compilation and array allocation on every streaming chunk.
- **In-Memory Settings Caching**: `MarkdownFormatter.js` and `SettingsController.js` maintain an in-memory cache for `localStorage` lookups (`kai.enableSyntaxHighlighting`, `kai.codeBlockTheme`), synchronized via `storage` event listeners, eliminating synchronous disk reads on every token.
- **RAF Token Scheduling & Layout Thrashing Elimination**: `StreamBufferPipeline.js` schedules lookahead token commits via `requestAnimationFrame`, synchronizing rendering directly with V-Sync. `ChatUIController.js` batches scroll operations in RAF, decoupling layout dimension queries from DOM mutations to eliminate forced synchronous reflows.
- **Deep State Cloning & Repository In-Memory Caching**: `AppState.js` utilizes `structuredClone` with fallback in `AppState.deepClone()`. `SessionRepository.js` maintains an in-memory session cache (`_sessionsCache`), serving session queries instantly without JSON disk parsing.
- **Central Event Delegation & Static Fast-Path Preview**: `HistoryManager.js` uses centralized event delegation on `this.historyList` to manage click and delete actions, eliminating per-item event listeners. `preview_server.js` restricts dynamic module cache invalidation exclusively to `/api/*` requests, serving static assets with zero require overhead.

### O. Workspace Mode Gating & No-Workspace Ask Mode Enforcement
- **Mode Menu Gating**: When no workspace folder is active (`hasActiveWorkspace === false`), the mode dropdown selector container (`#context-options-dropdown-container`) is strictly hidden via `.hidden` (`display: none`).
- **Lock to Ask Mode**: With no workspace active, operational mode is locked to `ask` (`activeMode = 'ask'`), ensuring safe, read-only conversational interactions with utility, web search, and user clarification tools without workspace code mutation.
- **Workspace State Sync**: `WorkspaceManager` starts with an empty directory (`''`) instead of auto-binding `process.cwd()`, and chat sessions synchronize workspace presence bidirectionally with the backend and local storage via the `setWorkspace` IPC message.

### P. Interactive Prompt Options Card Architecture (Claude Code Parity)
- **Standalone Card Elevation & Docking**: The interactive clarification prompt (`#ask-user-dock`) is mounted directly above `.input-card` within `.input-panel`, eliminating nested borders and textarea focus outline bleed while creating a dedicated elevated card styled with standardized tokens (`var(--app-input-bg)`, `var(--app-input-border)`).
- **Vertical Numbered Options**: Options are presented as full-width interactive rows (`.ask-option-item`) with subtle dividers, numbered rounded badges (`1`..`9`), and hover states.
- **Single Unified Input & Natural Conversational Flow**: Redundant inner custom input fields are eliminated in favor of using `#message-input` as the single unified input with dynamic placeholder (`askUserCustomPlaceholder`), while the dock footer cleanly retains the right-aligned skip button (`.ask-skip-btn`).
- **Zero Technical Tool Rows**: `ask_user` never renders a technical `.tool-status-row` or wrench icon in the chat. The question is rendered directly as authentic Assistant message text with a subtle activity loader (`asking a question...`) while awaiting user response.
- **Natural Message Bubbles**: Choosing an option or typing a response immediately appends an authentic `.user-message-bubble`, while dismissing appends `"User did not answer"`. Full intermediate turns are preserved in `appState.messages` and `fullHistory` for seamless multi-turn retry and edit rollback.
- **Keyboard Navigation & i18n Parity**: Number keys (`1`..`9`) trigger choices immediately, `Escape` dismisses the prompt, and `Enter` in the main message input submits custom responses. Full parity maintained across 18 languages in `AllLocales.js`.

### Q. Direct Tool Invocation & Interactive Prompt Protocol
- **Immediate Tool Execution Mandate**: In all system prompt variants (`ask`, `agent`, `planning`, `chat`), models are strictly instructed to emit tool calls directly within `<|tool_call|>` without conversational preambles ("Let me check...", "I will inspect..."), eliminating hesitation and narrative filler.
- **Interactive Question & Multiple-Choice Mandate (`ask_user`)**: Whenever presenting the user with multiple choices, preset answers, or running interactive flows (games like Akinator, quizzes, branching decisions, or task selection), models are mandated to invoke `ask_user` with structured options instead of dumping plain text markdown lists. Simple direct answers and greetings reply in plain text without `ask_user`.
- **Mode Separation Contracts**:
  - **Ask Mode**: Authoritative, read-only code intelligence and external documentation lookup. File modification is strictly barred.
  - **Planning Mode**: Two-phase architecture. Phase 1 conducts read-only research and outputs `<implementation_plan title="...">` with proposed diffs and verification steps; zero code modifications are permitted before explicit user approval.
  - **Agent Mode**: Autonomous execution, root-cause investigation, and surgical diff editing (`replace_file_content` / `multi_replace_file_content` for existing files, `write_file` for new files).
