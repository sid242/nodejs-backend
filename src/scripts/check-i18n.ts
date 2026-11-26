import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/i18n/locales';

const LOCALES_DIR = path.resolve(import.meta.dirname, '../locales');

function extractKeys(
  obj: Record<string, unknown>,
  prefix = '',
): Map<string, { value: string; placeholders: string[] }> {
  const result = new Map<string, { value: string; placeholders: string[] }>();
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      const placeholders = (v.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || []).sort();
      result.set(fullKey, { value: v, placeholders });
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const nested = extractKeys(v as Record<string, unknown>, fullKey);
      for (const [nk, nv] of nested.entries()) {
        result.set(nk, nv);
      }
    }
  }
  return result;
}

function checkParity(): void {
  const defaultDir = path.join(LOCALES_DIR, DEFAULT_LOCALE);
  if (!fs.existsSync(defaultDir)) {
    console.error(`Default locale directory ${defaultDir} does not exist!`);
    process.exit(1);
  }

  const jsonFiles = fs.readdirSync(defaultDir).filter((f) => f.endsWith('.json'));
  let hasErrors = false;

  for (const targetLocale of SUPPORTED_LOCALES) {
    if (targetLocale === DEFAULT_LOCALE) continue;
    const targetDir = path.join(LOCALES_DIR, targetLocale);

    if (!fs.existsSync(targetDir)) {
      console.error(`[i18n:check] Missing locale directory for '${targetLocale}' at ${targetDir}`);
      hasErrors = true;
      continue;
    }

    for (const file of jsonFiles) {
      const defaultFilePath = path.join(defaultDir, file);
      const targetFilePath = path.join(targetDir, file);

      if (!fs.existsSync(targetFilePath)) {
        console.error(`[i18n:check] Missing file in '${targetLocale}': ${file}`);
        hasErrors = true;
        continue;
      }

      const defaultContent = JSON.parse(fs.readFileSync(defaultFilePath, 'utf-8'));
      const targetContent = JSON.parse(fs.readFileSync(targetFilePath, 'utf-8'));

      const defaultKeys = extractKeys(defaultContent);
      const targetKeys = extractKeys(targetContent);

      // Check missing keys
      for (const [key, defVal] of defaultKeys.entries()) {
        const targetEntry = targetKeys.get(key);
        if (!targetEntry || !targetEntry.value.trim()) {
          console.error(
            `[i18n:check] Locale '${targetLocale}' is missing non-empty key '${key}' in ${file}`,
          );
          hasErrors = true;
        } else {
          // Check placeholder parity
          const defP = defVal.placeholders.join(',');
          const tgtP = targetEntry.placeholders.join(',');
          if (defP !== tgtP) {
            console.error(
              `[i18n:check] Placeholder mismatch in '${targetLocale}' for '${key}' in ${file}: expected [${defP}] but got [${tgtP}]`,
            );
            hasErrors = true;
          }
        }
      }

      // Check extra/unrecognized keys
      for (const key of targetKeys.keys()) {
        if (!defaultKeys.has(key)) {
          console.error(
            `[i18n:check] Extraneous key '${key}' in '${targetLocale}' not found in default '${DEFAULT_LOCALE}' for ${file}`,
          );
          hasErrors = true;
        }
      }
    }
  }

  if (hasErrors) {
    console.error('\n❌ i18n parity check failed.');
    process.exit(1);
  } else {
    console.log(
      `\n✅ i18n parity check passed for all supported locales: ${SUPPORTED_LOCALES.join(', ')}`,
    );
  }
}

checkParity();
