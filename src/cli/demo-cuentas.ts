import { createHash } from 'node:crypto';
import { isEmail, isUUID } from 'class-validator';
import type { Pool, PoolClient } from 'pg';
import { ubicacionAgenciaPutumayo } from '../analitica/application/ubicacion-agencia';
import { normalizarCorreo } from '../identidad/domain/usuario';
import type { AgenciaCatalogo, CatalogoPort, ServicioCatalogo } from '../turnos/application/ports/out/otros.ports';

const BLOQUEO_GENERADOR = 1_512_608_615;
const DOMINIO_DEMO = '@cootep-turno.test';

/** Los turnos simulados van a la colección normal con esta marca; la analítica la reconoce y la borra al limpiar. */
export const EVENTOS_TURNO = 'eventos_turno';
export const ORIGEN_SIMULADO = 'SIMULADO';

/** Windows PowerShell 5.1 antepone una marca BOM (U+FEFF) al pasar archivos por tubería. */
export function sinBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

type RolDemo = 'ADMIN_AGENCIA' | 'FUNCIONARIO' | 'ASOCIADO';

interface Participante {
  id: string;
  agencia_id: string;
  servicio_id: string | null;
  rol: RolDemo;
  ordinal: number;
  email: string;
  nombre: string;
  documento: string;
  nacimiento: string;
}

interface ServicioDemo extends Omit<ServicioCatalogo, 'nombre'> {
  activa: boolean;
  apertura: string;
  cierre: string;
}

interface AgenciaDemo extends Omit<AgenciaCatalogo, 'servicios'> {
  departamento?: 'PUTUMAYO';
  servicios: ServicioDemo[];
  administradores: string[];
  funcionarios: { id: string; servicioId: string | null }[];
  asociados: string[];
}

export interface ManifiestoCuentas {
  semilla: number;
  agencias: AgenciaDemo[];
}

