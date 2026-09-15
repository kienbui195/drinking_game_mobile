import 'reflect-metadata';
import { Body, Controller, Get, HttpException, Inject, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Store } from './store';
import { GameGateway, originAllowed } from './gateway';
import { nameSchema } from './validation';

@Controller()
class AppController {
  constructor(@Inject(Store) private store: Store) {}
  @Get('health') async health() {
    await this.store.pool.query('SELECT 1');
    return { status: 'ok' };
  }
  @Post('sessions') async session(@Body() body: unknown) {
    const parsed = nameSchema.safeParse(body);
    if (!parsed.success) throw new HttpException('Tên cần từ 1 đến 30 ký tự.', 400);
    return this.store.createIdentity(parsed.data.name);
  }
}
@Module({ controllers: [AppController], providers: [Store, GameGateway] })
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: (origin: string | undefined, cb: (error: Error | null, allow: boolean) => void) =>
      cb(null, originAllowed(origin)),
  });
  const limits = new Map<string, { count: number; until: number }>();
  app.use(
    '/sessions',
    (
      req: { ip: string },
      res: { status: (n: number) => { json: (v: unknown) => void } },
      next: () => void,
    ) => {
      const now = Date.now();
      for (const [key, value] of limits) if (value.until < now) limits.delete(key);
      const limit = limits.get(req.ip) ?? { count: 0, until: now + 60_000 };
      limits.set(req.ip, limit);
      if (++limit.count > 20) {
        res.status(429).json({ message: 'Hãy đợi một phút trước khi tạo phiên mới.' });
        return;
      }
      next();
    },
  );
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
