import { slugFromUrl, getActiveTab, fetchProblem, readEditor, problemHtmlToText, runTool, describeToolResult } from "./leetcode.js";
import { streamChat, generateJson, listModels, pickDefaultModel, SUBMISSION_TOOLS } from "./gemini.js";
import {
  LANGS, MODES, systemPrompt, starterSnippet,
  practiceSystemPrompt, feedbackSystemPrompt, feedbackPrompt, SCORECARD_SCHEMA,
} from "./prompts.js";
import { DEFAULT_MINUTES, newSession, formatClock, remainingMs, logPrompt, parseScorecard, renderScorecard } from "./practice.js";

// Opening sidepanel.html as a normal page (outside the extension) runs a demo with sample data.
const DEMO = !(globalThis.chrome && chrome.tabs);
const demo = DEMO ? await import("./demo.js") : null;

const $ = (id) => document.getElementById(id);
const MAX_HISTORY = 24; // messages sent back to the model (keeps free-tier token use low)

const store = {
  async get(keys) {
    if (DEMO) return Object.fromEntries(keys.map((k) => [k, JSON.parse(localStorage.getItem(k) || "null")]));
    return chrome.storage.local.get(keys);
  },
  async set(obj) {
    if (DEMO) return Object.entries(obj).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
    return chrome.storage.local.set(obj);
  },
  async remove(keys) {
    if (DEMO) return keys.forEach((k) => localStorage.removeItem(k));
    return chrome.storage.local.remove(keys);
  },
};

const state = {
  settings: { apiKey: "", model: "", level: "beginner", lang: "auto", useSubmissions: true },
  tabId: null, slug: null, problem: null, problemText: "",
  history: [], hintLevel: 1, editorLang: null, controller: null, loading: false,
  view: "tutor", // "tutor" | "practice"
  practice: newSession(),
};

const inPractice = () => state.view === "practice";
const activeHistory = () => (inPractice() ? state.practice.history : state.history);

// ---------------- rendering ----------------
function renderMarkdown(el, text) {
  el.innerHTML = DOMPurify.sanitize(marked.parse(text || ""));
  el.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
  el.querySelectorAll("pre").forEach((pre) => {
    const b = document.createElement("button");
    b.className = "copy"; b.textContent = "Copy";
    b.onclick = () => {
      navigator.clipboard.writeText(pre.querySelector("code")?.innerText ?? pre.innerText);
      b.textContent = "Copied!"; setTimeout(() => (b.textContent = "Copy"), 1200);
    };
    pre.appendChild(b);
  });
}

function addBubble(role, text) {
  $("welcome").hidden = true;
  $("practice-welcome").hidden = true;
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  if (role === "model") renderMarkdown(el, text);
  else el.textContent = text;
  $("chat").appendChild(el);
  el.scrollIntoView({ block: "end" });
  return el;
}

// Small "🔧 ..." line above an answer, one per tool call, so the agent step is visible.
function addToolChip(bubble, text, kind) {
  const chip = document.createElement("div");
  chip.className = `tool-chip ${kind || ""}`;
  chip.textContent = `🔧 ${text}`;
  bubble.before(chip);
  return chip;
}

// Chips sit right before their answer; remove them when that answer fails.
function removeChipsBefore(bubble) {
  while (bubble.previousElementSibling && bubble.previousElementSibling.classList.contains("tool-chip")) {
    bubble.previousElementSibling.remove();
  }
}

function renderHistory() {
  $("chat").querySelectorAll(".msg, .tool-chip").forEach((m) => m.remove());
  const history = activeHistory();
  for (const m of history) {
    const el = addBubble(m.role, m.role === "user" ? m.label || m.text : m.text);
    for (const t of m.tools || []) addToolChip(el, t.text, t.kind);
  }
  if (inPractice()) renderFeedback();
  const empty = !$("chat").querySelector(".msg");
  $("welcome").hidden = inPractice() || !empty;
  $("practice-welcome").hidden = !inPractice() || !empty;
  const last = $("chat").lastElementChild;
  if (state.history.length && last) last.scrollIntoView({ block: "start" });
}

