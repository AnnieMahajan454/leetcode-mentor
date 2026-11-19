// Everything that talks to the LeetCode tab.
// Functions passed to chrome.scripting.executeScript run *inside* the LeetCode page,
// so requests are same-origin and use your own logged-in session. Nothing leaves your browser
// except the problem text you choose to send to Gemini.

export function slugFromUrl(url) {
  const m = /^https:\/\/leetcode\.(com|cn)\/problems\/([^/?#]+)/.exec(url || "");
  return m ? m[2] : null;
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

// ---------- runs in the page ----------
async function pageFetchProblem(slug) {
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
  const query = `query q($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionFrontendId title titleSlug content difficulty
      topicTags { name slug } hints exampleTestcases
      codeSnippets { lang langSlug code }
    }
  }`;
  try {
    const res = await fetch("/graphql/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-csrftoken": csrf },
      body: JSON.stringify({ query, variables: { titleSlug: slug } }),
    });
    const json = await res.json();
    const q = json && json.data && json.data.question;
    if (q && q.content) return { ok: true, q };
  } catch (e) { /* fall through to DOM scraping */ }

  // Fallback: read the description straight from the page.
  const el =
    document.querySelector('[data-track-load="description_content"]') ||
    document.querySelector('[class*="description"] [class*="content"]');
  if (el) {
    const tags = [...document.querySelectorAll('a[href^="/tag/"]')].map((a) => ({ name: a.textContent.trim() }));
    return {
      ok: true,
      fallback: true,
      q: {
        questionFrontendId: "",
        title: document.title.replace(/\s*-\s*LeetCode.*$/i, ""),
        titleSlug: slug,
        content: el.innerHTML,
        difficulty: "",
        topicTags: tags,
        hints: [],
        codeSnippets: [],
      },
    };
  }
  return { ok: false };
}

function pageReadEditor() {
  const ed = window.monaco && window.monaco.editor;
  if (!ed) return null;
  const pick = (model) => model && { code: model.getValue(), lang: model.getLanguageId() };
  const editors = (ed.getEditors && ed.getEditors()) || [];
  for (const e of editors) {
    const m = e.getModel();
    if (m && m.getLanguageId() !== "plaintext" && m.getValue().trim()) return pick(m);
  }
  const models = ed.getModels().filter((m) => m.getLanguageId() !== "plaintext" && m.getValue().trim());
  models.sort((a, b) => b.getValue().length - a.getValue().length);
  return models.length ? pick(models[0]) : null;
}
// --------------------------------------

export async function fetchProblem(tabId, slug) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: pageFetchProblem,
    args: [slug],
  });
  return r && r.result;
}

export async function readEditor(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: pageReadEditor });
    return (r && r.result) || null;
  } catch (e) {
    return null;
  }
}

// LeetCode's HTML -> readable plain text for the AI (keeps 10^5 style exponents and code blocks).
export function problemHtmlToText(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  doc.querySelectorAll("sup").forEach((s) => s.replaceWith("^" + s.textContent));
  doc.querySelectorAll("sub").forEach((s) => s.replaceWith("_" + s.textContent));
  doc.querySelectorAll("img").forEach((i) => i.replaceWith(i.alt ? `[image: ${i.alt}]` : "[image]"));
  doc.querySelectorAll("li").forEach((li) => li.prepend("- "));
  doc.querySelectorAll("p, li, pre, div, br").forEach((n) => n.append("\n"));
  return doc.body.textContent.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
