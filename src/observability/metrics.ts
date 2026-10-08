import { Router, type Request, type Response, type NextFunction } from 'express';
import client from '@prometheus-io/client';

client.collectDefaultMetrics(); // event loop lag, heap, GC, etc.

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl}${(req.route as any).path}` : 'unmatched';
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}

// Expose on an internal-only path/port: nginx config denies /metrics publicly.
export const metricsRouter = Router().get('/', async (_req: Request, res: Response) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
