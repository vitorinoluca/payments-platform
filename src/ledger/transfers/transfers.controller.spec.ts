import { Test, TestingModule } from '@nestjs/testing';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

describe('TransfersController', () => {
  let controller: TransfersController;
  let service: { transfer: jest.Mock };

  beforeEach(async () => {
    service = { transfer: jest.fn().mockResolvedValue({ id: 'tx-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransfersController],
      providers: [{ provide: TransfersService, useValue: service }],
    }).compile();

    controller = module.get(TransfersController);
  });

  it('delega la transferencia al service junto con la Idempotency-Key', async () => {
    const dto = { fromAccountId: 'a', toAccountId: 'b', amountMinorUnits: '10' };
    const result = await controller.transfer(dto, 'idem-key-1');

    expect(service.transfer).toHaveBeenCalledWith(dto, 'idem-key-1');
    expect(result).toEqual({ id: 'tx-1' });
  });
});
