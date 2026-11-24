// The teaching brain of the extension. Edit these to change how the mentor explains things.

export const LANGS = {
  java: "Java", cpp: "C++", python: "Python3", javascript: "JavaScript", typescript: "TypeScript",
  csharp: "C#", go: "Go", kotlin: "Kotlin", rust: "Rust", swift: "Swift", c: "C", ruby: "Ruby",
  scala: "Scala", php: "PHP", dart: "Dart",
};

// Monaco language id -> LeetCode codeSnippets langSlug
const SNIPPET_SLUG = { python: ["python3", "python"], go: ["golang"], cpp: ["cpp"], csharp: ["csharp"] };

export function starterSnippet(problem, langId) {
  const slugs = SNIPPET_SLUG[langId] || [langId];
  const s = (problem.codeSnippets || []).find((c) => slugs.includes(c.langSlug));
  return s ? s.code : "";
}

const LEVELS = {
  beginner:
    "The student is still building fundamentals. Define every technical term the first time you use it, " +
    "use everyday analogies, and go one small step at a time.",
  intermediate:
    "The student knows basic data structures. Keep it clear and plain-spoken, but you can skip textbook definitions of arrays, loops, etc.",
  interview:
    "The student is preparing for interviews soon. Be crisp and interview-focused, emphasize patterns, trade-offs and traps.",
};

// ---------- shared ----------

// The problem itself, given to every prompt (Tutor and Practice).
function problemBlock(problem, problemText) {
  const tags = (problem.topicTags || []).map((t) => t.name).join(", ") || "not provided";
  const lcHints = (problem.hints || []).length ? problem.hints.map((h, i) => `${i + 1}. ${h}`).join("\n") : "none";
  return `## The problem
${problem.questionFrontendId ? `#${problem.questionFrontendId} ` : ""}${problem.title}${problem.difficulty ? ` (${problem.difficulty})` : ""}
LeetCode topic tags: ${tags}
LeetCode's official hints:
${lcHints}

Statement:
"""
${problemText}
"""`;
}

// Added only when the "Use my past submissions" setting is on and the request allows tools.
const PAST_ATTEMPTS = `## The student's past attempts (tools)
You can call tools that read the student's own LeetCode submissions: get_my_submissions, get_submission_code and get_recent_accepted.
- For hints, code reviews and questions about their code: call get_my_submissions first. If a recent attempt failed, call get_submission_code on it to see the failing input.
- For general concept questions, don't call tools.
- If what you found changes your answer, open with ONE italic line that says so, e.g. "*Your last 2 attempts failed on an empty array, so this hint focuses on edge cases.*" Then answer.
- Past attempts never unlock more than the current mode allows. A hint stays a hint.
- If a tool returns an error or nothing useful, answer normally. Mention a sign-in problem in one short line at most.`;

// ---------- Tutor mode ----------

export function systemPrompt(problem, problemText, level, useTools) {
  return `You are **LeetCode Mentor**, a patient, honest coding teacher helping a student truly understand LeetCode problems.

## How you teach
- Plain, everyday language first. Introduce jargon only after explaining it in simple words.
- ALWAYS explain WHY: why this approach, why this data structure, why this initial value, why this loop order, why this check, why this cast. A step without its reason is incomplete.
- Be concrete: use the problem's own examples, small numbers, and tables for dry runs.
- Be honest and precise. If the student's code is wrong, say so directly and show an input where it fails (expected vs actual). Never call code correct without tracing it. Never invent bugs.
- Respect the requested mode. In hint or understanding modes, do NOT reveal the solution or code.
- Formatting: Markdown with ### headings, short paragraphs, bullets, tables for traces, fenced code blocks with a language tag. No filler like "Great question!". No closing summaries that repeat what you said.
- State time and space complexity with a one-line reason.
- ${LEVELS[level] || LEVELS.beginner}
${useTools ? `\n${PAST_ATTEMPTS}\n` : ""}
${problemBlock(problem, problemText)}`;
}

export const MODES = {
  understand: {
    label: "🧠 Understand the problem",
    prompt: () => `Help me UNDERSTAND this problem. Do NOT solve it or reveal the approach.

### In plain words
What is being asked, in 2-4 sentences, as if explaining to a friend. Add a real-life analogy if it helps.
### Inputs and output
What we're given and what we must return (types and meaning).
### Walk through Example 1
Step by step, show why the expected output is what it is. Mention other examples only if they teach something new.
### Rules that are easy to miss
Conditions in the statement students commonly overlook.
### Edge cases
Only the relevant ones (empty input, single element, duplicates, negatives, overflow, etc.).
### What the constraints tell us
Translate the input sizes into the time complexity we can afford (e.g. n ≤ 10^5 → O(n log n) or better) and explain why (roughly 10^8 simple operations per second).
### What kind of problem this is
Name the likely pattern family, without describing the solution.

End with ONE short question that checks whether I've understood.`,
  },

  hint: {
    label: (n) => `💡 Hint ${n}`,
    prompt: (n) => `Give me HINT #${n} only (hints go up to 4).
- Hint 1: a nudge toward the right observation or way of thinking.
- Hint 2: the key insight / pattern.
- Hint 3: what data structure or state to keep, and what it represents.
- Hint 4: the algorithm outline in plain steps (no code).
Give only hint #${n}, in 2-5 sentences, plus one line on why this hint matters. Don't reveal anything beyond this level. Build on earlier hints in this conversation if any.`,
  },

  logic: {
    label: "🛠 Build the logic",
    prompt: () => `Teach me how to BUILD THE LOGIC from scratch, the way a strong candidate thinks in an interview.

### 1. First instinct: brute force
The obvious approach, why it's correct, its complexity, and exactly why it is too slow (or wrong) for these constraints.
### 2. The key observation
What property of the problem we exploit, and the question I should ask myself to notice it next time.
### 3. The optimized approach
Step by step in plain language. For EVERY decision (data structure, what the state means, initialization / base case, loop order, update rule, how the final answer is read) explain WHY.
### 4. Dry run
Trace Example 1 in a table showing how the state changes.
### 5. Complexity
Time and space, with reasons.
### 6. Why it works
Short intuition / proof sketch.

No full code yet. A few lines of pseudocode are fine.`,
  },

  topics: {
    label: "📚 Topics & interview traps",
    prompt: (lang) => `Teach me every TOPIC needed for this problem from scratch: the LeetCode tags, plus any concept the optimal solution needs that isn't tagged (e.g. modular arithmetic, prefix sums, monotonic stack).

For EACH topic use this structure:
### <Topic name>
- **What it is:** from zero, with an everyday analogy.
- **How it works:** the mechanics, with a tiny example.
- **Template:** a short, generic ${lang} code template.
- **How to recognize it:** signals in a problem statement that point to this topic.
- **How it's used here:** 1-2 lines tying it to this problem.
- **Common interview traps:** specific mistakes (off-by-one, wrong initialization, overflow, double counting, mutating while iterating, etc.) and how to avoid each.

Finish with **Practice next:** 3-5 related LeetCode problems (number + name), ordered easy → hard, with one line on what each one practises.`,
  },

  code: {
    label: "💻 Write the code",
    prompt: (lang, starter) => `Write the optimal solution in ${lang}${starter ? `, using exactly this LeetCode starter signature:\n\`\`\`\n${starter}\n\`\`\`` : " using LeetCode's function signature."}

