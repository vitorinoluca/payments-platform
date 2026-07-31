import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let server: { to: jest.Mock; emit: jest.Mock };

  beforeEach(() => {
    gateway = new RealtimeGateway();
    server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    gateway.server = server as any;
  });

  it('une al cliente a la room de la cuenta al suscribirse', () => {
    const client = { join: jest.fn() };

    gateway.handleSubscribe(client as any, { accountId: 'acc-1' });

    expect(client.join).toHaveBeenCalledWith('account:acc-1');
  });

  it('emite transfer.updated a las rooms de origen y destino', () => {
    const transaction = {
      id: 'tx-1',
      fromAccountId: 'acc-from',
      toAccountId: 'acc-to',
      status: 'completed',
    } as any;

    gateway.notifyTransfer(transaction);

    expect(server.to).toHaveBeenCalledWith('account:acc-from');
    expect(server.to).toHaveBeenCalledWith('account:acc-to');
    expect(server.emit).toHaveBeenCalledWith('transfer.updated', transaction);
  });
});