function renderProblem() {
  const p = state.problem;
  $("problem-empty").hidden = !!p || state.loading;
  $("problem-info").hidden = !p;
  if (state.loading && !p) {
    $("problem-empty").hidden = false;
    $("problem-empty").textContent = "Loading problem…";
  }
  if (!p) return;
  $("p-title").textContent = `${p.questionFrontendId ? p.questionFrontendId + ". " : ""}${p.title}`;
  $("p-diff").textContent = p.difficulty || "";
  $("p-diff").className = `diff ${p.difficulty || ""}`;
  $("p-tags").replaceChildren(
    ...(p.topicTags || []).map((t) => Object.assign(document.createElement("span"), { className: "tag", textContent: t.name }))
  );
}

function updateHintButton() {
  $("btn-hint").textContent = state.hintLevel > 4 ? "💡 All hints used" : `💡 Hint ${state.hintLevel}`;
}

function setBusy(busy) {
  document.querySelectorAll("#actions button, .mode-switch button, #pr-finish").forEach((b) => (b.disabled = busy));
  $("btn-send").hidden = busy;
  $("btn-stop").hidden = !busy;
}

function showError(msg) {
  addBubble("error", msg);
}

// ---------------- language ----------------
function fillLangSelect(sel, withAuto) {
  sel.replaceChildren();
  if (withAuto) sel.append(new Option("Auto (match editor)", "auto"));
  for (const [id, name] of Object.entries(LANGS)) sel.append(new Option(name, id));
}

function currentLangId() {
  const v = $("lang").value;
  if (v !== "auto") return v;
  return state.editorLang || (state.settings.lang !== "auto" ? state.settings.lang : "java");
}
const langName = (id) => LANGS[id] || id;

function updateLangNote() {
  $("lang-note").textContent =
    $("lang").value === "auto" ? (state.editorLang ? `editor: ${langName(state.editorLang)}` : "editor not detected, using Java") : "";
}

// ---------------- problem loading ----------------
async function refreshProblem() {
  if (DEMO) {
    if (state.problem) return;
    return loadProblem(null, demo.problem.titleSlug, demo.problem);
  }
  const tab = await getActiveTab();
  const slug = slugFromUrl(tab && tab.url);
  if (!slug) return; // not on a problem page: keep showing the last problem
  if (slug === state.slug) { state.tabId = tab.id; return; }
  await loadProblem(tab.id, slug);
}

async function loadProblem(tabId, slug, preset) {
  if (state.controller) state.controller.abort();
  Object.assign(state, { tabId, slug, problem: null, history: [], loading: true });
  renderProblem();
  renderHistory();

  let res = preset ? { ok: true, q: preset } : null;
  for (let attempt = 0; !res && attempt < 3; attempt++) {
    try { res = await fetchProblem(tabId, slug); } catch (e) { res = null; }
    if (!res || !res.ok) { res = null; await new Promise((r) => setTimeout(r, 1500)); }
  }
  if (slug !== state.slug) return; // user moved on meanwhile
  state.loading = false;
  if (!res) {
    renderProblem();
    $("problem-empty").textContent = "Couldn't read this problem. Reload the LeetCode tab and reopen the panel.";
    return;
  }
  state.problem = res.q;
  state.problemText = problemHtmlToText(res.q.content);

  const saved = await store.get([`chat:${slug}`, `hint:${slug}`, `practice:${slug}`]);
  state.history = saved[`chat:${slug}`] || (DEMO ? demo.history : []);
  state.hintLevel = saved[`hint:${slug}`] || 1;
  state.practice = saved[`practice:${slug}`] || (DEMO ? demo.practice : newSession(DEFAULT_MINUTES));

  const ed = DEMO ? demo.editor : await readEditor(tabId);
  state.editorLang = ed && LANGS[ed.lang] ? ed.lang : null;

  renderProblem();
  renderHistory();
  updateHintButton();
  updateLangNote();
  renderPractice();
}

async function saveChat() {
  await store.set({
    [`chat:${state.slug}`]: state.history,
    [`hint:${state.slug}`]: state.hintLevel,
    [`practice:${state.slug}`]: state.practice,
  });
}

// ---------------- talking to Gemini ----------------
const toolsAllowed = () => !DEMO && state.settings.useSubmissions !== false;

// Runs one tool the model asked for, in the LeetCode tab, and shows its chip.
function makeToolRunner(bubble, chips) {
  return async (name, args) => {
    const chip = addToolChip(bubble, "Checking your LeetCode submissions…", "pending");
    const result = await runTool(state.tabId, state.slug, name, args);
    const entry = { text: describeToolResult(name, result), kind: result.ok ? "" : "warn" };
    chip.textContent = `🔧 ${entry.text}`;
    chip.className = `tool-chip ${entry.kind}`;
    chips.push(entry);
    return result;
  };
}