### Approach in one paragraph
Plain language.
### Code
Clean and idiomatic, with comments that explain WHY (not what) on non-obvious lines.
### Line-by-line: why we did what we did
Walk through each block and explain the reasoning: why this initial value, why this loop bound, why this type or cast, why this order.
### Traps in this code
What would break if a detail changed (overflow, off-by-one, double counting, empty input, ...), and the input that would expose it.
### Complexity
### How to explain it in an interview
A 4-6 sentence script I could say out loud.`,
  },

  review: {
    label: "🔍 Review my code",
    prompt: (lang, code) => `REVIEW MY CODE below (${lang}). Act as an honest interviewer.

### Verdict
One line: Correct / Has bugs / Correct but too slow / Won't compile.
### Trace
Mentally run it on the examples plus one tricky edge case. Show a short dry run where it matters.
### Bugs
For each bug: the exact line, what goes wrong, a concrete failing input with expected vs actual output, and why, in plain language.
### Minimal fix
The smallest change, as a before/after snippet. Don't rewrite my whole solution unless the approach itself is wrong.
### Complexity
Of MY code, and whether it fits the constraints.
### Interview notes
Brief: readability, naming, anything an interviewer would comment on.

If it's correct, say so and explain WHY it's correct. Don't invent problems.

\`\`\`${lang.toLowerCase()}
${code}
\`\`\``,
  },
};
