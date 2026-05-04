/**
 * ElizaBot Chat Engine
 *
 * Wraps the elizabot npm package as a ChatEngine for use with the engine registry.
 * elizabot is an implementation of the classic ELIZA chatbot - a mock Rogerian psychotherapist.
 *
 * Key characteristics:
 * - learn() is a no-op (ELIZA is pattern-based, not a learning engine)
 * - save() returns null (no persistent brain state to serialize - state is in-memory only)
 * - supportsPersonality is false (ELIZA doesn't use personalities, just its built-in script)
 */

import { ElizaBot } from 'elizabot';
import type { ChatEngine } from '../types.js';
import { ChatEngineRegistry } from '../index.js';

// Register this engine with the registry
ChatEngineRegistry.register('elizabot', async () => {
	const engine = new ElizaBotEngine();
	await engine.become();
	return engine;
});

class ElizaBotEngine implements ChatEngine {
	private bot: ElizaBot;
	private isQuitting: boolean = false;

	readonly name = 'elizabot';
	readonly supportsPersonality = false; // ELIZA doesn't use personalities

	constructor() {
		this.bot = new ElizaBot();
	}

	/**
	 * Initialize the engine.
	 * ELIZA doesn't support personalities, so this just ensures the bot is ready.
	 */
	async become(_personality?: string): Promise<void> {
		this.bot = new ElizaBot();
		this.isQuitting = false;
	}

	/**
	 * ELIZA doesn't support switching personalities at runtime.
	 * This is a no-op.
	 */
	async setPersonality(_name: string): Promise<void> {
		// ELIZA doesn't support personalities
		// No-op intentionally
	}

	/**
	 * Generate a reply for the given input.
	 * ELIZA's transform() is synchronous, but we return a Promise for interface compatibility.
	 */
	async reply(input: string): Promise<string> {
		try {
			// Check if previous exchange was a quit
			if (this.isQuitting) {
				const final = this.bot.getFinal();
				this.isQuitting = false;
				return typeof final === 'string' ? final : String(final);
			}

			const reply = this.bot.transform(input);

			// Check if this was a quit phrase
			if (this.bot.quit) {
				this.isQuitting = true;
				const final = this.bot.getFinal();
				return typeof final === 'string' ? final : String(final);
			}

			return typeof reply === 'string' ? reply : String(reply);
		} catch (err) {
			console.error('ElizaBot reply error:', err);
			return 'I need to think about that...';
		}
	}

	/**
	 * ELIZA does not learn at runtime - this is a no-op.
	 */
	learn(_input: string): void {
		// ELIZA is pattern-based, not a learning engine
		// No-op intentionally
	}

	/**
	 * ELIZA state is in-memory only - no runtime state to load.
	 * This is a no-op.
	 */
	load(_data: Uint8Array): void {
		// ELIZA's state is determined by the script, not loaded from bytes
		// No-op
	}

	/**
	 * ELIZA does not have persistent runtime state to save.
	 * Returns null - the script is static, only in-memory state exists.
	 */
	save(): Uint8Array | null {
		// ELIZA's "brain" is the built-in script, not runtime state
		return null;
	}
}

export { ElizaBotEngine };
export default ElizaBotEngine;