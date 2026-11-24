import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openApiDocument } from '@/docs/openapi';

const outputPath = resolve(process.cwd(), 'openapi.json');
writeFileSync(outputPath, JSON.stringify(openApiDocument, null, 2), 'utf8');
console.log(`Exported OpenAPI 3.0.3 specification to ${outputPath}`);
