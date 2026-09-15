import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import type { Reply, Session } from '@chamly/shared';

export const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:45100').replace(
  /\/$/,
  '',
);
const key = 'chamly.session.v1';
const tokenKey = 'chamly.token.v1';
export async function loadSession(): Promise<Session | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw);
    const token = Platform.OS === 'web' ? stored.token : await SecureStore.getItemAsync(tokenKey);
    return typeof token === 'string' && typeof stored.playerId === 'string'
      ? { ...stored, token }
      : null;
  } catch {
    return null;
  }
}
export async function saveSession(session: Session | null) {
  if (!session) {
    await AsyncStorage.removeItem(key);
    if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(tokenKey);
    return;
  }
  if (Platform.OS !== 'web') {
    await SecureStore.setItemAsync(tokenKey, session.token);
    const { token: _, ...rest } = session;
    await AsyncStorage.setItem(key, JSON.stringify(rest));
  } else await AsyncStorage.setItem(key, JSON.stringify(session));
}
export function connect(token: string) {
  return io(apiUrl, { auth: { token }, reconnection: true, timeout: 10_000, autoConnect: false });
}
export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
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
