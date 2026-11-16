import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Rol } from '../../../../compartido/domain/principal';
import { TIPOS_DOCUMENTO, type TipoDocumento } from '../../../../identidad/domain/usuario';

const ROLES: Rol[] = ['SUPERADMIN', 'ADMIN_AGENCIA', 'FUNCIONARIO', 'ASOCIADO'];
const DOCUMENTO = /^[A-Za-z0-9]{4,20}$/;

export class AsignarRolDto {
  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  rol!: Rol;

  @ApiPropertyOptional({ description: 'Obligatoria para ADMIN_AGENCIA y FUNCIONARIO' })
  @IsOptional()
  @IsUUID()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Solo FUNCIONARIO: sin servicio atiende todos los de su agencia' })
  @IsOptional()
  @IsUUID()
  servicioId?: string;
}

export class CrearUsuarioDto extends AsignarRolDto {
  @ApiProperty()
  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @ApiPropertyOptional({ enum: TIPOS_DOCUMENTO })
  @IsOptional()
  @IsIn(TIPOS_DOCUMENTO)
  tipoDocumento?: TipoDocumento;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DOCUMENTO, { message: 'El documento tiene de 4 a 20 letras o números' })
  numeroDocumento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  fechaNacimiento?: string;
}

export class ActualizarUsuarioDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  nombre?: string;

  @ApiPropertyOptional({ enum: TIPOS_DOCUMENTO })
  @IsOptional()
  @IsIn(TIPOS_DOCUMENTO)
  tipoDocumento?: TipoDocumento;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DOCUMENTO, { message: 'El documento tiene de 4 a 20 letras o números' })
  numeroDocumento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  fechaNacimiento?: string;

  @ApiPropertyOptional({ description: 'false desactiva la cuenta y cierra sus sesiones' })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class ListarUsuariosQuery {
  @ApiPropertyOptional({ description: 'Nombre, correo o documento' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  texto?: string;

  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  rol?: Rol;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agenciaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  activo?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  tamano = 20;
}
