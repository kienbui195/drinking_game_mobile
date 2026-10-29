import { useState } from 'react';
import { categoryLabels, pouchLimit, type Action, type Card as GameCard } from '@chamly/shared';
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
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

/**
 * Túi thần kỳ của một người chơi, mở dạng bottom sheet vuốt xuống để đóng. Lá trong túi chỉ dùng
 * được vào đúng lượt của chủ túi và khi chưa có lá nào đang mở, vì nó thay chỗ cho việc rút bài.
 */
export function PouchDrawer({
  open,
  cards,
  canUse,
  busy,
  onClose,
  send,
}: {
  open: boolean;
  cards: GameCard[];
  canUse: boolean;
  busy: boolean;
  onClose: () => void;
  send: (action: Action) => Promise<boolean>;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-xl font-bold">
            🎒 Túi thần kỳ · {cards.length}/{pouchLimit}
          </DrawerTitle>
          <DrawerDescription>
            {canUse
              ? 'Chọn một lá để dùng thay cho lượt rút bài của vòng này.'
              : 'Lá trong túi chỉ dùng được vào lượt của bạn, khi chưa lật lá nào.'}
          </DrawerDescription>
        </DrawerHeader>
        <div className="scroll-area flex flex-col gap-3 px-4 pb-2">
          {cards.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>Túi đang trống</EmptyTitle>
                <EmptyDescription>
                  Khi lật trúng một lá có thể để dành, hãy chọn “Cất vào túi thần kỳ” thay vì xử lý
                  ngay.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            cards.map((card) => (
              <Card key={card.id}>
                <CardHeader>
                  <CardDescription className="text-primary text-xs font-bold tracking-widest">
                    {categoryLabels[card.category]}
                  </CardDescription>
                  <CardTitle className="text-lg font-bold">{card.title}</CardTitle>
                </CardHeader>
                {opened === card.id && (
                  <CardContent className="flex flex-col gap-2 leading-6">
                    <p className="text-muted-foreground">{card.description}</p>
                    <p className="text-warning">{card.penalty}</p>
                  </CardContent>
                )}
                <CardFooter className="flex flex-col gap-2 border-0 bg-transparent *:w-full">
                  <Button
                    variant="secondary"
                    onClick={() => setOpened(opened === card.id ? null : card.id)}
                  >
                    {opened === card.id ? 'Thu gọn' : 'Xem nội dung'}
                  </Button>
                  {canUse && (
                    <Button
                      disabled={busy}
                      onClick={async () => {
                        if (await send({ type: 'usePouch', cardId: card.id })) onClose();
                      }}
                    >
                      Dùng lá này
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))
          )}
        </div>
        <DrawerFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Đóng túi
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
