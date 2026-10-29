import { io, type Socket } from 'socket.io-client';
import type { Reply, Session } from '@chamly/shared';

const configuredApiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:45100';
const browserHostname = globalThis.location?.hostname;
const privateBrowserHost =
  browserHostname &&
  (browserHostname === 'localhost' ||
    browserHostname === '127.0.0.1' ||
    /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(browserHostname));
// In development, follow the LAN hostname used to open the web app. A production build served
// locally uses Caddy's same-origin API proxy instead of accidentally contacting the dev backend.
export const apiUrl = (
  privateBrowserHost
    ? configuredApiUrl.startsWith('https://')
      ? globalThis.location.origin
      : `http://${browserHostname}:45100`
    : configuredApiUrl
).replace(/\/$/, '');
const key = 'chamly.session.v1';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    return typeof stored.token === 'string' && typeof stored.playerId === 'string' ? stored : null;
  } catch {
    return null;
  }
}
export function saveSession(session: Session | null) {
  if (session) localStorage.setItem(key, JSON.stringify(session));
  else localStorage.removeItem(key);
}
export function connect(token: string) {
  return io(apiUrl, { auth: { token }, reconnection: true, timeout: 10_000, autoConnect: false });
}
export class RequestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export function request<T>(socket: Socket, event: string, body: unknown = {}): Promise<T> {
  if (!socket.connected)
    return Promise.reject(new RequestError('OFFLINE', 'Chưa kết nối server. Hãy chờ kết nối lại.'));
  return new Promise((resolve, reject) => {
    socket.timeout(12_000).emit(event, body, (error: Error | null, reply: Reply<T>) => {
      if (error)
        reject(
          new RequestError('TIMEOUT', 'Chưa nhận được phản hồi. Đang đồng bộ lại trạng thái.'),
        );
      else if (!reply?.ok)
        reject(new RequestError(reply?.code ?? 'SERVER_ERROR', reply?.message ?? 'Lỗi server.'));
      else resolve(reply.data);
    });
  });
}
