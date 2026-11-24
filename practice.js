// Practice mode (AI-assisted interview): session state, the clock, and the feedback scorecard.
import { VERDICTS, CORRECTNESS } from "./prompts.js";

export const DEFAULT_MINUTES = 30;

// One practice round per problem, saved in chrome.storage as `practice:<slug>`.
export function newSession(minutes = DEFAULT_MINUTES) {
  return { status: "idle", minutes, startedAt: null, endedAt: null, log: [], history: [], tools: [], scorecard: null, rawFeedback: null };
}

const pad = (n) => String(n).padStart(2, "0");

// 1500000 -> "25:00"
export function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function remainingMs(session, now) {
  return session.minutes * 60000 - (now - session.startedAt);
}

// Every prompt the candidate sends is kept with its time, for the AI-usage score.
export function logPrompt(session, text, now) {
  session.log.push({ at: new Date(now).toISOString(), elapsed: formatClock(now - session.startedAt), text });
}

// ---------- scorecard validation ----------

const clampScore = (n) => (Number.isFinite(+n) ? Math.min(10, Math.max(0, Math.round(+n))) : 0);
const str = (v) => (typeof v === "string" ? v.trim() : "");
const strList = (v, max) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : []);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const scored = (o) => ({ score: clampScore(o && o.score), comment: str(o && o.comment) });

// Parse the model's JSON and coerce every field into a safe shape. Returns null if it isn't usable.
export function parseScorecard(text) {
  let o;
  try {
    o = JSON.parse(String(text || "").replace(/^\s*```(?:json)?|```\s*$/g, ""));
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || !Number.isFinite(+o.overallScore)) return null;
  const ai = o.aiUsage || {};
  return {
    overallScore: clampScore(o.overallScore),
    problemSolving: scored(o.problemSolving),
    aiUsage: { ...scored(ai), goodPrompts: strList(ai.goodPrompts, 3), weakPrompts: strList(ai.weakPrompts, 3) },
    codeQuality: scored(o.codeQuality),
    correctness: {
      verdict: oneOf(o.correctness && o.correctness.verdict, CORRECTNESS, "Not attempted"),
      comment: str(o.correctness && o.correctness.comment),
    },
    improvements: strList(o.improvements, 3),
    interviewerVerdict: oneOf(o.interviewerVerdict, VERDICTS, "Lean no"),
  };
}

// ---------- scorecard rendering (plain DOM, no HTML from the model) ----------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

const slug = (s) => s.toLowerCase().replace(/\s+/g, "-");

function scoreRow(label, { score, comment }) {
  const row = el("div", "sc-row");
  const head = el("div", "sc-row-head");
  head.append(el("span", "sc-label", label), el("span", "sc-score", `${score}/10`));
  const bar = el("div", "sc-bar");
  const fill = el("div", `sc-fill ${score >= 7 ? "good" : score >= 4 ? "mid" : "low"}`);
  fill.style.width = `${score * 10}%`;
  bar.append(fill);
  row.append(head, bar);
  if (comment) row.append(el("p", "sc-comment", comment));
  return row;
}

function listBlock(title, items, ordered) {
  const box = el("div", "sc-list");
  box.append(el("div", "sc-label", title));
  const list = el(ordered ? "ol" : "ul");
  for (const item of items) list.append(el("li", null, item));
  box.append(list);
  return box;
}

export function renderScorecard(card) {
  const root = el("div", "msg model scorecard");

  const head = el("div", "sc-head");
  const overall = el("div", "sc-overall");
  overall.append(el("b", null, String(card.overallScore)), el("span", "muted", "/10"));
  head.append(el("div", "sc-title", "Interview feedback"), overall, el("span", `sc-badge ${slug(card.interviewerVerdict)}`, card.interviewerVerdict));
  root.append(head);

  root.append(scoreRow("Problem solving", card.problemSolving));
  root.append(scoreRow("AI usage", card.aiUsage));
  if (card.aiUsage.goodPrompts.length) root.append(listBlock("✅ Good prompts", card.aiUsage.goodPrompts.map((p) => `“${p}”`)));
  if (card.aiUsage.weakPrompts.length) root.append(listBlock("⚠️ Weak prompts", card.aiUsage.weakPrompts.map((p) => `“${p}”`)));
  root.append(scoreRow("Code quality", card.codeQuality));

  const corr = el("div", "sc-row");
  const corrHead = el("div", "sc-row-head");
  corrHead.append(el("span", "sc-label", "Correctness"), el("span", `sc-badge ${slug(card.correctness.verdict)}`, card.correctness.verdict));
  corr.append(corrHead);
  if (card.correctness.comment) corr.append(el("p", "sc-comment", card.correctness.comment));
  root.append(corr);

  if (card.improvements.length) root.append(listBlock("Next time", card.improvements, true));
  return root;
}
