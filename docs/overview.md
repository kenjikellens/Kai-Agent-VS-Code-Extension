# KAI Agent - Extension Architectural Overview & System Design

This document details the architecture, component roles, and file-by-file specifications for the **KAI Agent VS Code & Antigravity IDE Extension** (`Kai-Agent-extension/`).

---

## 1. Extension Runtime Architecture

The Extension is hosted inside VS Code / Antigravity IDE and operates across two isolated process boundaries:

```mermaid
graph TD
    subgraph IDE_Extension_Host["Extension Host Process (Node.js / TypeScript)"]
        ext["src/extension.ts"] --> sidebar["src/SidebarProvider.ts"]
        sidebar --> executor["src/AgentExecutor.ts"]
        executor --> providers["src/providers/* (Gemini, OpenRouter, Mistral, etc.)"]
        executor --> tools["src/tools/* (ReadFile, WriteFile, Grep, Terminal, etc.)"]
        executor --> snapshot["src/TurnSnapshotManager.ts"]
    end

    subgraph Webview_Renderer["Webview Panel (HTML / CSS / Vanilla JS)"]
        mainJS["media/main.js"]
        bridge["media/js/WebviewIPCBridge.js (~150 lines)"]
        uiCtrl["media/js/ChatUIController.js"]
        modelDrop["media/js/ModelDropdownController.js"]
        thinkFmt["media/js/ThinkingStateFormatter.js"]
    end

    bridge <-->|"vscode.postMessage() / window.onmessage"| sidebar
```

---

## 2. Dedicated Extension File Roles & Differences vs. Desktop App

| Extension File Path | Primary Role in Extension | Differences & Architectural Boundary vs. Desktop App |
| :--- | :--- | :--- |
| **`code/media/js/WebviewIPCBridge.js`** | **Lean Extension IPC Bridge (~150 lines)**. Forwards UI actions directly to the Extension Host via `this.vscode.postMessage(message)` and dispatches incoming host events. | **NO Fallback Engine**: Does **NOT** contain client-side API fetch loops, SSE stream readers, or browser tool implementations. Unlike the Desktop App (which has ~1400 lines of `_handleClientSideIPC` for standalone browser testing), the Extension delegates 100% of LLM streaming and tool executions to the Extension Host in TypeScript. |
| **`code/media/main.js`** | **Extension Webview UI Controller**. Initializes the single-column webview interface, binds header buttons, and manages panel tabs. | **NO Sidebar Management**: The Extension has **NO Left Sidebar** (no permanent chat history panel or desktop window controls). Navigation is handled exclusively via the compact top Header and Input Card dock. |
| **`code/media/main.css`** | **Extension Webview Stylesheet**. Uses native VS Code CSS variables (`var(--vscode-editor-background)`, `var(--vscode-font-family)`, etc.) for theme integration. | **Scoped Container Styles**: Contains styles tailored for VS Code's narrow sidebar / webview panel layout. Does not contain desktop titlebar drag regions or desktop multi-column grid layouts. |
| **`code/src/SidebarProvider.ts`** | **Extension Webview Host & CSP Provider**. Creates the `vscode.WebviewView`, injects CSP nonces, loads HTML/JS assets, and routes IPC messages between Webview and backend. | **VS Code Specific**: Exists only in the Extension. Replaces Desktop's `AppHost.ts` and `preload.ts`. |
| **`code/src/AgentExecutor.ts`** | **Backend Tool Dispatch & Agent Loop Engine**. Handles iterative agent steps, executes mutating tools with snapshot backups, and streams tokens back to webview. | Operates directly on the local workspace via Node.js `fs` and VS Code Workspace APIs (`vscode.workspace`). |
| **`code/src/providers/*`** | **Dedicated LLM Provider Classes**. Dedicated TypeScript clients (`GeminiClient`, `OpenRouterClient`, `LMStudioClient`, `MistralClient`, `CohereClient`, `CerebrasClient`, `ZhipuClient`, `OmniRouteClient`). | Shares 100% OOP interface parity with Desktop App backend, executing securely in Node.js. |
| **`code/media/js/ThinkingStateFormatter.js`** | **Dynamic Thinking & Reasoning Resolver**. Resolves per-model reasoning options (e.g. `stealth/ox-alpha`, `z-ai/glm-5.2`, `inkling`) and formats Gemini `Minimal` labels. | 100% shared across Extension and Desktop App renderer for consistent model capability rendering. |
| **`code/media/js/ModelDropdownController.js`** | **Model Selector Dropdown Manager**. Manages dropdown accordion, live LM Studio status dots, and cloud provider API key indicators. | Optimized for compact Extension webview dropdown menus without sidebar dependencies. |

---

## 4. CSS Architecture & Strict Prohibition of `!important`
- **Zero `!important` Policy**: The use of `!important` is strictly prohibited across all stylesheets. Proper specificity, object-oriented CSS patterns, and clean cascading rules are required.
- **Single Source of Truth**: All shared tokens must reside in `:root` and theme overrides, with exact single base classes per UI component.

---

## 5. Triple-File Documentation Synchronization Mandate
Whenever architecture, UI components, runtime features, or system design guidelines are modified, all 3 `AGENTS.md` and all 3 `overview.md` files must be updated simultaneously in lockstep:
1. Root workspace: `.agents/AGENTS.md` and `.agents/overview.md`
2. Desktop App: `KAI Agent App/.agents/AGENTS.md` and `KAI Agent App/docs/overview.md`
3. Extension: `Kai-Agent-extension/.agents/AGENTS.md` and `Kai-Agent-extension/docs/overview.md`

