export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Run bounded parallel work without creating one promise per item. */
export async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<any> | any,
): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) {
        await worker(item);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

export const parseList = (csv: string): string[] =>
  csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Make a user-supplied filename safe to embed in an S3 key. */
export const safeFilename = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-100);
