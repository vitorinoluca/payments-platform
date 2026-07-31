import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>) {}

  async record(action: string, userId: string | null, metadata?: unknown): Promise<void> {
    try {
      await this.auditRepo.save(this.auditRepo.create({ action, userId, metadata }));
    } catch (err) {
      // un fallo al auditar no debe romper la operación de negocio que lo disparó
      this.logger.warn(`no se pudo registrar el evento de auditoría "${action}": ${(err as Error).message}`);
    }
  }
}
