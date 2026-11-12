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
npm test                      # pruebas unitarias con Jest
```

Para probar la API mientras se implementa el inicio de sesión:

```bash
npm run demo:sembrar                              # usuarios ficticios con su id
npm run token:dev -- ASOCIADO <id-del-asociado>   # JWT de prueba (8 h, solo desarrollo)
```

## Concurrencia (sección 6 del informe)

- `ConsultarMiTurnoService`: posición (motor de filas) y datos de espera (analítica) se piden a la
  vez con `Promise.allSettled`; cada llamada se cancela a los 2 s con `AbortSignal.timeout`.
- Unicidad bajo concurrencia: índices únicos de PostgreSQL (`ux_turno_activo_asociado`,
  `ux_turno_idempotencia`) y bloqueo optimista por `version`.

## Pendiente

- Módulo de identidad completo (ver `src/identidad/README.md`).
- `VencimientosScheduler`: marcar ausentes los turnos próximos sin confirmar (RN-10).
- Reconciliación al arrancar: reponer en Redis los turnos activos de PostgreSQL.
- Casos de uso administrativos (agencias, servicios, usuarios, parámetros, cierre de agencia) con auditoría.
