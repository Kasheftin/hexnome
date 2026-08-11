/*
 * **First, before anything reads `process.env`.**
 *
 * `pnpm start` is `node dist/main.js`, and nothing else in the built output loads an env file —
 * `import 'dotenv/config'` appears in `prisma.config.ts`, which is the Prisma CLI's config and is not
 * compiled into `dist`. Without this line the server has no `DATABASE_URL`, so `PrismaService` throws
 * as it is constructed, and no `PORT`, so it would listen on 3000 if it got that far. Deployed behind
 * nginx that is a 502 with nothing in the access log to explain it, which is exactly how hexnome.com
 * spent its first afternoon.
 *
 * Development hid it: `nest start` was somehow supplying the values, so the gap only showed on the
 * one path nobody runs locally.
 */
import 'dotenv/config'
import type { Server } from 'node:http'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { API_PREFIX } from './apiPrefix'
import { HeadsGateway } from './games/heads.gateway'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)

  /*
   * Mounted where nginx already sends it.
   *
   * `location /api { proxy_pass http://localhost:22466; }` has no URI part, so nginx passes the
   * request through **unchanged** — the backend is handed `/api/games/…`, not `/games/…`. Rather than
   * teaching nginx to strip the prefix, the routes move to meet it, and the dev proxy forwards the
   * same path so both ends behave alike.
   */
  app.setGlobalPrefix(API_PREFIX)

  /*
   * The frontend is same-origin in both development (the Vite proxy) and production (nginx), so this
   * is a convenience for direct calls rather than something the app depends on. Nothing here is
   * authenticated by cookie, so there is no credential to protect.
   */
  app.enableCors({ origin: true })
  await app.listen(process.env.PORT ?? 3000)

  /*
   * The socket shares the HTTP server, and can only be attached once that server exists — which is
   * after `listen`, not before. Nest has no lifecycle hook for "now listening" that also hands over
   * the underlying server, so this is done here, where both are in scope.
   */
  app.get(HeadsGateway).attach(app.getHttpServer() as Server)
}

void bootstrap()
