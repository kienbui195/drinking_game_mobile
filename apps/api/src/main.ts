import 'reflect-metadata';
import { Body, Controller, Get, HttpException, Inject, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Store } from './store';
import { GameGateway, originAllowed } from './gateway';
import { GameError } from './engine';
import { adminBody, AdminApiController } from './admin-api';
import { accountSchema, loginSchema, nameSchema } from './validation';

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
  @Post('auth/register') async register(@Body() body: unknown) {
    const parsed = accountSchema.safeParse(body);
    if (!parsed.success) throw new HttpException('Tên hiển thị hoặc mật khẩu không hợp lệ.', 400);
    try {
      return await this.store.register(parsed.data.displayName, parsed.data.password);
    } catch (error) {
      if (error instanceof GameError) throw new HttpException(error.message, 400);
      throw error;
    }
  }
  @Post('auth/login') async login(@Body() body: unknown) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new HttpException('Username hoặc mật khẩu không hợp lệ.', 400);
    try {
      return await this.store.login(parsed.data.username, parsed.data.password);
    } catch (error) {
      if (error instanceof GameError) throw new HttpException(error.message, 401);
      throw error;
    }
  }
}
@Module({ controllers: [AppController, AdminApiController], providers: [Store, GameGateway] })
class AppModule {}
/** Cấu hình HTTP dùng chung cho máy chủ thật và test /admin-api. */
export function setupHttp(app: NestExpressApplication) {
  // /admin-api chỉ dành cho dashboard gọi trong mạng Docker: không bao giờ trả header CORS.
  app.enableCors(
    (
      req: { url?: string; headers: { origin?: string } },
      cb: (error: Error | null, options: { origin: boolean }) => void,
    ) =>
      cb(null, {
        origin: !req.url?.startsWith('/admin-api') && originAllowed(req.headers.origin),
      }),
  );
  app.use('/admin-api', adminBody);
  app.useBodyParser('json');
}
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  setupHttp(app);
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
  await app.listen(Number(process.env.API_PORT ?? 45100), '0.0.0.0');
}
// Test chỉ import setupHttp, không khởi động máy chủ.
if (require.main === module) void bootstrap();
