import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';

export function docsRouter() {
  const router = Router();

  // Serve raw OpenAPI 3.0 specification JSON
  router.get('/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(openApiDocument);
  });

  const swaggerUiOptions = {
    customSiteTitle: 'Node Scalable Foundation API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      tryItOutEnabled: true,
    },
  };

  // Serve Swagger UI
  router.use('/', swaggerUi.serve, swaggerUi.setup(openApiDocument, swaggerUiOptions));

  return router;
}

export { openApiDocument };
