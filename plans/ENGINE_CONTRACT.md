# Chat Engine Contract

This document describes how to implement a new chat engine for the MegaHAL GroupMe bot.

## Overview

The bot uses a **ChatEngine interface** to decouple GroupMe integration from chatbot logic. Multiple engines (MegaHAL, AIML, Rivescript) can be used interchangeably via runtime configuration.

## Architecture

```
GroupMe Webhook → index.ts → ChatEngineRegistry → [MegaHAL | AIML | Rivescript | ...]
```

Only the active engine is loaded in memory. Engines are lazy-loaded via dynamic imports.

## Files

| File | Purpose |
|------|---------|
| `src/engines/types.ts` | ChatEngine interface definition |
| `src/engines/index.ts` | ChatEngineRegistry - lazy loading + caching |
| `src/engines/megahal/index.ts` | MegaHAL engine (reference implementation) |

## ChatEngine Interface

```typescript
interface ChatEngine {
  // Generate a reply for the given input (async for some engines like RiveScript)
  reply(input: string): Promise<string>;

  // Learn from input (called after reply when learning is enabled)
  learn(input: string): void;

  // Serialize brain to bytes (return null if not supported)
  save(): Uint8Array | null;

  // Load brain from bytes
  load(data: Uint8Array): void;

  // Unique identifier: 'megahal', 'aiml', 'rivescript'
  readonly name: string;

  // Does this engine support personalities?
  readonly supportsPersonality: boolean;

  // Optional: set personality at runtime
  setPersonality?(name: string): Promise<void>;

  // Optional: initialize engine (called once on first load)
  become?(personality?: string): Promise<void>;
}
```

## Implementing a New Engine

### 1. Create the engine module

Create `src/engines/<engine-name>/index.ts`:

```typescript
import { ChatEngineRegistry } from '../index.js';
import type { ChatEngine } from '../types.js';

// Register the engine (lazy-loaded)
ChatEngineRegistry.register('myengine', async () => {
  const engine = new MyEngine();
  await engine.become();
  return engine;
});

class MyEngine implements ChatEngine {
  readonly name = 'myengine';
  readonly supportsPersonality = true;

  // ... implement interface methods
}

export { MyEngine };
```

### 2. Register the engine in the main entry

In `src/index.ts`, add an import:

```typescript
import './engines/myengine/index.js';
```

And add to the `ENGINES` array:

```typescript
const ENGINES = ['megahal', 'myengine'];
```

### 3. Implement the required methods

#### `reply(input: string): string`
Generate a response to the user's message. This is the main chatbot logic.

#### `learn(input: string): void`
Learn from the user's message. Called after `reply()` when learning is enabled in config.

#### `save(): Uint8Array | null`
Serialize the engine's state (brain/model) to bytes. Used for persistence between requests.
- Return `null` if saving is not supported.
- Return `new TextEncoder().encode(JSON.stringify(state))` for JSON serialization.

#### `load(data: Uint8Array): void`
Restore engine state from bytes produced by `save()`.

#### `name: string`
Unique identifier used in config (`config.engine` field).

#### `supportsPersonality: boolean`
- `true`: Engine will be initialized with `config.personality` via `become(personality)`
- `false`: Personality field is ignored for this engine

### Optional Methods

#### `become(personality?: string): Promise<void>`
Initialize the engine. Called once when the engine is first loaded and no saved brain exists.
- Load personality data if supported
- Initialize empty brain/state

#### `setPersonality(name: string): Promise<void>`
Change personality at runtime (e.g., for `!personality` command).

## Brain Storage Key Format

Brains are stored using the key format:
```
brain:${groupId}:${engine}:${personality}
```

This allows the same personality to have different brains per engine.

## Adding an Engine Command to Config

When adding a new engine, update these in `src/index.ts`:

1. Import the engine module to trigger registration
2. Add engine name to `ENGINES` array
3. The `!engine` command is already implemented and will show all registered engines

## Example: Future AIML Engine

```typescript
// src/engines/aiml/index.ts
import { ChatEngineRegistry } from '../index.js';
import type { ChatEngine } from '../types.js';

ChatEngineRegistry.register('aiml', async () => {
  return new AIMLEngine();
});

class AIMLEngine implements ChatEngine {
  readonly name = 'aiml';
  readonly supportsPersonality = false; // AIML doesn't use personalities

  reply(input: string): string {
    // Use aiml-node or similar to generate response
    return aiml.getResponse(input);
  }

  learn(input: string): void {
    // AIML doesn't learn at runtime - ignore
  }

  save(): Uint8Array | null {
    // Save AIML state if needed
    return null;
  }

  load(data: Uint8Array): void {
    // Load AIML state if needed
  }
}
```

## Testing

When implementing a new engine, ensure:
1. TypeScript compiles without errors (`npm run build` or `npx tsc --noEmit`)
2. Existing tests still pass (`npm test`)
3. The engine loads correctly when selected in config
4. Brain persistence works (save/load round-trip)

## RiveScript Engine

The RiveScript engine (`src/engines/rivescript/`) is a pattern-matching chatbot engine bundled with the Aiden brain (~73KB across 14 .rive files from https://github.com/aichaos/aiden).

### Key Differences from MegaHAL

| Aspect | MegaHAL | RiveScript |
|--------|---------|------------|
| Learning | Learns from chat history at runtime | No learning (pattern-based) |
| Brain | Binary state (serialize/deserialize) | `.rive` pattern files |
| Persistence | Save/load brain state | No persistence needed |
| Personality | Programmatic personality modules | Brain file name |
| reply() return | `string` (sync) | `Promise<string>` (async) |

### RiveScript Files

```
src/engines/rivescript/
├── index.ts    # RiveScriptEngine class implementing ChatEngine
└── brains.ts   # Embedded brain content (BRAIN_AIDEN)
```

### Available Brains

Currently only `aiden` brain is bundled. Personality menu shows Rivescript brains when `engine = 'rivescript'`.

## Dependency Notes

- Engines run in a serverless environment (Cloudflare Workers / Vercel)
- No `fs` module access - all data must come from parameters or environment
- For external libraries (AIML, Rivescript), use npm packages that support serverless