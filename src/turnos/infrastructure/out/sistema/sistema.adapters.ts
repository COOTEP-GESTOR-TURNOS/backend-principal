import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { GeneradorIdsPort, RelojPort } from '../../../application/ports/out/otros.ports';

@Injectable()
export class RelojSistema implements RelojPort {
  ahora(): Date {
    return new Date();
  }
}

/** UUID v4: turno_id y evento_id son identificadores compartidos entre los cinco motores. */
@Injectable()
export class GeneradorUuid implements GeneradorIdsPort {
  nuevo(): string {
    return randomUUID();
  }
}
