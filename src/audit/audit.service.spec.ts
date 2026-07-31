import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let repo: { save: jest.Mock; create: jest.Mock };

  beforeEach(() => {
    repo = {
      create: jest.fn().mockImplementation((e) => e),
      save: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuditService(repo as any);
  });

  it('guarda el evento con su userId y metadata', async () => {
    await service.record('auth.login.success', 'user-1', { email: 'a@test.com' });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.success', userId: 'user-1', metadata: { email: 'a@test.com' } }),
    );
  });

  it('no lanza si falla el guardado (no debe romper la operación que audita)', async () => {
    repo.save.mockRejectedValue(new Error('db caída'));

    await expect(service.record('transfer.completed', null, {})).resolves.toBeUndefined();
  });
});
