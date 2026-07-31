import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: { register: jest.Mock };

  beforeEach(async () => {
    service = { register: jest.fn().mockResolvedValue({ id: 'wh-1', url: 'https://example.com', secret: 's' }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: service }],
    }).compile();

    controller = module.get(WebhooksController);
  });

  it('delega el registro al service', async () => {
    const result = await controller.register({ url: 'https://example.com' });

    expect(service.register).toHaveBeenCalledWith('https://example.com');
    expect(result).toEqual({ id: 'wh-1', url: 'https://example.com', secret: 's' });
  });
});
