import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  transfer(@Body() dto: CreateTransferDto, @Headers('idempotency-key') idempotencyKey: string) {
    return this.transfersService.transfer(dto, idempotencyKey);
  }
}
