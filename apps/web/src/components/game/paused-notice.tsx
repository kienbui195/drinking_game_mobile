import { WifiOffIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

// Ván chỉ tạm dừng ở phía giao diện: state trên server giữ nguyên, không có hành động nào
// được gửi đi khi lớp phủ này đang hiện.
export function PausedNotice({
  names,
  host,
  onContinue,
}: {
  names: string[];
  host: boolean;
  onContinue: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onContinue()}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100%-2rem)] sm:max-w-sm">
        <DialogHeader>
          <Badge variant="outline" className="text-warning border-warning/40 w-fit">
            <WifiOffIcon data-icon="inline-start" />
            VÁN ĐANG TẠM DỪNG
          </Badge>
          <DialogTitle className="text-xl font-bold">
            {names.length === 1
              ? `${names[0]} đang mất kết nối`
              : `${names.length} người đang mất kết nối`}
          </DialogTitle>
          <DialogDescription className="leading-6">
            Hiện trạng ván được giữ nguyên: lượt, bài đã mở và thống kê không thay đổi. Ván tự chạy
            tiếp ngay khi mọi người kết nối lại.
          </DialogDescription>
        </DialogHeader>
        {names.length > 1 && (
          <ul className="scroll-area flex max-h-36 flex-col gap-2">
            {names.map((name) => (
              <li key={name} className="text-foreground/90">
                ⚪ {name}
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-sm leading-6">
          {host
            ? 'Nếu không chờ được, chủ phòng có thể tiếp tục ván. Người mất kết nối vẫn giữ chỗ và có thể quay lại; dùng “Bỏ lượt hiện tại” nếu ván dừng ở lượt của họ.'
            : 'Đang chờ chủ phòng quyết định.'}
        </p>
        <DialogFooter className="mx-0 mb-0 rounded-none border-0 bg-transparent p-0">
          <Button variant="secondary" onClick={onContinue}>
            {host ? 'Vẫn tiếp tục ván' : 'Ẩn cảnh báo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
