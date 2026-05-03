/**
 * Chat Engine Interface
 * 
 * Implement this interface to add a new chatting engine to the bot.
 * Each engine handles the core chatbot logic (reply generation, learning, brain persistence).
 * Only the active engine is loaded in memory at runtime.
 */

export interface ChatEngine {
  /**
   * Generate a reply for the given input text.
   */
  reply(input: string): string;

  /**
   * Learn from the input text. Called after reply() when learning is enabled.
   */
  learn(input: string): void;

  /**
   * Serialize the engine's brain/state to bytes for persistence.
   * Return null if saving is not supported or failed.
   */
  save(): Uint8Array | null;

  /**
   * Load brain/state from persisted bytes.
   */
  load(data: Uint8Array): void;

  /**
   * Unique identifier for this engine (e.g., 'megahal', 'aiml', 'rivescript').
   */
  readonly name: string;

  /**
   * Whether this engine supports personalities.
   * If true, the engine will receive personality name when initialized.
   */
  readonly supportsPersonality: boolean;

  /**
   * Initialize the engine with a personality (if supported).
   * Only called if supportsPersonality is true.
   */
  setPersonality?(name: string): Promise<void>;

  /**
   * Initialize/become the engine. Called once when engine is first loaded.
   * @param personality Optional personality name to initialize with
   */
  become?(personality?: string): Promise<void>;
}

/**
 * Factory function type for lazy-loading an engine.
 */
export type EngineLoader = () => Promise<ChatEngine>;