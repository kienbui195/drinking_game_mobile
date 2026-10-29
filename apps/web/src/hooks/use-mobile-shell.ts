import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Các hook làm web app trên trình duyệt điện thoại cư xử như app native: giữ màn hình sáng,
 * toàn màn hình, cài PWA và chặn nút back thoát khỏi app. Xem ~/Learning/MOBILE_WEB.md.
 */

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Giữ màn hình sáng khi `active`; trình duyệt nhả khóa khi tab ẩn nên phải xin lại khi quay về. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || lock) return;
      try {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => (lock = null));
        if (cancelled) void lock.release();
      } catch {
        /* Chế độ tiết kiệm pin có thể từ chối; không ảnh hưởng ván chơi. */
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [active]);
}

/** Fullscreen API: có trên Android Chrome, không có trên iPhone (ở đó dùng PWA). */
export function useFullscreen() {
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const [active, setActive] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
          .lock?.('portrait')
          .catch(() => {});
      }
    } catch {
      /* Trình duyệt từ chối khi không có thao tác chạm của người dùng. */
    }
  }, []);
  return { supported, active, toggle };
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

/** Gợi ý "Thêm vào màn hình chính": Android có prompt hệ thống, iOS chỉ hướng dẫn tay. */
export function useInstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [standalone, setStandalone] = useState(isStandalone);
  useEffect(() => {
    const capture = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const installed = () => {
      setEvent(null);
      setStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const install = useCallback(async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    setEvent(null);
  }, [event]);
  return { canInstall: !!event, install, standalone, ios };
}

/**
 * Nút back của Android (và cử chỉ vuốt mép) đi lùi lịch sử trình duyệt, tức là thoát app.
 * Giữ một mục lịch sử "đệm": mỗi lần back, gọi `handler` để đóng lớp trên cùng rồi đệm lại.
 * Khi không còn gì để đóng, lần back thứ hai trong 2 giây mới thực sự rời trang.
 */
export function useBackGuard(handler: () => boolean, onExitHint: () => void) {
  const ref = useRef({ handler, onExitHint });
  ref.current = { handler, onExitHint };
  useEffect(() => {
    let armedUntil = 0;
    history.pushState({ chamlyGuard: true }, '');
    const onPop = () => {
      if (ref.current.handler()) {
        history.pushState({ chamlyGuard: true }, '');
        return;
      }
      if (Date.now() < armedUntil) {
        history.back();
        return;
      }
      armedUntil = Date.now() + 2000;
      ref.current.onExitHint();
      history.pushState({ chamlyGuard: true }, '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}

/** Gọi `callback` mỗi khi tab quay lại hiển thị (mở khóa màn hình, chuyển app về). */
export function useOnVisible(callback: () => void) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'visible') ref.current();
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
}

/** Rung ngắn nếu máy hỗ trợ (Android); iOS bỏ qua im lặng. */
export const vibrate = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* noop */
  }
};
