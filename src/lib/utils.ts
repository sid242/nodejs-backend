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

export const generateSlug = (value: string): string => {
  return (
    value
      ?.toLowerCase()
      ?.replace(/[^a-z0-9\s-/]/g, '') // Remove special characters except spaces, dashes, slashes
      ?.trim()
      ?.replace(/[\s/-]+/g, '-') // Replace spaces, slashes, and multiple dashes with a single dash
      ?.replace(/^-+|-+$/g, '') || ''
  ); // Remove leading and trailing dashes
};

export const slugify = generateSlug;
