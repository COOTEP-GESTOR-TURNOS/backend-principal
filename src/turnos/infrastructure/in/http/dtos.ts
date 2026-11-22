import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginacionDto } from '../../../../compartido/infrastructure/http/paginacion.dto';
import { EstadoTurno } from '../../../domain/estado-turno';

export class SolicitarTurnoDto {
  @ApiProperty({ format: 'uuid', example: 'a0000000-0000-4000-8000-000000000001' })
  @IsUUID()
  agenciaId: string;

  @ApiProperty({ format: 'uuid', example: 'b0000000-0000-4000-8000-000000000001' })
  @IsUUID()
  servicioId: string;

  @ApiPropertyOptional({ description: 'Autodeclaración de gestante o discapacidad (RN-06). No se guarda el motivo.' })
  @IsOptional()
  @IsBoolean()
  solicitaPreferencial?: boolean;

  @ApiProperty({ enum: ['WEB', 'MOVIL'] })
  @IsIn(['WEB', 'MOVIL'])
  canal: 'WEB' | 'MOVIL';
}

export class VerificarPreferencialDto {
  @ApiProperty({ description: 'true si la condición se comprobó en la ventanilla' })
  @IsBoolean()
  cumple: boolean;
}

/** Documenta en OpenAPI la forma de ResumenTurno. */
export class ResumenTurnoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ nullable: true, example: 'C-014' }) codigo: string | null;
  @ApiProperty({ enum: EstadoTurno }) estado: EstadoTurno;
  @ApiProperty({ enum: ['GENERAL', 'PREFERENCIAL'] }) tipoAtencion: 'GENERAL' | 'PREFERENCIAL';
  @ApiProperty({ format: 'uuid' }) agenciaId: string;
  @ApiProperty({ format: 'uuid' }) servicioId: string;
  @ApiProperty({ nullable: true }) personasDelante: number | null;
  @ApiProperty({ description: 'RN-10: el asociado ya confirmó que viene' }) confirmado: boolean;
}

export class MiTurnoDto extends ResumenTurnoDto {
  @ApiProperty({ nullable: true, description: 'Minutos; null si la analítica no respondió' })
  esperaEstimadaMin: number | null;
}

export class TurnoEnFilaDto {
  @ApiProperty({ format: 'uuid' }) turnoId!: string;
  @ApiProperty({ example: 1 }) numero!: number;
  @ApiProperty({ enum: ['GENERAL', 'PREFERENCIAL'] }) tipoAtencion!: 'GENERAL' | 'PREFERENCIAL';
}

export class PaginaTurnosDto extends PaginacionDto {
  @ApiProperty({ type: [TurnoEnFilaDto] }) elementos!: TurnoEnFilaDto[];
}
