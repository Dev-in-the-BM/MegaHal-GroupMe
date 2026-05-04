/**
 * Type declarations for elizabot npm package.
 * elizabot is an implementation of the classic ELIZA chatbot.
 */

declare class ElizaBot {
	/**
	 * Create a new ElizaBot instance.
	 * @param disableRandom - If true, disables random choice (for reproducing original behavior)
	 */
	constructor(disableRandom?: boolean);

	/**
	 * Transform input text and return a response string.
	 */
	transform(input: string): string;

	/**
	 * Get the initial greeting message.
	 */
	getInitial(): string;

	/**
	 * Get the final closing message.
	 */
	getFinal(): string;

	/**
	 * Reset the bot's memory and internal state.
	 */
	reset(): void;

	/**
	 * Memory size for internal storage (default: 20).
	 */
	memSize: number;

	/**
	 * Flag set to true when user input triggers a quit phrase.
	 */
	quit: boolean;
}

export { ElizaBot };
export default ElizaBot;