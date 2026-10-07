---
name: socket-events
description: >-
  Use this skill when adding real-time WebSocket events, room subscription flows, authorization guards,
  or pushing events from background workers using the Socket.IO Redis emitter.
---

# Socket.IO Real-time Events & Emitters Runbook

This guide covers real-time WebSocket communication in the backend.

---

## 1. Socket Architecture & Handshake

- Handshake Authentication: Clients connect with JWT token: `io(SERVER_URL, { auth: { token } })`.
- User Room: Upon connecting, the user is automatically joined to room `user:<userId>`.
- Cross-Replica Sync: `@socket.io/redis-adapter` syncs room events across all Express API instances.

---

## 2. Adding Client-to-Server Events

Edit `src/sockets/index.js` inside `io.on('connection', (socket) => { ... })`:

```javascript
const documentSchema = z.object({ docId: z.string().uuid() });

socket.on('doc:join', async (payload, ack) => {
  try {
    const { docId } = documentSchema.parse(payload);
    
    // 1. Authorize: Ensure user has read access
    // const allowed = await checkAccess(userId, docId);
    // if (!allowed) throw new Error('Forbidden');

    // 2. Join room
    socket.join(`doc:${docId}`);
    ack?.({ ok: true });
  } catch (err) {
    ack?.({ ok: false, error: err.message });
  }
});
```

---

## 3. Emitting Events from Workers / Services (Worker -> Client)

Workers running in `src/worker.js` cannot access the Socket.IO server directly. Instead, they publish events via the Redis Emitter (`src/sockets/emitter.js`).

### Targeting a Specific User:
```javascript
import { emitToUser } from '../sockets/emitter.js';

emitToUser(userId, 'notification:received', {
  id: 'notif-123',
  title: 'Your file is ready',
  timestamp: Date.now(),
});
```

### Broadcasting to a Shared Room:
```javascript
import { emitToRoom } from '../sockets/emitter.js';

emitToRoom(`doc:${docId}`, 'doc:updated', {
  updatedBy: userId,
  changes: [{ op: 'insert', pos: 0, text: 'Hello' }],
});
```

---

## 4. Rate Limiting & Safety

- Global socket connection limits are enforced per IP/user (`SOCKET_CONNECTIONS_PER_MINUTE`).
- Inbound event flood protection limits users to `SOCKET_EVENTS_PER_SECOND`.
- Never trust socket inputs without parsing with Zod schemas.
