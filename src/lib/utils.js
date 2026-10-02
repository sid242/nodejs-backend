export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run bounded parallel work without creating one promise per item. */
export async function forEachConcurrent(items, concurrency, worker) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

export const parseList = (csv) =>
  csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Make a user-supplied filename safe to embed in an S3 key. */
export const safeFilename = (name) =>
  name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-100);
