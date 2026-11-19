// Minimal Gemini client (free tier key from https://aistudio.google.com/apikey).
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function friendlyError(status, message) {
  if (status === 429) return "Free-tier rate limit reached. Wait a minute and try again (daily limits reset at midnight Pacific time), or switch to a Flash-Lite model in Settings.";
  if (status === 400 && /api key/i.test(message)) return "Your Gemini API key looks invalid. Check it in Settings.";
  if (status === 403) return "This API key can't use that model. Pick another model in Settings.";
  if (status === 404) return "That model isn't available any more. Click 'Load models' in Settings and pick a current one.";
  return message || `Gemini request failed (HTTP ${status}).`;
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

/**
 * Streams a reply. history: [{role: "user"|"model", text}]
 * onText(fullTextSoFar) is called as chunks arrive. Returns the full text.
 */
export async function streamChat({ apiKey, model, system, history, onText, signal }) {
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(friendlyError(res.status, json.error && json.error.message));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let finish = "";
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
      if (cand.finishReason) finish = cand.finishReason;
      for (const p of (cand.content && cand.content.parts) || []) {
        if (p.text && !p.thought) {
          full += p.text;
          onText(full);
        }
      }
    }
  }
  if (!full && finish === "SAFETY") throw new Error("Gemini blocked this reply. Try rephrasing.");
  if (finish === "MAX_TOKENS") {
    full += "\n\n> ✂️ *Reply was cut off at the length limit. Ask \"continue\" to get the rest.*";
    onText(full);
  }
  return full;
}
