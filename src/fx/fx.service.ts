import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '../redis/redis.module';

const CACHE_TTL_SECONDS = 300;
// las tasas llegan como float desde la API externa, pero la conversión de montos
// se hace toda en enteros: la tasa se escala a un bigint antes de multiplicar,
// para no meter errores de punto flotante en la plata.
const RATE_SCALE = 1_000_000n;

@Injectable()
export class FxService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  async getRate(from: string, to: string): Promise<number> {
    if (from === to) {
      return 1;
    }

    const rates = await this.getRatesForBase(from);
    const rate = rates[to];
    if (typeof rate !== 'number') {
      throw new BadRequestException(`no existe tasa de cambio de ${from} a ${to}`);
    }
    return rate;
  }

  convert(amountMinorUnits: bigint, rate: number): bigint {
    const scaledRate = BigInt(Math.round(rate * Number(RATE_SCALE)));
    return (amountMinorUnits * scaledRate) / RATE_SCALE;
  }

  private async getRatesForBase(base: string): Promise<Record<string, number>> {
    const cacheKey = `fx:rates:${base}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const response = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (!response.ok) {
      throw new ServiceUnavailableException('no se pudo obtener tasas de cambio');
    }

    const json = (await response.json()) as { result: string; rates: Record<string, number> };
    if (json.result !== 'success') {
      throw new ServiceUnavailableException('no se pudo obtener tasas de cambio');
    }

    await this.redis.set(cacheKey, JSON.stringify(json.rates), { EX: CACHE_TTL_SECONDS });
    return json.rates;
  }
}
