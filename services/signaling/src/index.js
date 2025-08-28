import Fastify from 'fastify';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const fastify = Fastify({ logger: true });
fastify.use(cors());

const server = createServer(fastify as any);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 8787;
const roomFor = (channelId) => `channel:${channelId}`;

// naive in-memory queue per channel for MVP
const queues = new Map(); // channelId -> [userId]
const currentBroadcaster = new Map(); // channelId -> userId

function verifyToken(token) {
  if (!token) return null;
  try {
    // For MVP we don't verify signature; in prod use public key
    const decoded = jwt.decode(token);
    return decoded;
  } catch (e) { return null; }
}

io.on('connection', (socket) => {
  socket.on('join-channel', ({ channelId, token }) => {
    const user = verifyToken(token) || { id: socket.id };
    socket.data.user = user;
    socket.data.channelId = channelId;
    socket.join(roomFor(channelId));
    io.to(roomFor(channelId)).emit('presence', { userId: user.id, type: 'join' });
    io.to(socket.id).emit('broadcaster-status', { broadcaster: currentBroadcaster.get(channelId) || null });
  });

  socket.on('request-control', ({ channelId }) => {
    const userId = socket.data?.user?.id;
    if (!userId) return;
    const q = queues.get(channelId) || [];
    if (!q.includes(userId)) q.push(userId);
    queues.set(channelId, q);
    io.to(roomFor(channelId)).emit('queue:update', q);
    // if no current broadcaster, grant immediately
    if (!currentBroadcaster.get(channelId)) {
      const next = q.shift();
      queues.set(channelId, q);
      currentBroadcaster.set(channelId, next);
      io.to(roomFor(channelId)).emit('control:granted', { userId: next });
      io.to(roomFor(channelId)).emit('broadcaster-status', { broadcaster: next });
    }
  });

  socket.on('release-control', ({ channelId }) => {
    const current = currentBroadcaster.get(channelId);
    const userId = socket.data?.user?.id;
    if (current && current === userId) {
      currentBroadcaster.delete(channelId);
      const q = queues.get(channelId) || [];
      const next = q.shift();
      queues.set(channelId, q);
      if (next) {
        currentBroadcaster.set(channelId, next);
        io.to(roomFor(channelId)).emit('control:granted', { userId: next });
        io.to(roomFor(channelId)).emit('broadcaster-status', { broadcaster: next });
      } else {
        io.to(roomFor(channelId)).emit('control:cleared');
        io.to(roomFor(channelId)).emit('broadcaster-status', { broadcaster: null });
      }
    }
  });

  // WebRTC signaling relay
  socket.on('signal', ({ channelId, toUserId, data }) => {
    // find socket by userId (MVP: userId === socket.id unless JWT)
    const target = [...io.sockets.sockets.values()].find(s => (s.data?.user?.id === toUserId));
    if (target) target.emit('signal', { fromUserId: socket.data?.user?.id, data });
  });

  socket.on('disconnect', () => {
    const channelId = socket.data?.channelId;
    const userId = socket.data?.user?.id;
    if (!channelId || !userId) return;
    // remove from queue
    const q = queues.get(channelId) || [];
    const idx = q.indexOf(userId);
    if (idx !== -1) q.splice(idx, 1);
    queues.set(channelId, q);
    // if broadcaster, release
    if (currentBroadcaster.get(channelId) === userId) {
      currentBroadcaster.delete(channelId);
      const next = q.shift();
      queues.set(channelId, q);
      if (next) {
        currentBroadcaster.set(channelId, next);
        io.to(roomFor(channelId)).emit('control:granted', { userId: next });
        io.to(roomFor(channelId)).emit('broadcaster-status', { broadcaster: next });
      } else {
        io.to(roomFor(channelId)).emit('control:cleared');
        io.to(roomFor(channelId)).emit('broadcaster-status', { broadcaster: null });
      }
    }
    io.to(roomFor(channelId)).emit('presence', { userId, type: 'leave' });
  });
});

fastify.get('/health', async () => ({ ok: true }));

server.listen(PORT, () => {
  console.log(`Signaling server on :${PORT}`);
});
