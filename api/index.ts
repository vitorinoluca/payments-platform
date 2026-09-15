import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from '../src/bootstrap';
import type { NestExpressApplication } from '@nestjs/platform-express';

// ponytail: cachea la app entre invocaciones mientras la instancia de Vercel
// siga tibia, así no se re-bootea Nest (y no se reconecta a Redis) en cada request.
let appPromise: Promise<NestExpressApplication> | undefined;

function getApp() {
  appPromise ??= createApp().then(async (app) => {
    await app.init();
    return app;
  });
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance(req, res);
}
