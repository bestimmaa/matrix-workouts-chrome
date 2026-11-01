/**
 * A list kept under one `chrome.storage.local` key: the shape both the excluded
 * rides and the rider's targets share. Reading drops anything unreadable rather than
 * throwing, because a broken entry must not stop the records from drawing. Writing
 * an empty list removes the key, so nothing is left behind once the rider clears it.
 */

/** Storage for one list, injected so the rules on top of it are tested without `chrome`. */
export interface ListStorage<T> {
  load(): Promise<unknown>;
  save(items: T[]): Promise<void>;
  clear(): Promise<void>;
}

export function chromeList<T>(key: string): ListStorage<T> {
  return {
    load: async () => (await chrome.storage.local.get(key))[key],
    save: (items) => chrome.storage.local.set({ [key]: items }),
    clear: () => chrome.storage.local.remove(key),
  };
}

/** What is stored: the valid entries, in `order`. */
export async function readList<T>(
  storage: ListStorage<T>,
  isValid: (value: unknown) => value is T,
  order: (a: T, b: T) => number,
): Promise<T[]> {
  const stored = await storage.load();
  return Array.isArray(stored) ? stored.filter(isValid).sort(order) : [];
}

/** Store `items`, or remove the key when there are none. */
export async function writeList<T>(storage: ListStorage<T>, items: T[]): Promise<void> {
  if (items.length === 0) await storage.clear();
  else await storage.save(items);
}

/**
 * Run read-modify-write changes one after another. Two quick clicks (× on two
 * records) would otherwise both read the list before either saved, and the second
 * save would silently undo the first. This orders the writes made from one page;
 * a tab and the options page are separate pages and can still interleave, which
 * needs two people's worth of clicking at once.
 */
export function serially(): <T>(change: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return (change) => {
    const run = last.then(change, change);
    last = run.catch(() => undefined);
    return run;
  };
}
