import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { HeadsGateway } from './games/heads.gateway'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  // The dev frontend is a separate origin, and will stay one in production behind a CDN.
  app.enableCors({ origin: true, credentials: true })
  await app.listen(process.env.PORT ?? 3000)

  /*
   * The head-moved socket rides on the HTTP server Nest just started, so it shares the port. One
   * origin means the dev proxy and any production host need no second route — and it has to come
   * after `listen`, because there is no server to upgrade before then.
   */
  app.get(HeadsGateway).attach(app.getHttpServer())
}

void bootstrap()
