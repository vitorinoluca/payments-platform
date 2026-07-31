import { Body, Controller, Post } from '@nestjs/common';
import { RegisterWebhookDto } from './dto/register-webhook.dto';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  register(@Body() dto: RegisterWebhookDto) {
    return this.webhooksService.register(dto.url);
  }
}
