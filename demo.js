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
    text: `### Verdict
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
