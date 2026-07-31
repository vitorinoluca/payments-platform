import { Body, Controller, Headers, Post } from '@nestjs/common';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransfersService } from './transfers.service';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  transfer(@Body() dto: CreateTransferDto, @Headers('idempotency-key') idempotencyKey: string) {
    return this.transfersService.transfer(dto, idempotencyKey);
  }
}
