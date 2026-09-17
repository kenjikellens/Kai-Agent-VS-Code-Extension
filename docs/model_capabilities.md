# Model Capabilities Specificatie (Manifest-Driven)

Dit document beschrijft de werking van **Thinking** en **Reasoning Effort** in Kai Agent. De eigenschappen van LM Studio modellen worden **100% dynamisch** uitgelezen uit LM Studio's manifesten (`model-index-cache.json`).

---

## 1. Cloud AI Providers (API)

| Provider | Model ID | Thinking Opties | Reasoning Opties | Werking |
| :--- | :--- | :--- | :--- | :--- |
| **Google Gemini** | `gemini-3.8-flash`<br>`gemini-3.7-flash`<br>`gemini-3.6-flash`<br>`gemini-3.5-flash`<br>`gemini-3.5-flash-lite`<br>`gemini-3-flash-preview`<br>`gemini-3.1-pro-preview`<br>`gemini-3.1-flash-lite` | `High`, `Medium`, `Low`, `Off` | Geen | Gemini denkbudget niveaus direct instelbaar via geïntegreerd flyout menu. |
| **Mistral AI** | `mistral/magistral-small-latest`<br>`mistral/magistral-medium-latest`<br>`mistral/mistral-small-latest`<br>`mistral/mistral-medium-3-5`<br>`mistral/codestral-latest` | `Thinking: On` / `Thinking: Off` | Geen | Thinking toggle via geïntegreerd flyout menu (`(thinking)`). |
| **Mistral AI** | `mistral/open-mixtral-8x22b` | `off` | Geen | Standaard model zonder thinking. |
| **Cerebras** | `cerebras/llama-3.3-70b`<br>`cerebras/llama-3.1-8b` | `off` | Geen | Standaard snelle inferentie. |
| **Cohere** | `cohere/command-r-plus`<br>`cohere/command-r` | `off` | Geen | Standaard chat/agent modellen. |
| **Zhipu AI** | `zhipu/glm-4-flash`<br>`zhipu/glm-4-plus` | `off` | Geen | Standaard flash modellen. |
| **OmniRoute** | `omniroute/auto` | `off` | Geen | Gateway router model. |

---

## 2. LM Studio (Lokale Modellen via Cache Manifest)

De lijst met lokale modellen en hun capabilities wordt dynamisch geladen uit `model-index-cache.json` (geëxtraheerd in `docs/model_reference.json`):

| Model Identifier | Manifest Veld(en) | Thinking | Reasoning Effort | Payload Parameters |
| :--- | :--- | :--- | :--- | :--- |
| **`qwen/qwen3.8-27b`** | `reasoning_effort` (select)<br>`enable_thinking` (boolean) | Toggle (`enable_thinking`) | `xhigh`, `medium`, `low` | `"reasoning_effort": "{level}"`,<br>`"thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **`google/gemma-4-*`** (`e2b`, `e4b`, `12b-qat`, `31b-qat`) | `enable_thinking` (boolean) | Toggle (`enable_thinking`) | Geen | `"thinking": true`,<br>`"enable_thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **`prism-ml/bonsai-27b`** | Geen | Geen | Geen | Geen thinking parameters |
| **Standaard GGUF modellen** | Geen | Geen | Geen | Geen thinking parameters |

---

## 3. UI Display & Label Contexten (Geen Icons, Zuiver Tekst + Flyouts)

| Context | Gemma (Thinking Aan) | Gemma (Thinking Uit) | Qwen (xhigh) | Gemini (High) | Bonsai / Standaard |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Trigger Knop (Toolbar)** | `Gemma (thinking)` | `Gemma` | `Qwen (xhigh)` | `Gemini 3.7 Flash (High)` | *(geen suffix)* |
| **Dropdown Item (Selector)** | `Gemma` + `›` (Flyout) | `Gemma` + `›` (Flyout) | `Qwen` + `›` (Flyout) | `Gemini 3.7 Flash` + `›` (Flyout) | *(geen flyout chevron)* |
| **Flyout Submenu (Hover)** | `Thinking` [🔘 Toggle Aan] | `Thinking` [⚪ Toggle Uit] | `xhigh` ✓<br>`medium`<br>`low` | `High` ✓<br>`Medium`<br>`Low`<br>`Off` | *(geen flyout)* |
| **Info Modus ('i') - Thinking** | `on` | `off` | `on` | `on` | *(geen info)* |
| **Info Modus ('i') - Reasoning** | *(niet aanwezig)* | *(niet aanwezig)* | `xhigh` | `high` | *(geen info)* |

---

## 4. UI Architectuur & Styling Specificaties

### A. Geconnecteerde Filterlogica (Dynamic Connection Filtering)
- **LM Studio**: Wordt uitsluitend weergegeven in de selector als de lokale server actief is én er minstens 1 model is geladen (`connected && lmStudioModels.length > 0`).
- **Cloud Providers (Gemini, Mistral, Cohere, Cerebras, Zhipu)**: Worden alleen getoond als een geldige API-sleutel is opgeslagen in de instellingen of ontvangen van de host.
- **Empty State**: Als er geen enkele API of lokaal model geconnecteerd is, toont de dropdown een duidelijke placeholder (*"No connected models. Add API key in Settings."*).

### B. Gestandaardiseerde Categorie Headers (`.category-header-btn`)
De categorietitels in de **Model Dropdown**, **Settings** en **Help pagina** zijn 100% uniform:
- **Typografie**: Hoofdletters (`text-transform: uppercase`), `0.78rem`, `font-weight: 600`, `letter-spacing: 0.5px`.
- **Achtergrond**: Volledig transparant (`background: transparent !important`).
- **Padding**: `10px 10px` voor strakke uitlijning.
- **Chevron**: Roterend chevron-icoon dat bij openen/sluiten meedraait (`transform: rotate(-90deg)` bij collapsed).

### C. Vloeiende Pill-naar-Kaart Animatie (250ms Smooth Unroll)
In het instellingenmenu en helpvenster (`.settings-category`):
- **Ingeklapt (`.collapsed`)**: Volledig ronde pil (`border-radius: 22px;`) met ingeklapte inhoud (`max-height: 0; opacity: 0;`).
- **Uitgeklapt**: Afgerond kaartje (`border-radius: 12px;`) met soepel uitrollende inhoud (`max-height: 400px; opacity: 1;`).
- **Transitie**: `250ms cubic-bezier(0.4, 0, 0.2, 1)` zonder flikkeringen of verspringende titels (top-anchored reveal).
- **Meervoudige Selectie**: Categorieën kunnen onafhankelijk van elkaar gelijktijdig geopend zijn (`classList.toggle('collapsed')`).

### D. 1px Grijze Hover Rand
Model- en flyout-knoppen (`.dropdown-item`, `.flyout-option`, `.toggle-switch-row`):
- Hebben standaard een transparante rand en krijgen bij `:hover` een subtiele `1px solid var(--app-border-strong, #444444)` rand zonder achtergrondvlak, met behoud van `border-radius: 4px`.
