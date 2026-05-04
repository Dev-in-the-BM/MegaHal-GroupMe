/**
 * MegaHAL Chat Engine
 * 
 * Wraps the MegaHAL class as a ChatEngine for use with the engine registry.
 * This wrapper delegates to the existing MegaHAL implementation.
 */

import { MegaHAL } from '../../megahal/megahal.js';
import type { ChatEngine } from '../types.js';
import { ChatEngineRegistry } from '../index.js';

// Register this engine
ChatEngineRegistry.register('megahal', async () => {
  const engine = new MegaHALEngine();
  await engine.become();
  return engine;
});

class MegaHALEngine implements ChatEngine {
  private hal: MegaHAL;
  public readonly name = 'megahal';
  public readonly supportsPersonality = true;

  constructor() {
    this.hal = new MegaHAL();
  }

  async become(personality?: string): Promise<void> {
    await this.hal.become(personality || 'default');
  }

  async setPersonality(name: string): Promise<void> {
    this.hal = new MegaHAL();
    await this.hal.become(name);
  }

  reply(input: string): Promise<string> {
    // MegaHAL.reply() handles learning internally based on this.learning flag
    // We call reply but don't call learn separately to avoid double-learning
    return Promise.resolve(this.hal.reply(input));
  }

  learn(input: string): void {
    // For MegaHAL, learning is handled inside reply() when this.learning is true
    // This method is kept for interface compliance but the actual learning
    // happens during reply() call
  }

  save(): Uint8Array | null {
    return this.hal.save();
  }

  load(data: Uint8Array): void {
    this.hal.load(data);
  }

  /**
   * Set the learning flag on the underlying MegaHAL instance.
   */
  set learning(enabled: boolean) {
    this.hal.learning = enabled;
  }

  get learning(): boolean {
    return this.hal.learning;
  }
}

export { MegaHALEngine };
export default MegaHALEngine;