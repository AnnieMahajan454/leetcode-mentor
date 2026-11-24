// Sample data used only when sidepanel.html is opened outside the extension (UI preview).
export const problem = {
  questionFrontendId: "3665",
  title: "Twisted Mirror Path Count",
  titleSlug: "twisted-mirror-path-count",
  difficulty: "Medium",
  topicTags: [{ name: "Array" }, { name: "Dynamic Programming" }, { name: "Matrix" }],
  hints: [],
  codeSnippets: [{ langSlug: "java", code: "class Solution {\n    public int uniquePaths(int[][] grid) {\n        \n    }\n}" }],
  content: "<p>Given an <code>m x n</code> binary grid where 1 is a mirror… Return the number of paths modulo 10<sup>9</sup> + 7.</p>",
};

export const editor = {
  lang: "java",
  code: "class Solution {\n    public int uniquePaths(int[][] grid) {\n        // ...\n        dp[0][0][0] = 1;\n        dp[0][0][1] = 1;\n    }\n}",
};

export const history = [
  { role: "user", label: "🔍 Review my code", text: "(review prompt)" },
  {
    role: "model",
    tools: [
      { text: "Checked your last 5 submissions (3 Wrong Answer, 1 TLE, 1 Compile Error)" },
      { text: "Read your submission #1432871 (Wrong Answer, Java)" },
    ],
    text: `*Your last 3 attempts failed with an answer exactly twice the expected one, so this review starts with how the start cell is seeded.*

### Verdict
**Has bugs.** Every answer comes out exactly doubled.

### Bugs
**Line:** \`dp[0][0][1] = 1;\`

The start cell is empty, and on an empty cell both directions do the *same* thing (push right and push down). Seeding both slots sends **2** ways out of the start instead of 1.

| Grid | Expected | Yours |
|---|---|---|
| \`[[0,0],[0,0]]\` | 2 | 4 |
| \`[[0,1,0],[0,0,1],[1,0,0]]\` | 5 | 10 |

### Minimal fix
\`\`\`java
dp[0][0][0] = 1;   // keep
// dp[0][0][1] = 1; ← delete
\`\`\`

### Complexity
O(m·n) time, O(m·n) space. Fine for the constraints.`,
  },
];

// A finished Practice round, to preview the scorecard.
const start = Date.parse("2026-11-20T18:00:00Z");
export const practice = {
  status: "done",
  minutes: 30,
  startedAt: start,
  endedAt: start + 24 * 60000 + 13000,
  log: [
    { at: "2026-11-20T18:04:10Z", elapsed: "04:10", text: "What does the mirror do to the direction exactly? Is it a turn from right to down only?" },
    { at: "2026-11-20T18:11:32Z", elapsed: "11:32", text: "I'm thinking dp[i][j][dir]. Is O(m*n) states enough for m, n up to 500?" },
    { at: "2026-11-20T18:19:05Z", elapsed: "19:05", text: "My answer for [[0,0],[0,0]] is 4, expected 2. Why?" },
    { at: "2026-11-20T18:21:40Z", elapsed: "21:40", text: "just give me the fixed code" },
  ],
  history: [
    { role: "user", text: "My answer for [[0,0],[0,0]] is 4, expected 2. Why?" },
    { role: "model", text: "You seed **both** directions at the start cell. On an empty cell both directions move the same way, so every path is counted twice. Seed only `dp[0][0][0] = 1`." },
  ],
  tools: [
    { text: "Checked your last 1 submission (1 Accepted)" },
    { text: "Read your submission #1432990 (Accepted, Java)" },
  ],
  scorecard: {
    overallScore: 7,
    problemSolving: { score: 8, comment: "Found the 3-D DP state early and checked the complexity against the constraints before coding." },
    aiUsage: {
      score: 6,
      comment: "Most prompts were specific and checkable. The last one asked for finished code instead of applying the explained one-line fix.",
      goodPrompts: [
        "I'm thinking dp[i][j][dir]. Is O(m*n) states enough for m, n up to 500?",
        "My answer for [[0,0],[0,0]] is 4, expected 2. Why?",
      ],
      weakPrompts: ["just give me the fixed code"],
    },
    codeQuality: { score: 7, comment: "Clear loops and names. The modulo is repeated in three places; one helper would read better." },
    correctness: { verdict: "Correct", comment: "Accepted on LeetCode at 23:50, during the session." },
    improvements: [
      "Dry-run the smallest grid by hand before submitting; it shows the double-seeding bug in seconds.",
      "When the AI explains a fix, apply it yourself and ask it to check your version.",
      "Say the state definition out loud before coding, e.g. dp[i][j][d] = ways to reach (i, j) moving in direction d.",
    ],
    interviewerVerdict: "Hire",
  },
  rawFeedback: null,
};
