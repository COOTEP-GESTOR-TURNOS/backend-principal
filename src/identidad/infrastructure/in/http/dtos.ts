import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { TIPOS_DOCUMENTO, type TipoDocumento } from '../../../domain/usuario';

export class LoginDto {
  @ApiProperty({ example: 'asociado.demo@cootep-turno.test' })
  @IsString()
  @MaxLength(254)
  correo!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  clave!: string;
}

export class RetoDto {
  @ApiProperty({ description: 'Identificador del reto devuelto por /auth/login' })
  @IsUUID()
  reto!: string;
}

export class VerificarMfaDto extends RetoDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'El código tiene 6 dígitos' })
  codigo!: string;
}

export class ClaveInicialDto extends RetoDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  claveNueva!: string;
}

export class RenovacionDto {
  @ApiPropertyOptional({ description: 'Solo la app móvil; la web usa la cookie HttpOnly' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tokenRenovacion?: string;
}

const DOCUMENTO = /^[A-Za-z0-9]{4,20}$/;

export class RegistroDto {
  @ApiProperty({ example: 'nueva.persona@correo.com' })
  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Ana María Rojas' })
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @ApiProperty({ enum: TIPOS_DOCUMENTO })
  @IsIn(TIPOS_DOCUMENTO)
  tipoDocumento!: TipoDocumento;

  @ApiProperty({ example: '1098765432' })
  @Matches(DOCUMENTO, { message: 'El documento tiene de 4 a 20 letras o números' })
  numeroDocumento!: string;

  @ApiPropertyOptional({ example: '1990-05-01', description: 'Permite reconocer a los adultos mayores' })
  @IsOptional()
  @IsDateString({ strict: true })
  fechaNacimiento?: string;

  @ApiProperty({ description: 'Mínimo 15 caracteres; se aceptan frases' })
  @IsString()
  @MaxLength(128)
  clave!: string;
}

export class CorreoDto {
  @ApiProperty()
  @IsString()
  @MaxLength(254)
  correo!: string;
}

export class TokenDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[\w-]{20,100}$/, { message: 'El enlace no es válido' })
  token!: string;
}

export class RestablecerDto extends TokenDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  claveNueva!: string;
}

export class CambiarClaveDto {
  @ApiPropertyOptional({ description: 'Obligatoria si la cuenta ya tiene contraseña' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  claveActual?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  claveNueva!: string;
}

export class ActualizarPerfilDto {
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
}

export class CanjeDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[\w-]{20,64}$/)
  codigo!: string;
}