4. **Localization Parity**:
   - Maintains 100% dictionary key parity with `AllLocales.js` across all 18 languages.

5. **Universal Icon Buttons & CSS Parity**:
   - All message bubble action buttons (copy, retry, edit, raw toggle, info) strictly utilize the unified `.icon-btn` component class with the hover outset/inset shadow token (`box-shadow: var(--app-btn-inset)`).

6. **Streaming Word Fade-In System (Shared Parity)**:
   - Streaming AI response tokens dynamically wrap newly detected words in `<span class="kai-word-fade">` to fade into view smoothly (`@keyframes kaiWordFadeIn`) without flickering or restarting animation on already-rendered words.
   - Preserves HTML markup, `<pre>`, and `<code>` blocks intact without altering syntax highlighting.

7. **Markdown Formatting & List Hierarchy Engine**:
   - The markdown italic parser strictly enforces CommonMark non-whitespace delimiter rules (`/(?:^|[\s\(\[\{])\*(?!\s)([^\*\r\n]+?)(?<!\s)\*(?=[\s\)\.\,\!\?\]\}]|$)/g`), preventing list bullet markers (`*   ...`) from ever triggering italic blocks.
   - Accurately parses top-level and indented nested sub-bullets (`    *`, `  -`) into hierarchical `<ul class="md-list">` and `<ul class="md-list md-sublist">` trees.

8. **Streaming Lookahead Delay Buffer & Syntax Settle Engine**:
   - `StreamBufferPipeline` queues incoming tokens in a timestamped FIFO buffer with a user-customizable lookahead delay (`--stream-settle-delay`).
   - Enforces a base delay with selectable user increments (`None`, `200ms`, `400ms`, `750ms`, `1000ms`, `1500ms`), allowing markdown markers to settle before DOM formatting.
   - Drains and commits all remaining tokens immediately on stream completion or tool start with zero latency.
   - Double-clicking any user chat bubble activates the inline prompt editor (`openInlineEditor`) to re-edit and resubmit prompts.

9. **LM Studio Performance Telemetry (Tokens Per Second)**:
   - Measures live token generation throughput for local LM Studio models and displays the metric (`Speed: XX.X tok/s`) in the assistant message Info popover.
   - Omitted for external cloud provider APIs to maintain clean metadata.

10. **Reasoning & Thinking Markdown Architecture**:
    - Reasoning output encapsulated in `<think>...</think>` blocks is parsed into rich Markdown (headers, lists, tables, inline code, code blocks, bold, italics, blockquotes) via `MarkdownFormatter.formatThinkingMarkdown()`.
    - Extracted thinking blocks are encapsulated in `%%THINKBLOCK${idx}%%` placeholders during `formatMarkdown()` to prevent cross-delimiter mangling and trailing whitespace accumulation.
    - Live stream diffing updates smoothly via `morphDOM`, scrolling active thinking containers into view while preserving user collapse states and respecting the streaming delay pipeline.

11. **Unified Thinking Accordion Container Architecture**:
    - The thinking reasoning block is unified into a single `.thinking-block` accordion component modeled on `.settings-category`.
    - When collapsed, it renders as a compact pill trigger (`background: transparent; max-width: fit-content; border: 0;`). When expanded, `.thinking-content` displays a bottom border (`border: 0; border-bottom: 1px solid var(--app-border-strong); border-radius: 0; background: transparent; max-width: min(85%, 680px);`) beneath the markdown body.
    - `ThinkingBlockComponent.toggle(header)` encapsulates collapsed state toggling and chevron rotation on the parent container.

12. **Raw Mode Reasoning & Response Separation**:
    - When switching to raw mode via `.toggle-raw-btn`, `MarkdownFormatter.formatRawContent()` parses reasoning traces (`<think>...</think>`) and separates them into a dedicated `.thinking-block.raw-thinking-block` accordion.
    - Preserves the user's active collapsed state across raw mode toggles (`formatRawContent(rawText, wasCollapsed)`).
    - The raw thinking block utilizes `.raw-markdown-pre--thinking` with muted text (`color: var(--app-muted)`), an accent border (`border-left: 3px solid var(--app-accent, #38bdf8)`), and a capped scrollable viewport (`max-height: 220px`). The regular response renders cleanly in `.raw-markdown-pre--response` (`color: var(--app-fg)`).

13. **Application Performance Pipeline & Rendering Optimization**:
    - **Regex Hoisting & In-Memory Settings Cache**: `MarkdownFormatter.js` pre-compiles and hoists static syntax highlighting regexes and maintains an in-memory cache for `localStorage` lookups (`getSettingCached`), eliminating repeated object allocations and synchronous disk reads during token streaming.
    - **RAF Token Scheduling & Layout Thrashing Elimination**: `StreamBufferPipeline.js` commits lookahead token batches on `requestAnimationFrame` ticks. `ChatUIController.js` batches scroll operations in RAF, decoupling DOM writes from scroll height measurements to eliminate forced layout reflows.
    - **Deep State Cloning & Session In-Memory Caching**: Native `structuredClone` in `AppState.deepClone()` accelerates state duplication, and `SessionRepository.js` keeps an in-memory session cache (`_sessionsCache`) to avoid repetitive JSON disk parsing.











