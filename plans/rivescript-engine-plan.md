# RiveScript Engine Integration Plan

## Context

The bot already has a working engine abstraction. Adding RiveScript follows the same pattern as MegaHAL.

**What's already in place:**
- `rivescript@2.2.1` is already in `package.json` dependencies
- `ChatEngine` interface in `src/engines/types.ts` with `reply()`, `learn()`, `save()`, `load()`, `name`, `supportsPersonality`, `become()`, `setPersonality()`
- `ChatEngineRegistry` in `src/engines/index.ts` with lazy-loading and caching
- MegaHAL wrapper at `src/engines/megahal/index.ts` as reference implementation

**Key constraint:** This runs on Cloudflare Workers/Vercel — no `fs` module. Brains must be embedded as strings or loaded from KV.

## Architecture

```
GroupMe → index.ts → ChatEngineRegistry → RiveScriptEngine
                                         ├── reply() → RiveScript.reply()
                                         ├── learn() → no-op (RiveScript is pattern-matching, not learning)
                                         ├── save()  → null (no persistent state)
                                         ├── load()  → no-op
                                         └── become(personality) → load embedded brain string + KV override
```

## Brain Loading Strategy

1. **Default**: Embedded `.rive` file content as a string in the bundle
2. **Override**: Check KV for `brain:${groupId}:rivescript:${personality}` — if present, use that instead
3. **Personality name** maps to a brain file (e.g., `standard`, `begin`, etc.)

## File Structure

```
src/engines/
├── megahal/
│   └── index.ts
├── rivescript/
│   ├── index.ts              ← RiveScriptEngine implementation
│   ├── brains.ts             ← exported brain strings (embedded in bundle)
│   └── brains/
│       └── standard.rive     ← standard brain content
src/index.ts                  ← import rivescript engine, update ENGINES, personality menu
```

## Implementation Steps

### Step 1 — Create brain strings

`src/engines/rivescript/brains.ts` exports the standard brain as a string:

```typescript
export const BRAIN_STANDARD = \`...standard.rive content...\`;
export const AVAILABLE_BRAINS = ['standard'] as const;
```

### Step 2 — Create RiveScriptEngine

KV override path deferred — keeping it simple with embedded brains only. The in-memory `brainStore` in `index.ts` works for MegaHAL's binary brain persistence. RiveScript's `save()` returns `null` (no runtime learning), so no brain persistence is needed for RiveScript itself. KV override can be added later when there's a real need.

`src/engines/rivescript/index.ts`:

```typescript
import RiveScript from 'rivescript';
import { ChatEngineRegistry } from '../index.js';
import type { ChatEngine } from '../types.js';
import { BRAIN_STANDARD, AVAILABLE_BRAINS } from './brains.js';

ChatEngineRegistry.register('rivescript', async () => {
  const engine = new RiveScriptEngine();
  await engine.become('standard');
  return engine;
});

class RiveScriptEngine implements ChatEngine {
  private bot: RiveScript;
  private currentBrain: string = '';

  readonly name = 'rivescript';
  readonly supportsPersonality = true;

  constructor() {
    this.bot = new RiveScript({ utf8: true });
  }

  async become(personality?: string): Promise<void> {
    const brainName = personality || 'standard';
    this.currentBrain = BRAIN_STANDARD; // TODO: + check KV override
    this.bot = new RiveScript({ utf8: true });
    this.bot.stream(this.currentBrain);
    this.bot.sortReplies();
  }

  async setPersonality(name: string): Promise<void> {
    await this.become(name);
  }

  reply(input: string): string {
    // RiveScript's reply() is synchronous in v2
    // But the ChatEngine interface expects sync reply()
    // We wrap in try/catch
    try {
      return this.bot.reply('localuser', input) as string;
    } catch {
      return 'I need to think about that...';
    }
  }

  learn(_input: string): void {
    // RiveScript doesn't learn at runtime — no-op
  }

  save(): Uint8Array | null {
    // No persistent state to save
    return null;
  }

  load(_data: Uint8Array): void {
    // No-op — brain is loaded via become() only
  }
}

export { RiveScriptEngine, AVAILABLE_BRAINS };
```

### Step 3 — Update index.ts

In `src/index.ts`:

1. Add `import './engines/rivescript/index.js';` after the megahal import
2. Add `'rivescript'` to the `ENGINES` array
3. Refactor personality menu to use `engine.supportsPersonality` — show MegaHAL personalities for `megahal`, show `AVAILABLE_BRAINS` for `rivescript`

### Step 4 — Update docs

`plans/ENGINE_CONTRACT.md` needs a RiveScript section noting:
- No learning (learn() is no-op)
- No save/load (save() returns null)
- Personality = brain name (not programmatic personality files)
- KV override for custom brains per group

## Open Questions

1. **KV override**: The `become()` method needs access to KV to check for per-group brain overrides. The current `index.ts` passes `_kv` to `getBrain()`/`saveBrain()`. We need to thread KV through to the engine. Possible approaches:
   - Pass KV as a constructor parameter (engine owns its KV binding)
   - Add a `setKV(kv)` method to the engine
   - The engine's `become()` reads from a global KV binding (simplest but less testable)

2. **Standard brain content**: Should we include the full [RiveScript standard brain](https://github.com/aichaos/brain) (~500KB) or a trimmed version? Recommendation: include the full standard brain for a complete out-of-the-box personality.

3. **Megahal learning bypass**: The current code sets `engine.learning = false` before `reply()` then re-enables it before `learn()`. RiveScript's `learn()` is a no-op anyway, so this flag doesn't apply — but we should not error when trying to set a non-existent property. The code already handles this with `'learning' in engine` guard.

## Next Action

Ready to switch to **Code mode** to implement. The plan covers:
- Engine class with all ChatEngine interface methods
- Embedded standard brain as module string
- KV override path (needs clarification on threading KV)
- Personality menu integration
- Documentation update