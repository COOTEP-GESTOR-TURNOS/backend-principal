import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  PAGINA_MAXIMA,
  PAGINA_PREDETERMINADA,
  TAMANO_MAXIMO,
  TAMANO_PREDETERMINADO,
  type Paginacion,
  type SolicitudPagina,
} from '../../domain/paginacion';

export class PaginacionQuery implements SolicitudPagina {
  @ApiPropertyOptional({ default: PAGINA_PREDETERMINADA, minimum: 1, maximum: PAGINA_MAXIMA, description: 'Número de página, desde 1' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINA_MAXIMA)
  pagina?: number;

  @ApiPropertyOptional({ default: TAMANO_PREDETERMINADO, minimum: 1, maximum: TAMANO_MAXIMO, description: 'Elementos por página' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAMANO_MAXIMO)
  tamano?: number;
}

export class PaginacionDto implements Paginacion {
  @ApiProperty({ example: 1, minimum: 1 })
  pagina!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: TAMANO_MAXIMO })
  tamano!: number;

  @ApiProperty({ example: 42, minimum: 0, description: 'Cantidad total que coincide con los filtros, antes de paginar' })
  total!: number;

  @ApiProperty({ example: 3, minimum: 0 })
  totalPaginas!: number;
}
