export const DEFAULT_CHAT_ROOM = "general";
export const MAX_MESSAGE_LENGTH = 400;
export const MAX_USERNAME_LENGTH = 32;
export const MESSAGE_HISTORY_LIMIT = 50;
export const MAX_ROOM_LENGTH = 64;

export type ChatMessage = {
  id: string;
  room: string;
  user: string;
  text: string;
  createdAt: string;
};

type ChatPayload = {
  room: string;
  user: string;
  text: string;
};

function cleanString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function normalizeRoom(rawRoom: unknown): string {
  const room = cleanString(rawRoom).toLowerCase();

  if (!room) return DEFAULT_CHAT_ROOM;

  return room
    .slice(0, MAX_ROOM_LENGTH)
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-");
}

export function parsePayload(input: unknown): ChatPayload {
  const source = input as Record<string, unknown>;
  const room = normalizeRoom(source?.room);
  const user = cleanString(source?.user).slice(0, MAX_USERNAME_LENGTH);
  const text = cleanString(source?.text).slice(0, MAX_MESSAGE_LENGTH);

  if (!user) {
    throw new Error("Username is required.");
  }

  if (!text) {
    throw new Error("Message text is required.");
  }

  return { room, user, text };
}

export function toRedisChannel(room: string): string {
  return `chat:room:${normalizeRoom(room)}`;
}

export function toHistoryKey(room: string): string {
  return `${toRedisChannel(room)}:history`;
}
