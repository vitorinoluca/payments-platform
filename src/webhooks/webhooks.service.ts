import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(@InjectRepository(WebhookEndpoint) private readonly webhookRepo: Repository<WebhookEndpoint>) {}

  async register(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('url inválida');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('la url debe ser http o https');
    }

    const secret = randomBytes(32).toString('hex');
    const endpoint = await this.webhookRepo.save(this.webhookRepo.create({ url, secret }));

    return { id: endpoint.id, url: endpoint.url, secret };
  }

  async dispatch(event: string, data: unknown): Promise<void> {
    const endpoints = await this.webhookRepo.findBy({ active: true });
    await Promise.all(endpoints.map((endpoint) => this.send(endpoint, event, data)));
  }

  private async send(endpoint: WebhookEndpoint, event: string, data: unknown): Promise<void> {
    const body = JSON.stringify({ event, data });
    const signature = createHmac('sha256', endpoint.secret).update(body).digest('hex');

    try {
      await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signature },
        body,
      });
    } catch (err) {
      // un webhook caído no debe romper ni revertir la transferencia que lo disparó
      this.logger.warn(`no se pudo entregar el webhook a ${endpoint.url}: ${(err as Error).message}`);
    }
  }
}
