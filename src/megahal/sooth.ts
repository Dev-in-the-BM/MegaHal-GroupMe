import { Buffer } from "node:buffer";
export interface SoothContext {
	id: number;
	count: number;
	statisticsSize: number;
	statistics: SoothStatistic[];
}

export interface SoothStatistic {
	event: number;
	count: number;
}

export class SoothPredictor {
	public errorEvent: number;
	private contexts: SoothContext[] = [];
	private contextsSize = 0;

	constructor(errorEvent = 0) {
		this.errorEvent = errorEvent;
	}

	/**
	 * Clears all contexts.
	 */
	public clear(): void {
		this.contexts = [];
		this.contextsSize = 0;
	}

	/**
	 * Saves the predictor state to a Uint8Array using JSON serialization.
	 * Uses TextEncoder for efficient encoding.
	 */
	public save(): Uint8Array | null {
		try {
			const data = {
				magic: 'MH11',
				errorEvent: this.errorEvent,
				contextsSize: this.contextsSize,
				contexts: this.contexts.slice(0, this.contextsSize),
			};

			const jsonString = JSON.stringify(data);
			return new TextEncoder().encode(jsonString);
		} catch (error) {
			console.error('Error saving SoothPredictor:', error);
			return null;
		}
	}

	/**
	 * Loads the predictor state from a Uint8Array using JSON deserialization.
	 * Uses TextDecoder for efficient decoding.
	 */
	public load(data: Uint8Array): boolean {
		try {
			const jsonString = new TextDecoder().decode(data);
			const parsed = JSON.parse(jsonString);

			if (parsed.magic !== 'MH11') {
				return false;
			}

			this.clear();

			this.errorEvent = parsed.errorEvent;
			this.contextsSize = parsed.contextsSize;

			if (this.contextsSize === 0) {
				return true;
			}

			this.contexts = parsed.contexts;

			return true;
		} catch (error) {
			console.error('Error loading SoothPredictor:', error);
			this.clear();
			return false;
		}
	}

	/**
	 * Finds or creates a context for the given ID.
	 */
	private findContext(id: number): SoothContext {
		let context: SoothContext | undefined;
		let low = 0;
		let mid = 0;
		let high = this.contextsSize - 1;

		// Binary search for the context
		if (this.contextsSize > 0) {
			while (low <= high) {
				mid = Math.floor(low + (high - low) / 2);
				context = this.contexts[mid];
				if (context.id < id) {
					low = mid + 1;
				} else if (context.id > id) {
					if (mid === 0) {
						break;
					}
					high = mid - 1;
				} else {
					return context;
				}
			}
			mid = low;
		}

		// Create a new context if not found
		this.contextsSize += 1;
		this.contexts.push({ id: -1, count: 0, statisticsSize: 0, statistics: [] });

		if (mid + 1 < this.contextsSize) {
			this.contexts.splice(mid + 1, 0, ...this.contexts.splice(mid, this.contextsSize - mid - 1));
		}

		context = {
			id,
			count: 0,
			statisticsSize: 0,
			statistics: [],
		};

		this.contexts[mid] = context;

		return context;
	}

	/**
	 * Finds or creates a statistic for the given event within the context.
	 */
	private findStatistic(context: SoothContext, event: number): SoothStatistic {
		let low = 0;
		let high = context.statisticsSize - 1;
		let mid = 0;
		let statistic: SoothStatistic | null = null;

		// Binary search for the statistic
		if (context.statisticsSize > 0) {
			while (low <= high) {
				mid = low + Math.floor((high - low) / 2);
				statistic = context.statistics[mid];
				if (statistic.event < event) {
					low = mid + 1;
				} else if (statistic.event > event) {
					if (mid === 0) {
						break;
					}
					high = mid - 1;
				} else {
					return statistic;
				}
			}

			mid = low;
		}

		// Create a new statistic if not found
		context.statisticsSize += 1;
		const newMemory = new Array<SoothStatistic>(context.statisticsSize);

		for (let i = 0; i < context.statisticsSize - 1; i++) {
			newMemory[i] = context.statistics[i];
		}

		context.statistics = newMemory;

		if (mid + 1 < context.statisticsSize) {
			for (let i = context.statisticsSize - 1; i > mid; i--) {
				context.statistics[i] = context.statistics[i - 1];
			}
		}

		statistic = { event, count: 0 };
		context.statistics[mid] = statistic;

		return statistic;
	}

	/**
	 * Returns the size of the statistics for the given context ID.
	 */
	public size(id: number): number {
		const context = this.findContext(id);
		return context.statisticsSize;
	}

	/**
	 * Returns the count of observations for the given context ID.
	 */
	public count(id: number): number {
		const context = this.findContext(id);
		return context.count;
	}

	/**
	 * Observes an event for the given context ID.
	 */
	public observe(id: number, event: number): number {
		const context = this.findContext(id);

		// Handle overflow by halving the counts
		if (context.count === Number.MAX_SAFE_INTEGER) {
			context.count = 0;
			for (let i = 0; i < context.statisticsSize; i++) {
				const statistic = context.statistics[i];
				statistic.count /= 2;
				context.count += statistic.count;
			}
		}

		const statistic = this.findStatistic(context, event);

		statistic.count += 1;
		context.count += 1;

		return statistic.count;
	}

	/**
	 * Selects an event based on the limit for the given context ID.
	 */
	public select(id: number, limit: number): number {
		const context = this.findContext(id);
		if (limit === 0 || limit > context.count) {
			return this.errorEvent;
		}

		for (let i = 0; i < context.statisticsSize; i++) {
			const statistic = context.statistics[i];
			if (limit > statistic.count) {
				limit -= statistic.count;
				continue;
			}
			return statistic.event;
		}

		return this.errorEvent;
	}

	/**
	 * Returns the probability distribution of events for the given context ID.
	 */
	public distribution(id: number): Record<number, number> | null {
		const context = this.findContext(id);
		if (!context.statisticsSize) return null;

		const total = context.count;
		return context.statistics.reduce(
			(acc, stat) => {
				acc[stat.event] = stat.count / total;
				return acc;
			},
			{} as Record<number, number>,
		);
	}

	/**
	 * Returns the uncertainty (entropy) for the given context ID.
	 */
	public uncertainty(id: number): number | null {
		const context = this.findContext(id);
		if (!context.statisticsSize) return null;

		let uncertainty = 0;
		for (let i = 0; i < context.statisticsSize; i++) {
			const frequency = context.statistics[i].count / context.count;
			if (frequency > 0) {
				uncertainty -= frequency * Math.log2(frequency);
			}
		}

		return uncertainty;
	}

	/**
	 * Returns the surprise for the given event and context ID.
	 */
	public surprise(id: number, event: number): number | null {
		const context = this.findContext(id);
		if (context.count === 0) {
			return null;
		}

		const statistic = this.findStatistic(context, event);
		if (statistic.count === 0) {
			return null;
		}

		const frequency = statistic.count / context.count;
		const surpriseValue = -Math.log2(frequency);

		return Object.is(surpriseValue, -0) ? 0 : surpriseValue;
	}

	/**
	 * Returns the frequency of the given event for the context ID.
	 */
	public frequency(id: number, event: number): number {
		const context = this.findContext(id);
		if (context.count == 0) {
			return 0;
		}

		const statistic = this.findStatistic(context, event);
		if (statistic.count == 0) {
			return 0;
		}

		return statistic.count / context.count;
	}
}
