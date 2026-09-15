import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // el entrypoint de Vercel (api/index.ts) exporta un handler HTTP simple, no el http.Server
  // crudo que necesita el upgrade de WebSocket — conectar acá solo abriría 2 conexiones a
  // Redis por cold start sin que nadie las use.
  if (!process.env.VERCEL) {
    const configService = app.get(ConfigService);
    const redisIoAdapter = new RedisIoAdapter(app, configService.get<string>('REDIS_URL')!);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('payments-platform API')
    .setDescription('Plataforma de pagos P2P — ledger, fraude, multi-moneda, webhooks')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  return app;
}