/** Mantiene una única carga escritora por almacén relacional local. */
export async function enTransaccion<T>(pool: Pool, ejecutar: (cliente: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT pg_advisory_xact_lock($1::bigint)', [BLOQUEO_GENERADOR]);
    const resultado = await ejecutar(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

export function claveDemo(...partes: (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex');
}

function uuidDemo(...partes: (string | number)[]): string {
  const hash = claveDemo('cootep-turno:demo:usuario', ...partes);
  const variante = ((Number.parseInt(hash[16], 16) & 3) | 8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${variante}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function enteroDemo(minimo: number, maximo: number, ...partes: (string | number)[]): number {
  return minimo + (Number.parseInt(claveDemo(...partes).slice(0, 8), 16) % (maximo - minimo + 1));
}

function participantesDe(agencia: Omit<AgenciaDemo, 'administradores' | 'funcionarios' | 'asociados'>, semilla: number): Participante[] {
  const activos = agencia.servicios.filter((servicio) => servicio.activa);
  const poblacion: [RolDemo, number][] = [
    ['ADMIN_AGENCIA', 1],
    ['FUNCIONARIO', enteroDemo(3, 5, semilla, agencia.id, 'funcionarios')],
    ['ASOCIADO', enteroDemo(1000, 3000, semilla, agencia.id, 'asociados')],
  ];
  const nombresRol: Record<RolDemo, string> = {
    ADMIN_AGENCIA: 'Administrador', FUNCIONARIO: 'Funcionario', ASOCIADO: 'Asociado',
  };
  const codigo = agencia.codigo.toLowerCase().replaceAll(/[^a-z0-9]/g, '-');
  const sufijo = claveDemo(agencia.id).slice(0, 8);
  return poblacion.flatMap(([rol, cantidad]) => Array.from({ length: cantidad }, (_, indice) => {
    const ordinal = indice + 1;
    const id = uuidDemo(agencia.id, rol, ordinal);
    const servicioId = rol === 'FUNCIONARIO' && indice > 0 && activos.length > 0
      ? activos[(indice - 1) % activos.length].id
      : null;
    return {
      id,
      agencia_id: agencia.id,
      servicio_id: servicioId,
      rol,
      ordinal,
      email: `demo-${rol.toLowerCase().replace('_', '-')}-${codigo}-${sufijo}-${ordinal}${DOMINIO_DEMO}`,
      nombre: `${nombresRol[rol]} demo ${ordinal} · ${agencia.nombre}`.slice(0, 120),
      documento: `9${BigInt(`0x${claveDemo(id, 'documento').slice(0, 15)}`).toString(10).padStart(19, '0')}`,
      nacimiento: `${enteroDemo(1945, 2005, semilla, id, 'edad')}-06-15`,
    };
  }));
}

async function guardarParticipantes(cliente: PoolClient, participantes: Participante[]): Promise<Participante[]> {
  const json = JSON.stringify(participantes);
  await cliente.query(
    `INSERT INTO usuario (id, email, nombre, tipo_documento, numero_documento, fecha_nacimiento, email_verificado)
     SELECT p.id, p.email, p.nombre, 'CC', p.documento, p.nacimiento, false
     FROM jsonb_to_recordset($1::jsonb) AS p(id uuid, email text, nombre text, documento text, nacimiento date)
     ON CONFLICT (id) DO NOTHING`, [json],
  );
  await cliente.query(
    `INSERT INTO demo_participante (usuario_id, agencia_id, rol, ordinal)
     SELECT p.id, p.agencia_id, p.rol, p.ordinal
     FROM jsonb_to_recordset($1::jsonb) AS p(id uuid, agencia_id uuid, rol text, ordinal integer)
     ON CONFLICT (usuario_id) DO NOTHING`, [json],
  );
  await cliente.query(
    `INSERT INTO asignacion_rol (usuario_id, rol, agencia_id, servicio_id)
     SELECT p.id, p.rol, CASE WHEN p.rol = 'ASOCIADO' THEN NULL ELSE p.agencia_id END, p.servicio_id
     FROM jsonb_to_recordset($1::jsonb) AS p(id uuid, agencia_id uuid, rol text, servicio_id uuid)
     WHERE NOT EXISTS (
         SELECT 1 FROM asignacion_rol r WHERE r.usuario_id = p.id AND r.rol = p.rol
     )
     ON CONFLICT DO NOTHING`, [json],
  );
  // Una resembra no revierte las asignaciones de servicio que el administrador ya modificó.
  const { rows } = await cliente.query<{ id: string; servicioId: string | null }>(
    `SELECT r.usuario_id AS id, r.servicio_id AS "servicioId"
       FROM asignacion_rol r JOIN demo_participante p ON p.usuario_id = r.usuario_id
      WHERE p.agencia_id = $1 AND r.rol = 'FUNCIONARIO' AND r.agencia_id = p.agencia_id
      ORDER BY r.servicio_id NULLS FIRST`, [participantes[0].agencia_id],
  );
  const servicios = new Map<string, string | null>();
  for (const { id, servicioId } of rows) if (!servicios.has(id)) servicios.set(id, servicioId);
  return participantes.map((p) => p.rol === 'FUNCIONARIO' ? { ...p, servicio_id: servicios.get(p.id) ?? null } : p);
}

export async function generarCuentas(pool: Pool, catalogo: CatalogoPort, semillaSolicitada: number): Promise<ManifiestoCuentas> {
  const agencias = await catalogo.listarAgencias();
  if (agencias.length === 0) throw new Error('El catálogo local no tiene agencias.');
  const configuracion = await Promise.all(agencias.map(async (agencia) => ({
    ...agencia,
    ...ubicacionAgenciaPutumayo(agencia.municipio),
    servicios: await Promise.all(agencia.servicios.map(async (servicio) => {
      const fila = await catalogo.obtenerFila(agencia.id, servicio.id);
      if (!fila) throw new Error(`El servicio ${servicio.codigo} ya no está disponible en ${agencia.codigo}.`);
      return {
        id: servicio.id,
        codigo: servicio.codigo,
        prefijo: fila.prefijoTurno,
        ventanillas: fila.ventanillas,
        activa: fila.activa,
        ...fila.horario,
      };
    })),
  })));
  const manifiesto = await enTransaccion(pool, async (cliente) => {
    await cliente.query('INSERT INTO demo_escenario (unico, semilla) VALUES (true, $1) ON CONFLICT DO NOTHING', [semillaSolicitada]);
    const { rows: [escenario] } = await cliente.query<{ semilla: number }>('SELECT semilla FROM demo_escenario WHERE unico');
    const agenciasDemo: AgenciaDemo[] = [];
    for (const agencia of configuracion) {
      const participantes = await guardarParticipantes(cliente, participantesDe(agencia, escenario.semilla));
      agenciasDemo.push({
        ...agencia,
        administradores: participantes.filter((p) => p.rol === 'ADMIN_AGENCIA').map((p) => p.id),
        funcionarios: participantes.filter((p) => p.rol === 'FUNCIONARIO').map((p) => ({ id: p.id, servicioId: p.servicio_id })),
        asociados: participantes.filter((p) => p.rol === 'ASOCIADO').map((p) => p.id),
      });
    }
    return { semilla: escenario.semilla, agencias: agenciasDemo };
  });
  return manifiesto;
}

export async function asignarCorreoDemo(pool: Pool, identificador: string, correoNuevo: string): Promise<{ id: string; correo: string }> {
  const selector = normalizarCorreo(identificador);
  const idDemo = isUUID(selector) ? selector : null;
  const alias = selector.endsWith(DOMINIO_DEMO) && isEmail(selector) ? selector : null;
  const correo = normalizarCorreo(correoNuevo);
  if ((!idDemo && !alias) || !isEmail(correo) || correo.length > 254 || correo.endsWith(DOMINIO_DEMO)) {
    throw new Error('Indica el UUID o el correo ficticio de una cuenta demo y un correo válido de acceso.');
  }
  return enTransaccion(pool, async (cliente) => {
    const { rows: [cuenta] } = await cliente.query<{ id: string }>(
      `SELECT u.id FROM usuario u JOIN demo_participante p ON p.usuario_id = u.id
       WHERE u.id = $1 OR u.email = $2`, [idDemo, alias],
    );
    if (!cuenta) throw new Error('No se encontró esa cuenta de demostración.');
    const existente = await cliente.query('SELECT 1 FROM usuario WHERE email = $1 AND id <> $2', [correo, cuenta.id]);
    if (existente.rowCount) throw new Error('El correo ya está asociado a otra cuenta.');
    const cambio = await cliente.query(
      `UPDATE usuario u SET email = $2, actualizado_en = now()
       FROM demo_participante p
       WHERE u.id = p.usuario_id AND u.id = $1 AND (u.email LIKE $3 OR u.email = $2)
         AND u.activo AND NOT u.email_verificado AND u.password_hash IS NULL
         AND NOT EXISTS (SELECT 1 FROM identidad_federada f WHERE f.usuario_id = u.id)`,
      [cuenta.id, correo, `%${DOMINIO_DEMO}`],
    );
    if (!cambio.rowCount) throw new Error('La cuenta no es ficticia o su acceso ya fue configurado.');
    return { id: cuenta.id, correo };
  });
}
