import fs from 'node:fs';
import path from 'node:path';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

let cachedLatestTag: string | null = null;
let cachedAllTags: Set<string> | null = null;

/**
 * Loads drizzle/meta/_journal.json and caches the migration tags.
 */
function loadJournal(): { latestTag: string; allTags: Set<string> } {
  if (cachedLatestTag && cachedAllTags) {
    return { latestTag: cachedLatestTag, allTags: cachedAllTags };
  }

  try {
    const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
    if (fs.existsSync(journalPath)) {
      const content = fs.readFileSync(journalPath, 'utf-8');
      const parsed = JSON.parse(content) as Journal;
      if (parsed.entries && parsed.entries.length > 0) {
        const lastEntry = parsed.entries[parsed.entries.length - 1];
        cachedLatestTag = lastEntry?.tag ?? '1.0.0';
        cachedAllTags = new Set(parsed.entries.map((e) => e.tag));
        return { latestTag: cachedLatestTag, allTags: cachedAllTags };
      }
    }
  } catch {
    // Fallback if file not accessible
  }

  cachedLatestTag = '1.0.0';
  cachedAllTags = new Set(['1.0.0']);
  return { latestTag: cachedLatestTag, allTags: cachedAllTags };
}

/**
 * Returns the latest schema migration tag defined in drizzle journal.
 */
export function getLatestSchemaTag(): string {
  return loadJournal().latestTag;
}

/**
 * Checks if a given schema version is equal to the latest migration tag.
 */
export function isSchemaVersionCurrent(schemaVersion: string | null | undefined): boolean {
  if (!schemaVersion) return false;
  const { latestTag } = loadJournal();
  return schemaVersion === latestTag;
}

/**
 * Returns all recognized migration tags from drizzle journal.
 */
export function getAllSchemaTags(): Set<string> {
  return loadJournal().allTags;
}
