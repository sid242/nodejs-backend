import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry, bearerAuth, SuccessEnvelope, ErrorEnvelope } from '@/docs/helpers.js';
import { registerHealthDocs } from '@/docs/routes/health.docs.js';
import { registerUsersDocs } from '@/docs/routes/users.docs.js';
import { registerAuthDocs } from '@/docs/routes/auth.docs.js';
import { registerFilesDocs } from '@/docs/routes/files.docs.js';
import { registerTenantsDocs } from '@/docs/routes/tenants.docs.js';
import { registerRbacDocs } from '@/docs/routes/rbac.docs.js';

// ---------------------------------------------------------------------------
// Register Domain Documentation Modules
// ---------------------------------------------------------------------------
registerHealthDocs(registry);
registerUsersDocs(registry);
registerAuthDocs(registry);
registerFilesDocs(registry);
registerTenantsDocs(registry);
registerRbacDocs(registry);

// ---------------------------------------------------------------------------
// OpenAPI Document Builder
// ---------------------------------------------------------------------------
export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Node Scalable Foundation API',
      version: '1.0.0',
      description:
        'Production-grade RESTful API with PostgreSQL, Redis caching, BullMQ queues, AWS S3/SES, and WebSockets.',
      contact: {
        name: 'Backend Engineering Team',
      },
    },
    servers: [
      {
        url: '/',
        description: 'Current Environment Server',
      },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication, registration, JWT tokens & password recovery' },
      { name: 'Users', description: 'User profile management & administrative user directory' },
      {
        name: 'Tenants',
        description: 'Multi-tenant organization lifecycle and membership management',
      },
      {
        name: 'RBAC',
        description: 'Dynamic Role-Based Access Control and custom permission assignment',
      },
      { name: 'Files', description: 'S3 direct presigned uploads, confirmation & downloads' },
      { name: 'Health', description: 'Operational liveness & readiness health probes' },
    ],
  });
}

export const openApiDocument = generateOpenApiDocument();

export { registry, bearerAuth, SuccessEnvelope, ErrorEnvelope };
