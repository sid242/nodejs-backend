import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const digest = (s) => createHash('sha256').update(s).digest();
const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));

export function basicAuth(req, res, next) {
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
    if (
      safeEqual(user, env.BULL_BOARD_USER) &&
      safeEqual(rest.join(':'), env.BULL_BOARD_PASSWORD)
    ) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="queues"').status(401).end();
}
