/**
 * RiveScript Chat Engine
 *
 * Wraps the RiveScript library as a ChatEngine for use with the engine registry.
 * RiveScript is a pattern-matching chatbot engine - it does not learn at runtime.
 *
 * Key differences from MegaHAL:
 * - learn() is a no-op (RiveScript is pattern-based, not learning)
 * - save() returns null (no persistent brain state to serialize)
 * - Personality maps to a brain file name (e.g., 'standard')
 */

import RiveScript from 'rivescript';
import type { ChatEngine } from '../types.js';
import { ChatEngineRegistry } from '../index.js';
import { BRAIN_AIDEN, ALICE_BRAIN, AVAILABLE_BRAINS } from './brains.js';

// Register this engine with the registry
ChatEngineRegistry.register('rivescript', async () => {
	const engine = new RiveScriptEngine();
	await engine.become('aiden');
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

	/**
	 * Initialize the engine with a brain.
	 * Loads the embedded brain content by default.
	 */
	async become(personality?: string): Promise<void> {
		const brainName = personality || 'aiden';

		// Load the appropriate brain
		if (brainName === 'alice') {
			this.currentBrain = ALICE_BRAIN;
		} else if (brainName === 'aiden') {
			this.currentBrain = BRAIN_AIDEN;
		} else {
			// Fallback to aiden brain for unknown personalities
			this.currentBrain = BRAIN_AIDEN;
		}

		// Create a fresh RiveScript instance and load the brain
		this.bot = new RiveScript({ utf8: true });
		this.bot.stream(this.currentBrain, (err: string) => {
			if (err) console.error('RiveScript stream error:', err);
		});
		this.bot.sortReplies();
	}

	/**
	 * Switch to a different brain at runtime.
	 */
	async setPersonality(name: string): Promise<void> {
		await this.become(name);
	}

	/**
	 * Generate a reply for the given input.
	 * RiveScript.reply() is async in v2, so we await it.
	 */
	async reply(input: string): Promise<string> {
		try {
			// Skip the intro interview for group chats
			this.bot.setUservar('localuser', 'isGroupChat', 'true');

			const reply = await this.bot.reply('localuser', input);
			return typeof reply === 'string' ? reply : String(reply);
		} catch (err) {
			console.error('RiveScript reply error:', err);
			return 'I need to think about that...';
		}
	}

	/**
	 * RiveScript does not learn at runtime - this is a no-op.
	 */
	learn(_input: string): void {
		// RiveScript is pattern-based, not a learning engine
		// No-op intentionally
	}

	/**
	 * RiveScript brain is loaded via become() only - no runtime state to load.
	 * This is a no-op.
	 */
	load(_data: Uint8Array): void {
		// RiveScript brain is determined by personality, not loaded from bytes
		// No-op
	}

	/**
	 * RiveScript does not have persistent runtime state to save.
	 * Returns null - brain is always determined by personality.
	 */
	save(): Uint8Array | null {
		// RiveScript's brain is the pattern file, not runtime state
		return null;
	}
}

export { RiveScriptEngine, AVAILABLE_BRAINS };
export default RiveScriptEngine;
