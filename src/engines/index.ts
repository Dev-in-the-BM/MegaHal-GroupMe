/**
 * Chat Engine Registry
 * 
 * Manages lazy-loading and caching of chat engines.
 * Only the active engine is loaded in memory at runtime.
 */

import type { ChatEngine, EngineLoader } from './types.js';

class ChatEngineRegistry {
  private static loaders: Map<string, EngineLoader> = new Map();
  private static engines: Map<string, ChatEngine> = new Map();

  /**
   * Register a new engine loader.
   * Typically called during module initialization.
   */
  public static register(name: string, loader: EngineLoader): void {
    this.loaders.set(name, loader);
  }

  /**
   * Get an engine by name, lazy-loading it if necessary.
   * Returns null if the engine is not registered.
   */
  public static async getEngine(name: string): Promise<ChatEngine | null> {
    // Return cached engine if available
    if (this.engines.has(name)) {
      return this.engines.get(name)!;
    }

    // Try to lazy-load the engine
    const loader = this.loaders.get(name);
    if (!loader) {
      return null;
    }

    const engine = await loader();
    this.engines.set(name, engine);
    return engine;
  }

  /**
   * List all registered engine names.
   */
  public static list(): string[] {
    return Array.from(this.loaders.keys());
  }

  /**
   * Check if an engine is registered.
   */
  public static has(name: string): boolean {
    return this.loaders.has(name);
  }

  /**
   * Clear all cached engines (useful for testing or hot-reload).
   */
  public static clearCache(): void {
    this.engines.clear();
  }

  /**
   * Reset the registry (clears loaders and cache).
   */
  public static reset(): void {
    this.loaders.clear();
    this.engines.clear();
  }
}

export { ChatEngineRegistry };
export default ChatEngineRegistry;