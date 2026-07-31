import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Transaction } from '../ledger/entities/transaction.entity';

@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('subscribe')
  handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: { accountId: string }) {
    client.join(roomForAccount(payload.accountId));
  }

  notifyTransfer(transaction: Transaction) {
    this.server
      .to(roomForAccount(transaction.fromAccountId))
      .to(roomForAccount(transaction.toAccountId))
      .emit('transfer.updated', transaction);
  }
}

function roomForAccount(accountId: string) {
  return `account:${accountId}`;
}