// useTools: let the model look up the user's past submissions first (agent step).
async function send(text, label, useTools = false) {
  if (!state.problem) return showError("Open a LeetCode problem first.");
  if (!state.settings.apiKey) { openSettings(); return; }
  if (state.controller) return;
  const practice = inPractice();
  if (practice && state.practice.status !== "running") {
    return showError("Press ▶ Start to begin the practice round, then use this chat as your AI assistant.");
  }

  const slug = state.slug;
  const history = activeHistory(); // the mode switch is disabled while a reply streams
  if (practice) logPrompt(state.practice, text, Date.now());
  history.push({ role: "user", text, label });
  addBubble("user", label || text);
  const bubble = addBubble("model", "");
  bubble.classList.add("streaming");
  setBusy(true);
  state.controller = new AbortController();
  const withTools = useTools && toolsAllowed();
  const chips = [];

  let latest = "", queued = false;
  const onText = (t) => {
    latest = t;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const nearBottom = $("chat").scrollHeight - $("chat").scrollTop - $("chat").clientHeight < 80;
      renderMarkdown(bubble, latest);
      if (nearBottom) $("chat").scrollTop = $("chat").scrollHeight;
    });
  };

  try {
    const full = await streamChat({
      apiKey: state.settings.apiKey,
      model: state.settings.model || "gemini-2.5-flash",
      system: practice
        ? practiceSystemPrompt(state.problem, state.problemText, withTools)
        : systemPrompt(state.problem, state.problemText, state.settings.level, withTools),
      history: history.slice(-MAX_HISTORY).map(({ role, text }) => ({ role, text })),
      onText,
      signal: state.controller.signal,
      tools: withTools ? SUBMISSION_TOOLS : null,
      runTool: withTools ? makeToolRunner(bubble, chips) : null,
    });
    renderMarkdown(bubble, full);
    history.push({ role: "model", text: full, tools: chips });
    await saveChat();
  } catch (e) {
    if (slug !== state.slug) return; // the user opened another problem: nothing to show or save here
    if (e.name === "AbortError" && latest) {
      const partial = latest + "\n\n> ⏹ *Stopped.*";
      renderMarkdown(bubble, partial);
      history.push({ role: "model", text: partial, tools: chips });
      await saveChat();
    } else {
      removeChipsBefore(bubble);
      bubble.remove();
      history.pop(); // drop the unanswered question so a retry starts clean
      if (e.name !== "AbortError") showError(e.message || String(e));
    }
  } finally {
    bubble.classList.remove("streaming");
    state.controller = null;
    setBusy(false);
  }
}

async function runMode(mode) {
  const lang = currentLangId();
  switch (mode) {
    case "understand":
    case "logic":
      return send(MODES[mode].prompt(), MODES[mode].label);
    case "hint": {
      if (state.hintLevel > 4) return showError("You've used all 4 hints. Try 🛠 Build logic for the full reasoning.");
      const n = state.hintLevel;
      state.hintLevel++;
      updateHintButton();
      await send(MODES.hint.prompt(n), MODES.hint.label(n), true);
      // Give the hint back if the request failed.
      if (state.history.at(-1)?.role !== "model") { state.hintLevel = n; updateHintButton(); }
      return saveChat();
    }
    case "topics":
      return send(MODES.topics.prompt(langName(lang)), MODES.topics.label);
    case "code":
      return send(MODES.code.prompt(langName(lang), starterSnippet(state.problem, lang)), `${MODES.code.label} (${langName(lang)})`);
    case "review": {
      const ed = DEMO ? demo.editor : await readEditor(state.tabId);
      if (!ed || !ed.code.trim()) {
        return showError("Couldn't read the code editor. Keep the LeetCode tab open with your code in it, or paste your code in the box below and ask \"review this\".");
      }
      if (LANGS[ed.lang]) state.editorLang = ed.lang;
      updateLangNote();
      return send(MODES.review.prompt(langName(ed.lang), ed.code), MODES.review.label, true);
    }
  }
}

// ---------------- practice mode ----------------
function setView(view) {
  state.view = view;
  store.set({ view });
  renderPractice();
  renderHistory();
}

