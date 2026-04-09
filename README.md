# Realtime Chat (Next.js + Redis Pub/Sub)

This project implements a realtime chat using:

- Next.js App Router
- Redis Pub/Sub (compatible with Upstash Redis TCP endpoint)
- Server-Sent Events (SSE) for realtime delivery

## Quick Start

1. Copy env file:

```bash
cp .env.example .env.local
```

2. Set `REDIS_URL` in `.env.local`:

```env
REDIS_URL="rediss://default:<password>@<your-upstash-redis-host>:<port>"
```

3. Run:

```bash
npm install
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Architecture

### Flow

1. User sends a message from the client (`ChatClient`).
2. Client calls `POST /api/chat/messages`.
3. API route validates payload, writes to Redis list (history), and publishes to Redis channel.
4. Each connected browser has an open `EventSource` to `GET /api/chat/stream`.
5. Stream route subscribes to Redis channel and forwards each publish as SSE event to the client.
6. Client appends messages in real time.

### Why this structure

- **Redis Pub/Sub** gives low-latency fan-out to all subscribers.
- **SSE** is lightweight and perfect for one-way server -> client updates like chat timeline.
- **History list** in Redis solves the “new user joins and sees old messages” problem.
- **Split routes** (`messages` vs `stream`) keeps write and read-stream responsibilities clean.

## Project Structure

```txt
src/
  app/
    api/chat/messages/route.ts   # GET history + POST publish
    api/chat/stream/route.ts     # SSE endpoint backed by Redis subscribe
    chat-client.tsx              # Client UI + EventSource connection
    page.tsx                     # Renders chat client
  lib/
    chat.ts                      # Shared chat types, limits, validation helpers
    redis.ts                     # Redis connection helpers (publisher/subscriber)
```

## Endpoints

- `GET /api/chat/messages?room=general`
  - Returns last 50 messages for a room.
- `POST /api/chat/messages`
  - Body: `{ room, user, text }`
  - Saves + publishes one message.
- `GET /api/chat/stream?room=general`
  - Opens SSE stream.
  - Emits `ready`, `message`, and `error` events.

## Notes for Upstash

- Use the Redis TCP URL (`rediss://...`) so `ioredis` can subscribe/publish.
- If deployed behind a reverse proxy (e.g., Nginx), disable buffering for SSE.
- For large scale, you can move presence/typing to separate channels.
