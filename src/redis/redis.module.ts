import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Injectable()
class RedisShutdownHook implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClientType) {}

  async onModuleDestroy() {
    await this.client.quit();
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const client = createClient({ url: config.get<string>('REDIS_URL') });
        await client.connect();
        return client;
      },
    },
    RedisShutdownHook,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
