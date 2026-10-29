import { useState } from 'react';
import { DownloadIcon, MaximizeIcon, MinimizeIcon, XIcon } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { isStandalone, useFullscreen, useInstallPrompt } from '@/hooks/use-mobile-shell';

/** Nút bật/tắt toàn màn hình; ẩn khi trình duyệt không hỗ trợ hoặc app đã chạy dạng PWA. */
export function FullscreenButton() {
  const { supported, active, toggle } = useFullscreen();
  if (!supported || isStandalone()) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={active ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
      onClick={() => void toggle()}
    >
      {active ? <MinimizeIcon /> : <MaximizeIcon />}
    </Button>
  );
}

const dismissedKey = 'chamly.install-dismissed.v1';

/** Gợi ý cài app lên màn hình chính để chơi toàn màn hình, không còn thanh trình duyệt. */
export function InstallBanner() {
  const { canInstall, install, standalone, ios } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissedKey) === '1';
    } catch {
      return false;
    }
  });
  if (standalone || dismissed || (!canInstall && !ios)) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissedKey, '1');
    } catch {
      /* Không lưu được thì lần sau hiện lại, không sao. */
    }
  };
  return (
    <Alert>
      <DownloadIcon />
      <AlertTitle>Cài Chạm Ly như một app</AlertTitle>
      <AlertDescription>
        {ios
          ? 'Bấm nút Chia sẻ của Safari rồi chọn “Thêm vào MH chính” để chơi toàn màn hình.'
          : 'Thêm vào màn hình chính để chơi toàn màn hình, không còn thanh trình duyệt.'}
        {canInstall && (
          <Button size="sm" className="mt-2" onClick={() => void install()}>
            Cài đặt
          </Button>
        )}
      </AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon-xs" aria-label="Ẩn gợi ý cài đặt" onClick={dismiss}>
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  );
}
