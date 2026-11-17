# backend-principal · COOTEP Turno

Backend principal en **NestJS 11 con arquitectura hexagonal**. Es la única API que usan la web y
la app móvil: identidad, permisos, catálogo, ciclo de vida del turno, tiempo real (Socket.IO) y
auditoría. Llama al motor de filas (Spring Boot) y a la analítica (FastAPI) por HTTP interno.

## Arquitectura hexagonal

```
src/
├── turnos/
│   ├── domain/                 Turno (máquina de estados), Fila, PoliticaPreferencial,
│   │                           estimarEsperaMin: TypeScript puro, sin NestJS ni bases de datos
│   ├── application/
│   │   ├── ports/in/           SolicitarTurno, CancelarTurno, ConsultarMiTurno, LlamarSiguiente,
│   │   │                       AtenderTurno, ConfirmarPresencia
│   │   ├── ports/out/          TurnoRepository, MotorFilasPort, EstimadorPort, EventStorePort,
│   │   │                       NotificadorPort, CatalogoPort, PerfilAsociadoPort, Reloj, GeneradorIds
│   │   └── use-cases/          una clase por caso de uso; sin decoradores de NestJS
│   ├── infrastructure/
│   │   ├── in/http, in/ws      TurnosController, FilasController, FilasGateway (Socket.IO)
│   │   └── out/                TurnoPgRepository, CatalogoPgAdapter, MotorFilasHttpAdapter,
│   │                           EstimadorHttpAdapter, EventosMongoAdapter, NotificadorSocketAdapter,
│   │                           adaptadores en memoria para las pruebas
│   └── turnos.module.ts        enlaza cada puerto con su adaptador (useClass / useFactory)
├── identidad/                  PasswordHasherPort ← Argon2PasswordAdapter; IdentityProviderPort ← OIDC
├── auditoria/                  AuditLogPort ← AuditCassandraAdapter
└── compartido/                 errores del dominio, Principal, caché Redis, filtro RFC 9457
```

Regla: `domain/` y `application/` no importan NestJS, `pg`, `mongodb` ni clientes HTTP. Las
dependencias apuntan hacia el dominio y los casos de uso se prueban con adaptadores en memoria.

## Desarrollo

```bash
npm ci
cp .env.example .env          # ajuste las URL de los motores
npm run start:dev             # http://localhost:3000/api/v1 · OpenAPI en /api/docs
npm test                      # unitarias + integración (necesita Docker en marcha)
npm run test:unit             # solo unitarias, sin Docker (adaptadores en memoria)
npm run test:integracion      # solo integración: PostgreSQL y Redis con Testcontainers
```

Las pruebas de integración (`test/integracion`) levantan PostgreSQL y Redis en contenedores con
el esquema de `cootep-turno/infra/init/postgres` (se busca junto a este repositorio o un nivel
arriba; `ESQUEMA_POSTGRES` lo cambia) y prueban el backend real por HTTP: PR-14 (un asociado no
cancela un turno ajeno) y PR-15 (dos solicitudes simultáneas: una entra y la otra recibe 409).

Para probar la API sin pasar por el inicio de sesión:

```bash
npm run demo:sembrar                              # usuarios ficticios con su id
npm run token:dev -- ASOCIADO <id-del-asociado>   # JWT de prueba (8 h, solo desarrollo)
```

Para depurar el inicio con MFA (superadministrador y directivos) sin el teléfono, el código TOTP
del momento (solo desarrollo):

```bash
npm run totp:dev -- <SECRETO>              # al configurar MFA: el secreto que se ve bajo el QR
npm run totp:dev -- --correo <correo>      # con MFA ya configurado: descifra el secreto guardado
# En Docker:
docker compose -f infra/compose.apps.yml exec -e NODE_ENV=development backend-principal \
  node dist/cli/codigo-totp.js --correo superadmin@cootep-turno.test
```

## Concurrencia (sección 6 del informe)

- `ConsultarMiTurnoService`: posición (motor de filas) y datos de espera (analítica) se piden a la
  vez con `Promise.allSettled`; cada llamada se cancela a los 2 s con `AbortSignal.timeout`.
- Unicidad bajo concurrencia: índices únicos de PostgreSQL (`ux_turno_activo_asociado`,
  `ux_turno_idempotencia`) y bloqueo optimista por `version`.

Medición de la sección 10 (la consulta con las dos llamadas en secuencia contra en paralelo, sobre
el stack de Docker; resultados en `cootep-turno/docs/evidencias/mediciones`):

```bash
docker compose -f infra/compose.apps.yml exec -T backend-principal \
  node dist/cli/medir-paralelismo.js <asociadoId-con-turno-activo> 100 10 0 10:00
```

## Pendiente

- Reconciliación al arrancar: reponer en Redis los turnos activos de PostgreSQL.
