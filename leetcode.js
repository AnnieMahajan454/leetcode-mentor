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

// One GraphQL request with the user's own session. Returns { ok, data } or { ok: false, error }, never throws.
async function pageGraphql(query, variables) {
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
  try {
    const res = await fetch("/graphql/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-csrftoken": csrf },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return { ok: false, error: `LeetCode returned HTTP ${res.status}.` };
    const json = await res.json();
    if (json.errors && json.errors.length) return { ok: false, error: `LeetCode: ${json.errors[0].message}` };
    return { ok: true, data: json.data || {} };
  } catch (e) {
    return { ok: false, error: `Couldn't reach LeetCode (${e.message}).` };
  }
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

// ---------- past submissions (used by the agent tools) ----------
// Each function runs one GraphQL query inside the LeetCode tab, so it sees what the signed-in user sees.
// They all return { ok: true, ... } or { ok: false, error }, and never throw to the UI.

const NOT_SIGNED_IN = "You're not signed in to LeetCode in this tab, so past submissions aren't available.";
const MAX_CODE_CHARS = 4000; // keeps tool results small for the free tier
const STATUS_BY_CODE = {
  10: "Accepted", 11: "Wrong Answer", 12: "Memory Limit Exceeded", 13: "Output Limit Exceeded",
  14: "Time Limit Exceeded", 15: "Runtime Error", 20: "Compile Error",
};

const clamp = (n, lo, hi, fallback) => (Number.isFinite(+n) ? Math.min(hi, Math.max(lo, Math.round(+n))) : fallback);
const toIso = (seconds) => new Date(Number(seconds) * 1000).toISOString();

async function graphql(tabId, query, variables = {}) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: pageGraphql,
      args: [query, variables],
    });
    return (r && r.result) || { ok: false, error: "The LeetCode tab didn't answer." };
  } catch (e) {
    return { ok: false, error: "The LeetCode tab isn't available. Reopen the problem and try again." };
  }
}

export async function getUsername(tabId) {
  const r = await graphql(tabId, "query { userStatus { username isSignedIn } }");
  if (!r.ok) return r;
  const s = r.data.userStatus;
  if (!s || !s.isSignedIn) return { ok: false, error: NOT_SIGNED_IN };
  return { ok: true, username: s.username };
}

export async function getMySubmissionsForProblem(tabId, titleSlug, limit = 5) {
  const user = await getUsername(tabId);
  if (!user.ok) return user;
  const r = await graphql(
    tabId,
    `query ($offset: Int!, $limit: Int!, $questionSlug: String!) {
      questionSubmissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
        submissions { id statusDisplay lang runtime memory timestamp }
      }
    }`,
    { offset: 0, limit: clamp(limit, 1, 20, 5), questionSlug: titleSlug }
  );
  if (!r.ok) return r;
  const list = (r.data.questionSubmissionList && r.data.questionSubmissionList.submissions) || [];
  return { ok: true, titleSlug, submissions: list.map((s) => ({ ...s, submittedAt: toIso(s.timestamp) })) };
}

export async function getSubmissionCode(tabId, submissionId) {
  const id = Number(submissionId);
  if (!Number.isInteger(id)) return { ok: false, error: `"${submissionId}" isn't a valid submission id.` };
  const query = (fields) => `query ($id: Int!) { submissionDetails(submissionId: $id) { ${fields} } }`;
  const basic = "code statusCode runtimeDisplay memoryDisplay timestamp lang { name }";
  // The failing-test fields aren't always in LeetCode's schema, so fall back to the basic fields.
  let r = await graphql(tabId, query(`${basic} lastTestcase expectedOutput codeOutput runtimeError compileError`), { id });
  if (!r.ok) r = await graphql(tabId, query(basic), { id });
  if (!r.ok) return r;
  const d = r.data.submissionDetails;
  if (!d) return { ok: false, error: "That submission wasn't found, or it isn't yours (are you signed in?)." };

  const code = d.code || "";
  const result = {
    ok: true,
    id: String(id),
    statusCode: d.statusCode,
    statusDisplay: STATUS_BY_CODE[d.statusCode] || `Status ${d.statusCode}`,
    lang: d.lang && d.lang.name,
    runtimeDisplay: d.runtimeDisplay,
    memoryDisplay: d.memoryDisplay,
    submittedAt: toIso(d.timestamp),
    code: code.length > MAX_CODE_CHARS ? code.slice(0, MAX_CODE_CHARS) + "\n// …(truncated)" : code,
  };
  // Only keep the failure details that LeetCode actually returned.
  for (const k of ["lastTestcase", "expectedOutput", "codeOutput", "runtimeError", "compileError"]) {
    if (d[k]) result[k] = d[k];
  }
  return result;
}

export async function getRecentAccepted(tabId, username, limit = 10) {
  if (!username) {
    const user = await getUsername(tabId);
    if (!user.ok) return user;
    username = user.username;
  }
  const r = await graphql(
    tabId,
    `query ($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp }
    }`,
    { username, limit: clamp(limit, 1, 20, 10) }
  );
  if (!r.ok) return r;
  const list = r.data.recentAcSubmissionList || [];
  return { ok: true, accepted: list.map((s) => ({ title: s.title, titleSlug: s.titleSlug, solvedAt: toIso(s.timestamp) })) };
}

// ---------- agent tool dispatch ----------
// Names here must match the function declarations in gemini.js.

export async function runTool(tabId, currentSlug, name, args = {}) {
  switch (name) {
    case "get_my_submissions":
      return getMySubmissionsForProblem(tabId, args.title_slug || currentSlug, args.limit);
    case "get_submission_code":
      return getSubmissionCode(tabId, args.submission_id);
    case "get_recent_accepted":
      return getRecentAccepted(tabId, null, args.limit);
    default:
      return { ok: false, error: `Unknown tool "${name}".` };
  }
}

const SHORT_STATUS = { "Time Limit Exceeded": "TLE", "Memory Limit Exceeded": "MLE", "Output Limit Exceeded": "OLE" };

// "3 Wrong Answer, 1 TLE"
function statusCounts(submissions) {
  const counts = {};
  for (const s of submissions) {
    const k = SHORT_STATUS[s.statusDisplay] || s.statusDisplay;
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ");
}

// One-line text for the tool chip shown above an answer.
export function describeToolResult(name, result) {
  if (!result || !result.ok) return `Couldn't check your submissions: ${(result && result.error) || "unknown error"}`;
  switch (name) {
    case "get_my_submissions": {
      const subs = result.submissions;
      if (!subs.length) return "Checked your submissions: none yet for this problem";
      return `Checked your last ${subs.length} submission${subs.length > 1 ? "s" : ""} (${statusCounts(subs)})`;
    }
    case "get_submission_code":
      return `Read your submission #${result.id} (${result.statusDisplay}${result.lang ? `, ${result.lang}` : ""})`;
    case "get_recent_accepted":
      return `Checked your ${result.accepted.length} most recent accepted problems`;
    default:
      return `Ran ${name}`;
  }
}
