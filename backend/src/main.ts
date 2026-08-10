import type { Server } from 'node:http'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { HeadsGateway } from './games/heads.gateway'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  // The dev frontend is proxied and so same-origin, but a direct call from another origin should
  // work too — nothing here is authenticated, so there is no cookie to protect.
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