function renderPractice() {
  const p = state.practice;
  $("tutor-controls").hidden = inPractice();
  $("practice-controls").hidden = !inPractice();
  document.querySelectorAll(".mode-switch button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  $("input").placeholder = inPractice()
    ? "Ask your AI assistant… (every prompt is logged)"
    : "Ask a follow-up… (Enter to send, Shift+Enter for new line)";
  $("pr-minutes").value = p.minutes;
  $("pr-minutes").disabled = p.status !== "idle";
  $("pr-start").hidden = p.status !== "idle";
  $("pr-finish").hidden = p.status !== "running";
  $("pr-new").hidden = p.status !== "done";
  updateClock();
}

// Called every second. Shows time left (time used once finished) and a one-line status.
function updateClock() {
  const p = state.practice;
  const ms =
    p.status === "idle" ? p.minutes * 60000
    : p.status === "running" ? remainingMs(p, Date.now())
    : p.endedAt - p.startedAt;
  $("pr-clock").textContent = formatClock(ms);
  $("pr-clock").classList.toggle("low", p.status === "running" && ms < 5 * 60000);
  const prompts = `${p.log.length} prompt${p.log.length === 1 ? "" : "s"} logged`;
  $("pr-status").textContent =
    p.status === "idle" ? "Set a time limit and press Start. The chat becomes your AI assistant."
    : p.status === "running" ? (ms <= 0 ? `Time's up. Finish when ready. ${prompts}.` : `${prompts}. Solve it in the LeetCode editor.`)
    : `Finished: ${formatClock(ms)} used of ${p.minutes}:00. ${prompts}.`;
}

async function startPractice() {
  const minutes = Math.min(120, Math.max(5, Math.round(+$("pr-minutes").value) || DEFAULT_MINUTES));
  state.practice = { ...newSession(minutes), status: "running", startedAt: Date.now() };
  await saveChat();
  renderPractice();
  renderHistory();
  $("input").focus();
}

async function resetPractice() {
  state.practice = newSession(state.practice.minutes);
  await saveChat();
  renderPractice();
  renderHistory();
}

// Latest submission for this problem through the agent tools, so it shows the same chips.
async function latestSubmission(runner) {
  if (!toolsAllowed()) return null;
  const list = await runner("get_my_submissions", { limit: 1 });
  const last = list.ok && list.submissions[0];
  if (!last) return null;
  const details = await runner("get_submission_code", { submission_id: last.id });
  return {
    ...last,
    details: details.ok ? details : null,
    duringSession: Number(last.timestamp) * 1000 >= state.practice.startedAt,
  };
}

async function finishPractice() {
  if (!state.settings.apiKey) return openSettings();
  if (state.controller) return;
  const p = state.practice;
  const slug = state.slug;
  p.status = "done";
  p.endedAt = Date.now();
  renderPractice();

  const bubble = addBubble("model", "Grading your session…");
  bubble.classList.add("streaming");
  setBusy(true);
  state.controller = new AbortController();
  const chips = [];
  try {
    const editor = DEMO ? demo.editor : await readEditor(state.tabId);
    const submission = await latestSubmission(makeToolRunner(bubble, chips));
    const text = await generateJson({
      apiKey: state.settings.apiKey,
      model: state.settings.model || "gemini-2.5-flash",
      system: feedbackSystemPrompt(state.problem, state.problemText),
      prompt: feedbackPrompt({ session: p, usedTime: formatClock(p.endedAt - p.startedAt), editor, submission }),
      schema: SCORECARD_SCHEMA,
      signal: state.controller.signal,
    });
    if (slug !== state.slug) return;
    p.scorecard = parseScorecard(text);
    p.rawFeedback = p.scorecard ? null : text || "(The reply was empty.)";
    p.tools = chips;
    await saveChat();
    renderHistory();
  } catch (e) {
    if (slug !== state.slug) return;
    removeChipsBefore(bubble);
    bubble.remove();
    Object.assign(p, { status: "running", endedAt: null }); // let the user press Finish again
    renderPractice();
    if (e.name !== "AbortError") showError(e.message || String(e));
  } finally {
    bubble.classList.remove("streaming");
    state.controller = null;
    setBusy(false);
  }
}

// The scorecard (or the raw reply, if the JSON couldn't be read) goes after the practice chat.
function renderFeedback() {
  const p = state.practice;
  if (!p.scorecard && !p.rawFeedback) return;
  let el;
  if (p.scorecard) {
    el = renderScorecard(p.scorecard);
    $("chat").appendChild(el);
  } else {
    el = addBubble("model", `> ⚠️ *The feedback didn't come back in the expected format, so here is the raw reply.*\n\n${p.rawFeedback}`);
  }
  for (const t of p.tools || []) addToolChip(el, t.text, t.kind);
  el.scrollIntoView({ block: "start" });
}

// ---------------- settings ----------------
async function loadSettings() {
  const { settings, view } = await store.get(["settings", "view"]);
  Object.assign(state.settings, settings || {});
  if (view === "practice") state.view = view;
}

function setModelOptions(names, selected) {
  const sel = $("s-model");
  sel.replaceChildren(...names.map((n) => new Option(n, n)));
  if (selected && !names.includes(selected)) sel.prepend(new Option(selected, selected));
  sel.value = selected || names[0] || "";
}

function setStatus(msg, kind) {
  $("s-status").textContent = msg;
  $("s-status").className = `small ${kind || ""}`;
}

function openSettings() {
  $("s-key").value = state.settings.apiKey;
  $("s-level").value = state.settings.level;
  $("s-lang").value = state.settings.lang;
  $("s-subs").checked = state.settings.useSubmissions !== false;
  setModelOptions([], state.settings.model || "gemini-2.5-flash");
  setStatus(state.settings.apiKey ? "" : "Add your free Gemini API key to get started.");
  $("settings").hidden = false;
}

async function loadModelList() {
  const key = $("s-key").value.trim();
  if (!key) return setStatus("Paste your API key first.", "err");
  setStatus("Loading models…");
  try {
    const names = await listModels(key);
    const keep = names.includes($("s-model").value) ? $("s-model").value : pickDefaultModel(names);
    setModelOptions(names, keep);
    setStatus(`Key works ✓ (${names.length} models available)`, "ok");
    return true;
  } catch (e) {
    setStatus(e.message, "err");
    return false;
  }
}

async function saveSettings() {
  const key = $("s-key").value.trim();
  if (key && key !== state.settings.apiKey && $("s-model").options.length <= 1) {
    if (!(await loadModelList())) return;
  }
  state.settings = {
    apiKey: key,
    model: $("s-model").value,
    level: $("s-level").value,
    lang: $("s-lang").value,
    useSubmissions: $("s-subs").checked,
  };
  await store.set({ settings: state.settings });
  $("settings").hidden = true;
}

// ---------------- wiring ----------------
function bind() {
  document.querySelectorAll("#actions button").forEach((b) => (b.onclick = () => runMode(b.dataset.mode)));
  $("btn-send").onclick = () => {
    const t = $("input").value.trim();
    if (!t) return;
    $("input").value = "";
    send(t, undefined, true);
  };
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btn-send").click(); }
  });
  $("btn-stop").onclick = () => state.controller && state.controller.abort();
  $("btn-clear").onclick = async () => {
    if (!state.slug) return;
    if (inPractice()) {
      if (confirm("Reset this practice session? The prompt log and feedback will be deleted.")) await resetPractice();
      return;
    }
    if (!confirm("Clear the chat and hints for this problem?")) return;
    state.history = []; state.hintLevel = 1;
    await store.remove([`chat:${state.slug}`, `hint:${state.slug}`]);
    renderHistory(); updateHintButton();
  };
  $("btn-settings").onclick = openSettings;
  $("s-cancel").onclick = () => ($("settings").hidden = true);
  $("s-load").onclick = loadModelList;
  $("s-save").onclick = saveSettings;
  $("lang").onchange = updateLangNote;
  document.querySelectorAll(".mode-switch button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $("pr-start").onclick = startPractice;
  $("pr-finish").onclick = finishPractice;
  $("pr-new").onclick = resetPractice;
  setInterval(() => inPractice() && updateClock(), 1000);

  if (!DEMO) {
    chrome.tabs.onActivated.addListener(() => refreshProblem());
    chrome.tabs.onUpdated.addListener((_id, info, tab) => {
      if (tab.active && (info.url || info.status === "complete")) refreshProblem();
    });
  }
}

(async function init() {
  fillLangSelect($("lang"), true);
  fillLangSelect($("s-lang"), true);
  await loadSettings();
  $("lang").value = state.settings.lang;
  bind();
  renderPractice();
  renderProblem();
  await refreshProblem();
  if (!state.settings.apiKey && !DEMO) openSettings();
})();
