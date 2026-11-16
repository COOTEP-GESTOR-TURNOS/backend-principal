import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { ConflictoError, ReglaNegocioError } from '../../../../compartido/domain/errores';
import type { AsignacionRol, Rol } from '../../../../compartido/domain/principal';
import { PG_POOL } from '../../../../compartido/infrastructure/recursos';
import type { AsignacionGuardada, CuentaUsuario, TipoDocumento } from '../../../domain/usuario';
import type { ProveedorOidc } from '../../../application/ports/out/identidad.ports';
import type {
  CambiosUsuario,
  FiltroUsuarios,
  NuevoUsuario,
  PaginaUsuarios,
  UsuarioRepository,
} from '../../../application/ports/out/usuario.repository';

interface FilaUsuario {
  id: string;
  email: string;
  nombre: string;
  tipo_documento: TipoDocumento | null;
  numero_documento: string | null;
  fecha_nacimiento: string | null;
  password_hash: string | null;
  mfa_secreto_cifrado: string | null;
  debe_cambiar_password: boolean;
  email_verificado: boolean;
  activo: boolean;
  creado_en: Date;
  ultimo_ingreso_en: Date | null;
  roles: { id: string; rol: Rol; agenciaId: string | null; servicioId: string | null; asignadoEn: string }[];
}

/** Usuario con sus roles en una sola consulta (json_agg). */
const SELECT_USUARIO = `
  SELECT u.id, u.email, u.nombre, u.tipo_documento, u.numero_documento, u.fecha_nacimiento,
         u.password_hash, u.mfa_secreto_cifrado, u.debe_cambiar_password, u.email_verificado,
         u.activo, u.creado_en, u.ultimo_ingreso_en,
         COALESCE(json_agg(json_build_object(
           'id', r.id, 'rol', r.rol, 'agenciaId', r.agencia_id, 'servicioId', r.servicio_id, 'asignadoEn', r.asignado_en
         ) ORDER BY r.asignado_en) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
    FROM usuario u
    LEFT JOIN asignacion_rol r ON r.usuario_id = u.id`;

/** Restricciones de unicidad y llaves foráneas traducidas a errores del dominio (409 y 422). */
const RESTRICCIONES: Record<string, () => Error> = {
  ux_usuario_email: () => new ConflictoError('CORREO_REGISTRADO', 'Ya existe una cuenta con ese correo'),
  ux_usuario_documento: () => new ConflictoError('DOCUMENTO_REGISTRADO', 'Ya existe una cuenta con ese documento'),
  ux_asignacion_rol: () => new ConflictoError('ROL_YA_ASIGNADO', 'La persona ya tiene ese rol con ese ámbito'),
  identidad_federada_pkey: () => new ConflictoError('IDENTIDAD_YA_VINCULADA', 'Esa cuenta externa ya está vinculada'),
  fk_asignacion_agencia_servicio: () =>
    new ReglaNegocioError('AMBITO_INEXISTENTE', 'La agencia no ofrece ese servicio'),
  asignacion_rol_agencia_id_fkey: () => new ReglaNegocioError('AMBITO_INEXISTENTE', 'La agencia no existe'),
  asignacion_rol_servicio_id_fkey: () => new ReglaNegocioError('AMBITO_INEXISTENTE', 'El servicio no existe'),
};

function traducir(error: unknown): never {
  const e = error as { code?: string; constraint?: string };
  if ((e.code === '23505' || e.code === '23503') && e.constraint && RESTRICCIONES[e.constraint]) {
    throw RESTRICCIONES[e.constraint]();
  }
  throw error;
}

