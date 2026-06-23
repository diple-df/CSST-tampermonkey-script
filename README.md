# Custom Search System Tabs (CSST)

> A Tampermonkey userscript for customizing the search tab bar in Google, Yandex, Bing, and DuckDuckGo.  
> Hide unwanted tabs, rename them, redirect them to other services, and add your own custom buttons — all right inside the search engine's navigation bar.
>
> **Author:** diple_df x claude

---
<img width="1464" height="1003" alt="demonstration" src="https://github.com/user-attachments/assets/69efd48d-b115-43b8-ac1d-ee034f411e82" />
<img width="1920" height="1040" alt="image" src="https://github.com/user-attachments/assets/3f7ddf48-92a2-4c2a-9136-fb44f3472d7e" />



## Installation

### Step 1 — Install a Userscript Manager

The script requires a browser extension to run. Supported managers:

| Extension | Chrome | Firefox | Edge |
|---|---|---|---|
| **Tampermonkey** (recommended) | ✓ | ✓ | ✓ |
| Violentmonkey | ✓ | ✓ | ✓ |
| Greasemonkey | — | ✓ | — |

Install the extension from your browser's official add-on store.

### Step 2 — Install the Script

**Option A — via GitHub Raw link (easiest):**

1. Open `csst_tmprmnk.js` on GitHub
2. Click the **Raw** button
3. Tampermonkey will automatically detect the script and prompt you to install it
4. Click **Install**

**Option B — manually:**

1. Copy the contents of `csst_tmprmnk.js`
2. Open Tampermonkey → **Create a new script**
3. Paste the code and press **Save** (`Ctrl+S`)

### Step 3 — Open Any Supported Search Engine

Go to `google.com`, `yandex.com`, `bing.com`, or `duckduckgo.com`, type any query — a settings button (≡) will appear in the tab bar.

---

## Supported Search Engines

| Search Engine | Domains | Accent Color |
|---|---|---|
| **Google** | `google.com`, `google.co.uk`, `google.ru` and all other regional domains | Blue `#4285f4` |
| **Yandex** | `yandex.ru`, `yandex.com`, `yandex.by`, `yandex.kz`, `ya.ru` | Red `#fc3f1d` |
| **Bing** | `bing.com` | Teal `#008373` |
| **DuckDuckGo** | `duckduckgo.com` | Orange `#de5833` |

Settings are stored **separately per search engine** — changes in Google do not affect Yandex.


## Features

### Hide a Tab

Any standard search tab can be completely removed from the navigation bar. The script hides both the link itself and its wrapper element (`<li>`, `<div>`) so no empty gaps are left behind.

Tabs hidden by the search engine itself are never touched — only tabs that the script itself has hidden will be revealed when you unhide them.

### Rename a Tab

You can set any label for any tab. The change is applied instantly in the tab bar without a page reload. Clearing the label field restores the search engine's original text.

### Redirect a Tab to Another Service

Instead of opening the engine's own section, a tab can take you to any other website. For example:

- **Videos** tab on DuckDuckGo → opens **YouTube** with the same query
- **Images** tab on Yandex → opens **Google Images**
- **Maps** tab on Google → opens **OpenStreetMap**

Use `{query}` in the redirect URL — the script will automatically insert the current search query.

### Add Custom Buttons

Beyond the standard tabs, you can add any number of your own buttons directly to the search engine's navigation bar. Custom buttons support `{query}` and are styled to match the native tabs.

Usage examples:
- Button "GitHub" → `https://github.com/search?q={query}`
- Button "Amazon" → `https://www.amazon.com/s?k={query}`
- Button "Translate" → `https://translate.google.com/?text={query}&sl=auto&tl=en`


## How to Use

1. Open any supported search engine and type a query
2. Look for the **≡** button (three horizontal lines) in the navigation tab bar — it's injected by the script
3. Click it — a settings side panel will slide in from the right
4. In the **Standard tabs** section, configure each tab:
   - Toggle the **Hide** switch to remove a tab from the bar
   - Edit the **Label** field to rename the tab
   - Pick a preset service from the dropdown, or manually enter a **Redirect URL**
5. In the **Custom buttons** section, click **+ Add button** to insert your own link
6. Changes are applied instantly; close the panel with **×** or by clicking the backdrop
7. The **Reset** button restores all settings to their defaults

> If the **≡** button does not appear in the tab bar, open the settings via the Tampermonkey extension menu → script → **⚙ Customize search tabs**.

---

## The {query} Placeholder

Any URL in redirect fields or custom buttons can contain `{query}` — the script will replace it with the current search query, URL-encoded.

**Examples:**

```
https://www.youtube.com/results?search_query={query}
https://github.com/search?q={query}&type=repositories
https://www.amazon.com/s?k={query}
https://translate.google.com/?text={query}&sl=auto&tl=en
```

For a query like `funny cats`, the URL `https://www.youtube.com/results?search_query={query}` becomes `https://www.youtube.com/results?search_query=funny%20cats`.

---


## Supported UI Languages

The settings panel switches language automatically based on the search engine page's `lang` attribute:

| Code | Language |
|---|---|
| `en` | English |
| `ru` | Russian |
| `uk` | Ukrainian |
| `de` | German |
| `fr` | French |
| `es` | Spanish |
| `pt` | Portuguese |
| `tr` | Turkish |
| `it` | Italian |
| `pl` | Polish |

---

## Technical Details

### Granted Permissions

The script requests a minimal set of permissions:

| Permission | Purpose |
|---|---|
| `GM_getValue` | Reading saved settings |
| `GM_setValue` | Saving settings |
| `GM_addStyle` | Injecting panel styles |
| `GM_registerMenuCommand` | Fallback entry point via the Tampermonkey menu |

The script **does not send any data** to external services.


### Script Versions

| File | Script Name | Version | Status |
|---|---|---|---|
| `csst_tmprmnk.js` | Custom Search System Tabs | 1.0.0 | Current |
| `ddg-tab-customizer.js` | DuckDuckGo Tab Customizer | 1.2.0 | Legacy |

---
