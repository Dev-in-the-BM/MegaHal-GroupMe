# Chat Engine Abstraction Plan

## Problem
MegaHAL chatbot logic and GroupMe integration are tightly coupled. Adding new engines (AIML, Rivescript) requires modifying the core request handler.

## Goal
Decouple chat engine logic from GroupMe integration so multiple engines can be used interchangeably with shared configuration (personality, learning, prefix).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      index.ts                            │
│   (GroupMe webhook handler, config, admin commands)      │
└─────────────────────┬───────────────────────────────────┘
                      │ engine.reply(text)
                      ▼
┌─────────────────────────────────────────────────────────┐
│              src/engines/index.ts                        │
│         ChatEngineRegistry (lazy loading)                │
│   getEngine(name) → ChatEngine | null                    │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   ┌─────────┐  ┌──────────┐  ┌──────────┐
   │ MegaHAL │  │  AIML    │  │ Rivescript│
   │ (src/    │  │ (future) │  │ (future)  │
   │ engines/ │  │          │  │           │
   │ megahal/ │  │          │  │           │
   │  index.ts)│  │          │  │           │
   └─────────┘  └──────────┘  └──────────┘
```

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/engines/index.ts` | ChatEngineRegistry - lazy loads and caches engines |
| `src/engines/types.ts` | ChatEngine interface definition |
| `src/engines/megahal/index.ts` | MegaHAL wrapped as an engine (wrapper, not rewrite) |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Use `ChatEngineRegistry.getEngine(config.engine)` instead of `new MegaHAL()` |
| `src/index.ts` | Add `engine` to GroupConfig interface |
| `src/index.ts` | Add `!engine` command to config menu |
| `src/megahal/megahal.ts` | No changes (still used by megahal engine wrapper) |
| `src/megahal/index.ts` | No changes (still valid) |

## ChatEngine Interface

```typescript
interface ChatEngine {
  reply(input: string): string;
  learn(input: string): void;        // called after reply
  save(): Uint8Array | null;         // serialize brain
  load(data: Uint8Array): void;      // deserialize brain
  readonly name: string;            // 'megahal', 'aiml', etc.
  readonly supportsPersonality: boolean;
  setPersonality?(name: string): Promise<void>;
}
```

## Engine Registry API

```typescript
class ChatEngineRegistry {
  static getEngine(name: string): ChatEngine | null;
  static list(): string[];          // ['megahal']
  static register(name: string, loader: () => Promise<ChatEngine>): void;
}
```

## Config Changes

`GroupConfig` gains an `engine` field:
```typescript
interface GroupConfig {
  personality: string;
  learning: 'on' | 'off';
  prefix: string | 'none';
  engine: string;  // default: 'megahal'
}
```

Default config:
```typescript
{
  personality: 'default',
  learning: 'on',
  prefix: '$',
  engine: 'megahal',
}
```

## Config Commands

Add to CONFIG_COMMANDS:
```
4. engine - Change the chat engine
```

## Message Flow (with abstraction)

1. GroupMe webhook POST received
2. Validate sender_type, prefix, botId
3. Load GroupConfig → get engine name
4. `ChatEngineRegistry.getEngine(engine)` → lazy-loads only that engine
5. `engine.load(brain)` (if exists)
6. `reply = engine.reply(text)`
7. POST reply to GroupMe API
8. `engine.learn(text)` (if learning on)
9. `engine.save()` → save brain
10. Return 'OK'

## Lazy Loading Strategy

Engines are loaded on first use via dynamic import:
```typescript
private static engines: Map<string, ChatEngine> = new Map();

static async getEngine(name: string): Promise<ChatEngine | null> {
  if (this.engines.has(name)) return this.engines.get(name)!;
  
  const loader = this.loaders.get(name);
  if (!loader) return null;
  
  const engine = await loader();
  this.engines.set(name, engine);
  return engine;
}
```

## Implementation Order

1. Create `src/engines/types.ts` - define interface
2. Create `src/engines/index.ts` - registry with megahal loader
3. Create `src/engines/megahal/index.ts` - wraps MegaHAL as ChatEngine
4. Modify `src/index.ts` - integrate registry, add engine to config
5. Add `!engine` command to config menu
6. Update docs (this file becomes engine contract)