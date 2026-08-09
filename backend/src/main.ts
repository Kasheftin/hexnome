import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  // The dev frontend is proxied and so same-origin, but a direct call from another origin should
  // work too — nothing here is authenticated, so there is no cookie to protect.
  app.enableCors({ origin: true })
  await app.listen(process.env.PORT ?? 3000)
}

void bootstrap()
