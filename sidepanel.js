import { slugFromUrl, getActiveTab, fetchProblem, readEditor, problemHtmlToText } from "./leetcode.js";
import { streamChat, listModels, pickDefaultModel } from "./gemini.js";
import { LANGS, MODES, systemPrompt, starterSnippet } from "./prompts.js";

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
  settings: { apiKey: "", model: "", level: "beginner", lang: "auto" },
  tabId: null, slug: null, problem: null, problemText: "",
  history: [], hintLevel: 1, editorLang: null, controller: null, loading: false,
};

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
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  if (role === "model") renderMarkdown(el, text);
  else el.textContent = text;
  $("chat").appendChild(el);
  el.scrollIntoView({ block: "end" });
  return el;
}

function renderHistory() {
  $("chat").querySelectorAll(".msg").forEach((m) => m.remove());
  $("welcome").hidden = state.history.length > 0;
  for (const m of state.history) addBubble(m.role, m.role === "user" ? m.label || m.text : m.text);
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
  document.querySelectorAll("#actions button").forEach((b) => (b.disabled = busy));
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

  const saved = await store.get([`chat:${slug}`, `hint:${slug}`]);
  state.history = saved[`chat:${slug}`] || (DEMO ? demo.history : []);
  state.hintLevel = saved[`hint:${slug}`] || 1;

  const ed = DEMO ? demo.editor : await readEditor(tabId);
  state.editorLang = ed && LANGS[ed.lang] ? ed.lang : null;

  renderProblem();
  renderHistory();
  updateHintButton();
  updateLangNote();
}

async function saveChat() {
  await store.set({ [`chat:${state.slug}`]: state.history, [`hint:${state.slug}`]: state.hintLevel });
}

// ---------------- talking to Gemini ----------------
async function send(text, label) {
  if (!state.problem) return showError("Open a LeetCode problem first.");
  if (!state.settings.apiKey) { openSettings(); return; }
  if (state.controller) return;

  state.history.push({ role: "user", text, label });
  addBubble("user", label || text);
  const bubble = addBubble("model", "");
  bubble.classList.add("streaming");
  setBusy(true);
  state.controller = new AbortController();

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
      system: systemPrompt(state.problem, state.problemText, state.settings.level),
      history: state.history.slice(-MAX_HISTORY).map(({ role, text }) => ({ role, text })),
      onText,
      signal: state.controller.signal,
    });
    renderMarkdown(bubble, full);
    state.history.push({ role: "model", text: full });
    await saveChat();
  } catch (e) {
    if (e.name === "AbortError" && latest) {
      const partial = latest + "\n\n> ⏹ *Stopped.*";
      renderMarkdown(bubble, partial);
      state.history.push({ role: "model", text: partial });
      await saveChat();
    } else {
      bubble.remove();
      state.history.pop(); // drop the unanswered question so a retry starts clean
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
      await send(MODES.hint.prompt(n), MODES.hint.label(n));
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
      return send(MODES.review.prompt(langName(ed.lang), ed.code), MODES.review.label);
    }
  }
}

// ---------------- settings ----------------
async function loadSettings() {
  const { settings } = await store.get(["settings"]);
  Object.assign(state.settings, settings || {});
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
  state.settings = { apiKey: key, model: $("s-model").value, level: $("s-level").value, lang: $("s-lang").value };
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
    send(t);
  };
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btn-send").click(); }
  });
  $("btn-stop").onclick = () => state.controller && state.controller.abort();
  $("btn-clear").onclick = async () => {
    if (!state.slug || !confirm("Clear the chat and hints for this problem?")) return;
    state.history = []; state.hintLevel = 1;
    await store.remove([`chat:${state.slug}`, `hint:${state.slug}`]);
    renderHistory(); updateHintButton();
  };
  $("btn-settings").onclick = openSettings;
  $("s-cancel").onclick = () => ($("settings").hidden = true);
  $("s-load").onclick = loadModelList;
  $("s-save").onclick = saveSettings;
  $("lang").onchange = updateLangNote;

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
  renderProblem();
  await refreshProblem();
  if (!state.settings.apiKey && !DEMO) openSettings();
})();
