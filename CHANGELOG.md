# Changelog

## 1.1.0 (2026-11-25)

### Added
- Agentic tool calling: Gemini can call `get_my_submissions`, `get_submission_code` and `get_recent_accepted`, which read your own LeetCode submissions through GraphQL in the LeetCode tab. Used for hints, code reviews, follow-ups and Practice feedback, with up to 3 tool rounds per answer.
- Tool-call chips above answers, e.g. "🔧 Checked your last 5 submissions (3 Wrong Answer, 1 TLE)".
- Settings toggle "Use my past submissions" (on by default).
- Practice mode (AI-assisted interview): a timer, a chat that acts as your AI assistant, and a per-problem log of every prompt with its time.
- "Finish & get feedback": a JSON scorecard (Gemini `responseSchema`) for problem solving, AI usage, code quality and correctness, with 3 tips and a hire verdict.
- README with architecture diagrams and screenshots, MIT license, `.gitignore`.

### Fixed
- A reply that was stopped while switching problems could be saved into the new problem's chat.

## 1.0.0

### Added
- Side panel Tutor: Understand, Hint 1-4, Build logic, Topics & traps, Write code, Review my code, and a follow-up chat.
- Live problem fetch through LeetCode's GraphQL API, with a page-reading fallback.
- Streaming Gemini answers, three explanation levels, and per-problem chat and hint memory.
