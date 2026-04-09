# Realtime Chat (Upstash-Style, No Upstash SDK)

This project follows the same flow as Upstash Realtime quickstart, but uses local code with `ioredis`.

## Quickstart

1. Set env values:

```env
REDIS_URL="rediss://default:<password>@<redis-host>:<port>"
```

1. Run:

```bash
npm install
npm run dev
```

1. Open [http://localhost:3000](http://localhost:3000)

## API Shape (similar to docs)

- `src/lib/realtime.ts`
  - `realtime.emit(event, data, { channel })`
  - `realtime.history(channel, limit)`
- `src/lib/realtime-handler.ts`
  - `handle({ realtime })` for SSE route handler
- `src/lib/realtime-client.tsx`
  - `RealtimeProvider`
  - `createRealtime<Events>()`

## Routes

- `GET /api/realtime`
  - Query:
    - `channel=general`
    - `events=chat.message`
  - Streams SSE events.
- `POST /api/notify`
  - Body:
    - `{ channel, user, data: { text } }`
  - Emits `chat.message`.
- `GET /api/history?channel=general`
  - Loads message history.

## Project Structure

```txt
src/
  app/
    api/realtime/route.ts      # GET = handle({ realtime })
    api/notify/route.ts        # emit("chat.message", ...)
    api/history/route.ts       # history endpoint
    providers.tsx              # wraps app with RealtimeProvider
    chat-client.tsx            # useRealtime(...) + send message
  lib/
    realtime.ts                # local Realtime class + typed events
    realtime-handler.ts        # SSE handler factory
    realtime-client.tsx        # RealtimeProvider + createRealtime hook
    realtime-app.ts            # typed useRealtime export
    redis.ts                   # ioredis publisher/subscriber
```

## Notes

- This is HTTP + Redis Pub/Sub + SSE.
- No Upstash runtime package is used.
- Behavior mirrors docs: typed event names, provider + hook, `GET /api/realtime`.

```mermaid
flowchart LR
    A[Client A] -->|POST /api/notify| N[API Notify]
    B[Client B] -->|POST /api/notify| N

    A -->|GET /api/realtime?channel=general&events=chat.message| R[API Realtime SSE]
    B -->|GET /api/realtime?channel=general&events=chat.message| R

    A -->|GET /api/history?channel=general| H[API History]
    B -->|GET /api/history?channel=general| H

    N -->|emit chat.message| RT[Realtime Core]
    RT -->|LPUSH + LTRIM| HL[(Redis History\nrt:history:general)]
    RT -->|PUBLISH| CH[(Redis Channel\nrt:channel:general)]

    H -->|doc lich su| HL
    R -->|SUBSCRIBE| CH

    R -->|SSE event: chat.message| A
    R -->|SSE event: chat.message| B
```



```mermaid
sequenceDiagram
    participant U1 as Nguoi dung A
    participant U2 as Nguoi dung B
    participant UI as Chat Client
    participant HIS as API /api/history
    participant NTF as API /api/notify
    participant SSE as API /api/realtime
    participant REDIS as Redis

    U1->>UI: Mo app
    UI->>HIS: GET /api/history?channel=general
    HIS->>REDIS: LRANGE rt:history:general
    REDIS-->>HIS: danh sach tin nhan cu
    HIS-->>UI: tra ve history

    UI->>SSE: GET /api/realtime?channel=general&events=chat.message
    SSE->>REDIS: SUBSCRIBE rt:channel:general

    U2->>UI: Gui tin nhan
    UI->>NTF: POST /api/notify {channel,user,data.text}
    NTF->>REDIS: LPUSH/LTRIM rt:history:general
    NTF->>REDIS: PUBLISH rt:channel:general
    REDIS-->>SSE: message moi
    SSE-->>UI: SSE event chat.message
    UI-->>U1: Hien thi realtime
    UI-->>U2: Hien thi realtime
```