/** Escapa los comodines de ILIKE para que el texto se busque literal. */
const patron = (texto: string) => `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Adaptador de salida de las cuentas sobre PostgreSQL (fuente de verdad de usuarios y roles). */
@Injectable()
export class UsuarioPgRepository implements UsuarioRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  buscarPorId(id: string): Promise<CuentaUsuario | null> {
    return this.uno(`${SELECT_USUARIO} WHERE u.id = $1 GROUP BY u.id`, [id]);
  }

  buscarPorEmail(email: string): Promise<CuentaUsuario | null> {
    return this.uno(`${SELECT_USUARIO} WHERE u.email = $1 GROUP BY u.id`, [email]);
  }

  buscarPorIdentidad(proveedor: ProveedorOidc, sujeto: string): Promise<CuentaUsuario | null> {
    return this.uno(
      `${SELECT_USUARIO}
        JOIN identidad_federada f ON f.usuario_id = u.id
       WHERE f.proveedor = $1 AND f.sujeto = $2
       GROUP BY u.id`,
      [proveedor, sujeto],
    );
  }

  async crear(n: NuevoUsuario): Promise<CuentaUsuario> {
    const id = await this.enTransaccion(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO usuario (email, nombre, tipo_documento, numero_documento, fecha_nacimiento,
                              password_hash, email_verificado, debe_cambiar_password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          n.email,
          n.nombre,
          n.tipoDocumento ?? null,
          n.numeroDocumento ?? null,
          n.fechaNacimiento ?? null,
          n.passwordHash ?? null,
          n.emailVerificado,
          n.debeCambiarPassword ?? false,
        ],
      );
      await c.query(
        `INSERT INTO asignacion_rol (usuario_id, rol, agencia_id, servicio_id, asignado_por) VALUES ($1, $2, $3, $4, $5)`,
        [rows[0].id, n.rol.rol, n.rol.agenciaId ?? null, n.rol.servicioId ?? null, n.asignadoPor ?? null],
      );
      if (n.identidad) {
        await c.query('INSERT INTO identidad_federada (proveedor, sujeto, usuario_id) VALUES ($1, $2, $3)', [
          n.identidad.proveedor,
          n.identidad.sujeto,
          rows[0].id,
        ]);
      }
      return rows[0].id;
    });
    return (await this.buscarPorId(id))!;
  }

  async vincularIdentidad(usuarioId: string, proveedor: ProveedorOidc, sujeto: string): Promise<void> {
    await this.pool
      .query('INSERT INTO identidad_federada (proveedor, sujeto, usuario_id) VALUES ($1, $2, $3)', [proveedor, sujeto, usuarioId])
      .catch(traducir);
  }

  async actualizarPassword(id: string, hash: string | null, opciones: { verificarCorreo?: boolean } = {}): Promise<void> {
    await this.pool.query(
      `UPDATE usuario
          SET password_hash = $2, debe_cambiar_password = false, actualizado_en = now(),
              email_verificado = email_verificado OR $3
        WHERE id = $1`,
      [id, hash, opciones.verificarCorreo ?? false],
    );
  }

  async marcarCorreoVerificado(id: string): Promise<void> {
    await this.pool.query('UPDATE usuario SET email_verificado = true, actualizado_en = now() WHERE id = $1', [id]);
  }

  async guardarMfa(id: string, secretoCifrado: string | null): Promise<void> {
    await this.pool.query('UPDATE usuario SET mfa_secreto_cifrado = $2, actualizado_en = now() WHERE id = $1', [id, secretoCifrado]);
  }

  async registrarIngreso(id: string, instante: Date): Promise<void> {
    await this.pool.query('UPDATE usuario SET ultimo_ingreso_en = $2 WHERE id = $1', [id, instante]);
  }

  async actualizar(id: string, cambios: CambiosUsuario): Promise<void> {
    const columnas: Record<keyof CambiosUsuario, string> = {
      nombre: 'nombre',
      tipoDocumento: 'tipo_documento',
      numeroDocumento: 'numero_documento',
      fechaNacimiento: 'fecha_nacimiento',
      activo: 'activo',
    };
    const campos = (Object.keys(columnas) as (keyof CambiosUsuario)[]).filter((k) => cambios[k] !== undefined);
    if (campos.length === 0) return;
    const asignaciones = campos.map((k, i) => `${columnas[k]} = $${i + 2}`).join(', ');
    await this.pool
      .query(`UPDATE usuario SET ${asignaciones}, actualizado_en = now() WHERE id = $1`, [id, ...campos.map((k) => cambios[k])])
      .catch(traducir);
  }

  async asignarRol(usuarioId: string, a: AsignacionRol, asignadoPor: string): Promise<AsignacionGuardada> {
    const { rows } = await this.pool
      .query<{ id: string; asignado_en: Date }>(
        `INSERT INTO asignacion_rol (usuario_id, rol, agencia_id, servicio_id, asignado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, asignado_en`,
        [usuarioId, a.rol, a.agenciaId ?? null, a.servicioId ?? null, asignadoPor],
      )
      .catch(traducir);
    return { ...a, id: rows[0].id, asignadoEn: rows[0].asignado_en };
  }

  async revocarRol(usuarioId: string, asignacionId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM asignacion_rol WHERE id = $1 AND usuario_id = $2', [
      asignacionId,
      usuarioId,
    ]);
    return (rowCount ?? 0) > 0;
  }

  async contarSuperadminsActivos(): Promise<number> {
    const { rows } = await this.pool.query<{ total: string }>(
      `SELECT count(DISTINCT u.id) AS total
         FROM usuario u JOIN asignacion_rol r ON r.usuario_id = u.id
        WHERE r.rol = 'SUPERADMIN' AND u.activo`,
    );
    return Number(rows[0].total);
  }

  async listar(f: FiltroUsuarios): Promise<PaginaUsuarios> {
    const { rows } = await this.pool.query<{ id: string; total: string }>(
      `SELECT u.id, count(*) OVER () AS total
         FROM usuario u
        WHERE ($1::text IS NULL OR u.nombre ILIKE $1 OR u.email ILIKE $1 OR u.numero_documento ILIKE $1)
          AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM asignacion_rol r WHERE r.usuario_id = u.id AND r.rol = $2))
          AND ($3::uuid[] IS NULL OR EXISTS (
                SELECT 1 FROM asignacion_rol r WHERE r.usuario_id = u.id AND r.agencia_id = ANY($3)))
          AND ($4::boolean IS NULL OR u.activo = $4)
        ORDER BY u.nombre, u.id
        LIMIT $5 OFFSET $6`,
      [
        f.texto ? patron(f.texto) : null,
        f.rol ?? null,
        f.agencias ?? null,
        f.activo ?? null,
        f.tamano,
        (f.pagina - 1) * f.tamano,
      ],
    );
    if (rows.length === 0) return { elementos: [], total: 0 };
    const cuentas = await this.varios(`${SELECT_USUARIO} WHERE u.id = ANY($1) GROUP BY u.id ORDER BY u.nombre, u.id`, [
      rows.map((r) => r.id),
    ]);
    return { elementos: cuentas, total: Number(rows[0].total) };
  }

  private async uno(sql: string, parametros: unknown[]): Promise<CuentaUsuario | null> {
    return (await this.varios(sql, parametros))[0] ?? null;
  }

  private async varios(sql: string, parametros: unknown[]): Promise<CuentaUsuario[]> {
    const { rows } = await this.pool.query<FilaUsuario>(sql, parametros);
    return rows.map(aCuenta);
  }

  private async enTransaccion<T>(trabajo: (c: PoolClient) => Promise<T>): Promise<T> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await trabajo(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      traducir(error);
    } finally {
      cliente.release();
    }
  }
}

function aCuenta(f: FilaUsuario): CuentaUsuario {
  return {
    id: f.id,
    email: f.email,
    nombre: f.nombre,
    tipoDocumento: f.tipo_documento,
    numeroDocumento: f.numero_documento,
    fechaNacimiento: f.fecha_nacimiento,
    passwordHash: f.password_hash,
    mfaSecretoCifrado: f.mfa_secreto_cifrado,
    debeCambiarPassword: f.debe_cambiar_password,
    emailVerificado: f.email_verificado,
    activo: f.activo,
    creadoEn: f.creado_en,
    ultimoIngresoEn: f.ultimo_ingreso_en,
    roles: f.roles.map((r) => ({
      id: r.id,
      rol: r.rol,
      ...(r.agenciaId ? { agenciaId: r.agenciaId } : {}),
      ...(r.servicioId ? { servicioId: r.servicioId } : {}),
      asignadoEn: new Date(r.asignadoEn),
    })),
  };
}
