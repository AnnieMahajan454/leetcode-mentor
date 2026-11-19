# LeetCode Mentor

A free Chrome extension that opens a side panel next to any LeetCode problem and teaches you how to solve it, in plain language, with the **why** behind every step.

| Button | What you get |
|---|---|
| 🧠 **Understand** | The problem in plain words, a walkthrough of Example 1, easy-to-miss rules, edge cases, and what the constraints say about the complexity you can afford. No spoilers. |
| 💡 **Hint 1 → 4** | One nudge at a time: observation → key insight → state/data structure → algorithm outline. |
| 🛠 **Build logic** | Brute force → why it's too slow → key observation → optimized approach, with the reason behind every decision, plus a dry-run table and complexity. |
| 📚 **Topics & traps** | Every concept used, explained from scratch, with a template, how to recognize it, **common interview traps**, and related practice problems. |
| 💻 **Write code** | A solution in your language using LeetCode's exact signature, a line-by-line explanation of why, traps in the code, and a short script for explaining it in an interview. |
| 🔍 **Review my code** | Reads the code in your LeetCode editor, gives a verdict, finds bugs, shows a failing input (expected vs actual) and suggests the minimal fix. |
| 💬 **Follow-up box** | Ask anything, e.g. "why do we cast to long here?". It remembers the conversation for each problem. |

Everything is free. It uses Google Gemini's free tier, which needs your own key (no credit card), and there's no server to deploy.

---

## 1. Get a free Gemini API key (1 minute)
1. Go to **https://aistudio.google.com/apikey** and sign in with a Google account.
2. Click **Create API key** and copy it.

## 2. Install the extension (free)
1. Unzip `leetcode-mentor.zip` somewhere permanent (e.g. `Documents/leetcode-mentor`).
2. Open **chrome://extensions** in Chrome (it also works in Edge and Brave).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped `leetcode-mentor` folder.
5. Pin the orange **M** icon from the puzzle-piece menu.

## 3. Use it
1. Open any problem, e.g. `https://leetcode.com/problems/two-sum/`.
2. Click the **M** icon (or press **Alt+M**) to open the side panel.
3. The first time, paste your API key in Settings, click **Load models**, then **Save**.
4. Click any button. Answers stream in live, and chats and hint progress are saved per problem.

Tips:
- Set **Explanation level** to *Beginner* for from-zero explanations, or *Interview prep* for crisp answers.
- The **Language** dropdown defaults to whatever language your LeetCode editor is set to.
- If you hit "rate limit reached", wait a minute or pick a `flash-lite` model in Settings.

---

## How it connects to LeetCode
LeetCode has no official API. The extension runs a small script **inside your open LeetCode tab** that:
- fetches the problem (statement, difficulty, tags, official hints, starter code) from LeetCode's own GraphQL endpoint using your normal logged-in session, falling back to reading the page if that fails;
- reads your code from the editor, only when you click **Review my code**.

Nothing is sent anywhere except to Gemini: the problem text, your questions, and your code when you ask for a review.
**Privacy note:** on Gemini's free tier, Google may use prompts to improve its models, so don't paste anything confidential.

## Sharing it with others (free options)
- **GitHub** (free): push this folder to a public repo. Others download the ZIP and use *Load unpacked*.
- **Microsoft Edge Add-ons store** (free to publish): https://partner.microsoft.com/dashboard/microsoftedge. Edge users can then install it in one click.
- *Chrome Web Store* charges a one-time **$5** developer fee, so it isn't free.

Each user adds their own free Gemini key. Never commit a key to GitHub.

## Customize
- **`prompts.js`** controls how the mentor teaches. Edit the section structure, tone or level descriptions.
- `gemini.js`: the API client (streaming, model list, error messages).
- `leetcode.js`: problem fetching and editor reading.
- Open `sidepanel.html` through any local web server (e.g. `python -m http.server`) to preview the UI with demo data.

## Files
```
manifest.json     extension config (Manifest V3)
background.js     opens the side panel on icon click
sidepanel.*       the UI
prompts.js        teaching prompts for each mode
gemini.js         Gemini API client
leetcode.js       reads problem + editor from the LeetCode tab
demo.js           sample data for UI preview only
lib/              marked (Markdown) + DOMPurify (sanitizing), bundled locally
```
