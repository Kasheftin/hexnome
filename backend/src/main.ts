import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  // The dev frontend is a separate origin, and will stay one in production behind a CDN.
  app.enableCors({ origin: true, credentials: true })
  await app.listen(process.env.PORT ?? 3000)
}

void bootstrap()
