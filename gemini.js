// Minimal Gemini client (free tier key from https://aistudio.google.com/apikey).
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_TOOL_ROUNDS = 3; // the agent may call tools at most 3 times before it must answer

// Tools the model may call. The side panel runs them in the LeetCode tab (runTool in leetcode.js).
export const SUBMISSION_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "get_my_submissions",
        description:
          "List the student's most recent LeetCode submissions for a problem, newest first: status (Accepted, Wrong Answer, " +
          "Time Limit Exceeded, ...), language, runtime, memory and when it was submitted. Call this before a hint, a code " +
          "review or feedback to see what the student has already tried.",
        parameters: {
          type: "OBJECT",
          properties: {
            title_slug: { type: "STRING", description: "Problem slug such as 'two-sum'. Leave out for the current problem." },
            limit: { type: "INTEGER", description: "How many submissions to return, 1-20. Default 5." },
          },
        },
      },
      {
        name: "get_submission_code",
        description:
          "Get one of the student's submissions by id: the code, the judge status, runtime and, for failed attempts, the " +
          "failing test input, the expected output and the student's output. Use it to see exactly why an attempt failed.",
        parameters: {
          type: "OBJECT",
          properties: { submission_id: { type: "STRING", description: "A submission id returned by get_my_submissions." } },
          required: ["submission_id"],
        },
      },
      {
        name: "get_recent_accepted",
        description:
          "List problems the student solved recently (accepted submissions), newest first. Use it to link this problem to " +
          "patterns the student already knows.",
        parameters: {
          type: "OBJECT",
          properties: { limit: { type: "INTEGER", description: "How many problems to return, 1-20. Default 10." } },
        },
      },
    ],
  },
];

function friendlyError(status, message) {
  if (status === 429) return "Free-tier rate limit reached. Wait a minute and try again (daily limits reset at midnight Pacific time), or switch to a Flash-Lite model in Settings.";
  if (status === 400 && /api key/i.test(message)) return "Your Gemini API key looks invalid. Check it in Settings.";
  if (status === 403) return "This API key can't use that model. Pick another model in Settings.";
  if (status === 404) return "That model isn't available any more. Click 'Load models' in Settings and pick a current one.";
  return message || `Gemini request failed (HTTP ${status}).`;
}

// POST to a model method. Throws a readable Error on HTTP errors.
async function callModel({ apiKey, model, method, body, signal }) {
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:${method}`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(friendlyError(res.status, json.error && json.error.message));
  }
  return res;
}

export async function listModels(apiKey) {
  const res = await fetch(`${BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": apiKey } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError(res.status, json.error && json.error.message));
  const skip = /(embed|image|tts|audio|live|vision|aqa|learnlm|robotics|computer|veo|imagen|lyria)/i;
  return (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => n.startsWith("gemini") && !skip.test(n));
}

// Best default for a free key: the newest plain "flash" model, else newest flash-lite, else first.
export function pickDefaultModel(names) {
  const ver = (n) => parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(n) || [0, 0])[1]);
  const byNewest = (a, b) => ver(b) - ver(a);
  const stable = names.filter((n) => !/(preview|exp|\d{3,})/.test(n));
  const flash = stable.filter((n) => /-flash$/.test(n)).sort(byNewest);
  const lite = stable.filter((n) => /-flash-lite$/.test(n)).sort(byNewest);
  return flash[0] || lite[0] || names[0] || "gemini-2.5-flash";
}

// One streamed model turn. Text is passed to onText as it arrives; function calls are collected.
async function streamTurn({ apiKey, model, body, onText, signal }) {
  const res = await callModel({ apiKey, model, method: "streamGenerateContent?alt=sse", body, signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const turn = { text: "", parts: [], calls: [], finish: "" };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      let evt;
      try { evt = JSON.parse(line.slice(5)); } catch { continue; }
      const cand = evt.candidates && evt.candidates[0];
      if (!cand) continue;
      if (cand.finishReason) turn.finish = cand.finishReason;
      for (const p of (cand.content && cand.content.parts) || []) {
        turn.parts.push(p); // kept as-is (including thought signatures) to send back after tool calls
        if (p.functionCall) turn.calls.push(p.functionCall);
        else if (p.text && !p.thought) {
          turn.text += p.text;
          onText(turn.text);
        }
      }
    }
  }
  return turn;
}

/**
 * Streams a reply. history: [{role: "user"|"model", text}]
 * onText(fullTextSoFar) is called as chunks arrive. Returns the full text.
 *
 * Agent loop: when `tools` and `runTool` are given, the model may answer with function calls instead of text.
 * We run each call with runTool(name, args), send the results back as functionResponse parts and ask again,
 * up to MAX_TOOL_ROUNDS times. After that tools are switched off so the model must answer.
 * Without tools, or if the model calls none, this is a single streamed request.
 */
export async function streamChat({ apiKey, model, system, history, onText, signal, tools, runTool }) {
  const contents = history.map((h) => ({ role: h.role, parts: [{ text: h.text }] }));
  const useTools = !!(tools && runTool);

  for (let round = 0; ; round++) {
    const canCall = useTools && round < MAX_TOOL_ROUNDS;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    };
    if (useTools) {
      body.tools = tools;
      body.toolConfig = { functionCallingConfig: { mode: canCall ? "AUTO" : "NONE" } };
    }
    const turn = await streamTurn({ apiKey, model, body, onText, signal });
    if (!turn.calls.length || !canCall) return finishReply(turn, onText);

    // Agent step: run every requested tool, then give the results back to the model.
    contents.push({ role: "model", parts: turn.parts });
    const responses = [];
    for (const call of turn.calls) {
      const response = await runTool(call.name, call.args || {});
      responses.push({ functionResponse: { ...(call.id && { id: call.id }), name: call.name, response } });
    }
    contents.push({ role: "user", parts: responses });
  }
}

function finishReply(turn, onText) {
  let full = turn.text;
  if (!full && turn.finish === "SAFETY") throw new Error("Gemini blocked this reply. Try rephrasing.");
  if (turn.finish === "MAX_TOKENS") {
    full += "\n\n> ✂️ *Reply was cut off at the length limit. Ask \"continue\" to get the rest.*";
    onText(full);
  }
  return full;
}

/**
 * Structured output: one non-streaming request that must return JSON matching `schema`.
 * Returns the raw JSON text; the caller parses and validates it.
 */
export async function generateJson({ apiKey, model, system, prompt, schema, signal }) {
  const res = await callModel({
    apiKey,
    model,
    method: "generateContent",
    signal,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json", responseSchema: schema },
    },
  });
  const json = await res.json();
  const cand = json.candidates && json.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
}
