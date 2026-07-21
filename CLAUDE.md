# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals. For multi-step tasks, state a brief plan with verification checks. Strong success criteria let you loop independently.

## 5. Verify Before Acting

**先查验，再行动。禁止跳过分析直接改代码。**

Read affected code before proposing changes. Present findings as: problem → root cause → proposed fix. Do NOT touch code until the user explicitly says "execute" or "改".

---

## Project-Specific Rules

### Architecture
- **Main process** (`src/main/`): Node.js, SQLite via better-sqlite3 (sync), AI service calls
- **Renderer** (`src/renderer/`): Vue 3 + Pinia + Element Plus + Vue Flow
- **IPC bridge** (`src/preload/`): NEVER expose raw Node APIs to renderer
- File organization: services by domain (`ai.ts`, `imageGenerator.ts`, etc.), composables for reusable logic

### AI Pipeline
- Prompt templates: `src/main/data/prompt-templates/` (file-based, NOT database)
- All LLM prompts loaded via `loadPromptTemplate(usage)`
- Model routing via `modelRouter.ts` → never hardcode model names in service files
- JSON repair via `jsonrepair` before parsing AI responses

### Database
- SQLite via `better-sqlite3` (synchronous API)
- Schema version tracked in `tpl_version` table, migrations in `db.ts`
- Character/scene/prop reuse: match by name, only create when new
- `parse_group` tracks each AI parse session for rollback

### Key Constraints
- Temperature: 0 (deterministic), seed: 1024
- Video duration engine: dialogue 3.0字/s, narration 3.5字/s, max 15s/chapter
- Image resolution: all 16-multiples (1088x1088 etc.)
- `parseMode: 'append'` preserves existing data; `'full'` replaces

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Important References
- [DECISIONS.md](DECISIONS.md) — 架构决策日志：反直觉的设计决定、已知陷阱、pipeline 执行顺序。**遇到不理解的设计先查这里。**
- **何时写入 DECISIONS.md**：只写"未来的工程师会认为是 bug 并试图修复它"的决策。普通 bug fix、参数调整、重命名不需要。堆多了变噪音。
