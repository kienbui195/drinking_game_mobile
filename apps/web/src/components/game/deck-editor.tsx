import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { categoryLabels, packById, type Card as GameCard } from '@chamly/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { deckCsvTemplate, exportDeckCsv, importDeckCsv } from '@/lib/deck-csv';
import { pickDeckCsv, saveDeckCsv } from '@/lib/deck-file';
import { newId } from '@/lib/id';

/**
 * Trình biên tập bộ bài, mở toàn màn hình như một trang riêng: header và footer bám hai đầu,
 * chỉ khối giữa cuộn. Mọi thay đổi nằm trong bản nháp cho tới khi bấm "Lưu bộ bài".
 */
export function DeckEditor({
  cards,
  editable,
  packId,
  onClose,
  onSave,
  description,
}: {
  cards: GameCard[];
  editable: boolean;
  packId: string;
  onClose: () => void;
  onSave: (cards: GameCard[]) => Promise<boolean>;
  description?: string;
}) {
  const pack = packById(packId);
  const [draft, setDraft] = useState(() => cards.map((c) => ({ ...c })));
  const [editing, setEditing] = useState<GameCard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState(false);
  async function exportCsv(template = false) {
    try {
      await saveDeckCsv(
        `${packId}-${template ? 'mau' : 'bo-bai'}.csv`,
        template ? deckCsvTemplate() : exportDeckCsv(packId, draft),
      );
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không xuất được file CSV.');
    }
  }
  async function importCsv() {
    setError('');
    try {
      const csv = await pickDeckCsv();
      if (csv === null) return;
      setDraft(importDeckCsv(csv, packId));
      setImported(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đọc được file CSV.');
    }
  }
  function add() {
    setEditing({
      id: newId(),
      title: '',
      category: pack.categories[0],
      description: '',
      penalty: '',
      drinksCount: 1,
    });
  }
  function update() {
    if (!editing) return;
    if (!editing.title.trim() || !editing.description.trim() || !editing.penalty.trim()) {
      setError('Điền đủ tên, nội dung và hình phạt.');
      return;
    }
    if (
      !Number.isInteger(editing.drinksCount) ||
      editing.drinksCount < 0 ||
      editing.drinksCount > 20 ||
      (editing.hasTimer &&
        (!Number.isInteger(editing.timerSeconds) ||
          !editing.timerSeconds ||
          editing.timerSeconds > 600))
    ) {
      setError(`Số ${pack.unitLabel}: 0–20. Đồng hồ: 1–600 giây.`);
      return;
    }
    const card = {
      ...editing,
      title: editing.title.trim(),
      description: editing.description.trim(),
      penalty: editing.penalty.trim(),
    };
    setDraft((old) =>
      old.some((c) => c.id === card.id)
        ? old.map((c) => (c.id === card.id ? card : c))
        : [...old, card],
    );
    setEditing(null);
    setError('');
  }
  async function save() {
    setBusy(true);
    try {
      if (await onSave(draft)) onClose();
      else setError('Chưa lưu được. Đóng bộ bài để xem thông báo và thử lại.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được bộ bài.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="data-open:slide-in-from-bottom-8 data-open:zoom-in-100 top-0 left-0 flex h-dvh max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 ring-0 sm:max-w-full"
      >
        {/* Cột giữa rộng tối đa như khung app; chừa tai thỏ / thanh home bằng safe-area. */}
        <div className="bg-background mx-auto flex h-full w-full max-w-[430px] flex-col pt-[env(safe-area-inset-top)]">
          <DialogHeader className="border-border shrink-0 gap-2 border-b px-4 pt-2 pb-3">
            <DialogTitle className="text-xl font-bold">
              {editing ? 'Biên tập lá bài' : `Bộ bài · ${draft.length} lá`}
            </DialogTitle>
            <DialogDescription className="leading-6">
              {editing
                ? 'Điền nội dung lá bài rồi bấm Xong lá bài để đưa vào bản nháp.'
                : editable
                  ? (description ??
                    'Bản sao riêng của phòng. Thay đổi chỉ có hiệu lực sau khi lưu bộ bài.')
                  : 'Nội dung bộ bài của phòng. Thứ tự bài úp được giữ kín trên server.'}
            </DialogDescription>
            {!!error && (
              <Alert variant="destructive">
                <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
              </Alert>
            )}
            {imported && !editing && (
              <p className="text-success text-sm">
                Đã nạp bản nháp từ CSV. Bấm “Lưu bộ bài” để áp dụng lên server.
              </p>
            )}
            {editable && !editing && (
              <Button onClick={add} disabled={draft.length >= 200}>
                <PlusIcon data-icon="inline-start" />
                Thêm lá mới
              </Button>
            )}
          </DialogHeader>

          <div className="scroll-area flex min-h-0 flex-1 flex-col gap-4 p-4 pb-6">
            {editing ? (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="card-title">Tên lá bài</FieldLabel>
                  <Input
                    id="card-title"
                    maxLength={100}
                    autoComplete="off"
                    enterKeyHint="next"
                    value={editing.title}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel>Loại lá bài</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    spacing={2}
                    className="flex-wrap"
                    value={editing.category}
                    onValueChange={(category) =>
                      category &&
                      setEditing({ ...editing, category: category as GameCard['category'] })
                    }
                  >
                    {pack.categories.map((category) => (
                      <ToggleGroupItem key={category} value={category} className="h-10 px-4">
                        {categoryLabels[category]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="card-description">Nội dung</FieldLabel>
                  <Textarea
                    id="card-description"
                    maxLength={1500}
                    value={editing.description}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="card-keepable">🎒 Cất được vào túi thần kỳ</FieldLabel>
                    <FieldDescription>Người lật được để dành lá này cho vòng sau.</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="card-keepable"
                    checked={!!editing.keepable}
                    onCheckedChange={(on) =>
                      setEditing({ ...editing, keepable: on ? true : undefined })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="card-answer">Đáp án tham chiếu (có thể bỏ trống)</FieldLabel>
                  <Textarea
                    id="card-answer"
                    maxLength={500}
                    value={editing.answer ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, answer: e.target.value || undefined })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="card-penalty">Hình phạt / kết quả</FieldLabel>
                  <Textarea
                    id="card-penalty"
                    maxLength={500}
                    value={editing.penalty}
                    onChange={(e) => setEditing({ ...editing, penalty: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="card-drinks">{`Số ${pack.unitLabel} mặc định (0–20)`}</FieldLabel>
                    <Input
                      id="card-drinks"
                      inputMode="numeric"
                      value={String(editing.drinksCount)}
                      onChange={(e) =>
                        setEditing({ ...editing, drinksCount: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="card-timer">Đồng hồ (giây, 0 = không dùng)</FieldLabel>
                    <Input
                      id="card-timer"
                      inputMode="numeric"
                      value={String(editing.timerSeconds ?? 0)}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          hasTimer: Number(e.target.value) > 0,
                          timerSeconds: Number(e.target.value) || undefined,
                        })
                      }
                    />
                  </Field>
                </div>
              </FieldGroup>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg font-bold">
                      Chỉnh sửa hàng loạt bằng CSV
                    </CardTitle>
                    <CardDescription className="leading-6">
                      Xuất bộ hiện tại rồi mở bằng Excel/Google Sheets. Giữ nguyên dòng header và
                      packId; để trống id cho lá mới. CSV phải có 2–200 lá, category đúng chủ đề,
                      drinksCount 0–20, hasTimer/keepable là true/false; timerSeconds 1–600 nếu
                      hasTimer=true. Tải về dưới dạng CSV UTF-8, dấu phẩy phân cách cột.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <Button variant="secondary" onClick={() => void exportCsv()}>
                      Xuất bộ bài CSV
                    </Button>
                    {editable && (
                      <>
                        <Button variant="secondary" onClick={() => void exportCsv(true)}>
                          Tải mẫu CSV
                        </Button>
                        <Button variant="secondary" onClick={() => void importCsv()}>
                          Nhập file CSV
                        </Button>
                        <p className="text-muted-foreground text-sm leading-6">
                          Import thay toàn bộ bản nháp, không ghi ngay lên server. File sai sẽ không
                          làm mất bản nháp hiện tại.
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>
                {draft.map((card, index) => (
                  <Card key={card.id}>
                    <CardHeader>
                      <CardDescription className="text-primary text-xs font-bold">
                        {index + 1} · {categoryLabels[card.category]}
                      </CardDescription>
                      <CardTitle className="text-lg font-bold">{card.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 leading-6">
                      <p className="text-muted-foreground">{card.description}</p>
                      <p className="text-warning">{card.penalty}</p>
                      {card.keepable && (
                        <Badge variant="outline" className="text-success border-success/40">
                          🎒 Cất được vào túi thần kỳ
                        </Badge>
                      )}
                    </CardContent>
                    {editable && (
                      <CardFooter className="gap-2 border-0 bg-transparent *:flex-1">
                        <Button variant="secondary" onClick={() => setEditing({ ...card })}>
                          Sửa
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => setDraft((old) => old.filter((c) => c.id !== card.id))}
                        >
                          Xóa
                        </Button>
                      </CardFooter>
                    )}
                  </Card>
                ))}
              </>
            )}
          </div>

          <div className="border-border bg-background pb-safe flex shrink-0 flex-col gap-3 border-t px-4 pt-3">
            {editing ? (
              <>
                <Button onClick={update}>Xong lá bài</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(null);
                    setError('');
                  }}
                >
                  Hủy sửa lá
                </Button>
              </>
            ) : (
              <>
                {editable && (
                  <Button disabled={busy || draft.length < 2} onClick={() => void save()}>
                    {busy && <Spinner data-icon="inline-start" />}
                    {`Lưu bộ bài (${draft.length} lá)`}
                  </Button>
                )}
                <Button variant="secondary" onClick={onClose} disabled={busy}>
                  Đóng bộ bài
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
