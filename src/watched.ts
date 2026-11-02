/** A map that reports each write, so a reader can cache what it derives from the map. */
export class WatchedMap<K, V> extends Map<K, V> {
	readonly #changed: () => void;

	constructor(changed: () => void) {
		super();
		this.#changed = changed;
	}

	override set(key: K, value: V): this {
		this.#changed();
		return super.set(key, value);
	}

	override delete(key: K): boolean {
		this.#changed();
		return super.delete(key);
	}

	override clear(): void {
		this.#changed();
		super.clear();
	}
}

/** A set that reports each write, so a reader can cache what it derives from the set. */
export class WatchedSet<T> extends Set<T> {
	readonly #changed: () => void;

	constructor(changed: () => void) {
		super();
		this.#changed = changed;
	}

	override add(value: T): this {
		this.#changed();
		return super.add(value);
	}

	override delete(value: T): boolean {
		this.#changed();
		return super.delete(value);
	}

	override clear(): void {
		this.#changed();
		super.clear();
	}
}
