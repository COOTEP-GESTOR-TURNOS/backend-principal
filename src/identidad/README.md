# Módulo de identidad

Quién es la persona (autenticación) y la gestión de su cuenta. Qué puede hacer lo decide su rol
local (`asignacion_rol`), nunca el proveedor externo. La administración de usuarios y roles está
en `src/administracion/` y reutiliza los puertos que este módulo exporta.

## Responsabilidades por tecnología

| Dato | Motor | Adaptador |
|---|---|---|
| Cuentas, roles con ámbito, cuentas de Google vinculadas | PostgreSQL | `out/postgres/usuario-pg.repository.ts` |
| Sesiones de renovación (`sess:{hash}`), retos de MFA, estados OIDC, enlaces de un solo uso, límites de intentos | Redis | `out/redis/*` |
| Inicios administrativos y fallidos, MFA configurado, claves restablecidas, cambios de rol | Cassandra | `auditoria/` |
| Correos de verificación, activación y recuperación | SMTP (Mailpit en desarrollo) | `out/correo/smtp-correo.adapter.ts` |

## Flujos

- **Registro público** (`POST /auth/registro`): solo crea asociados, sin verificar. El correo trae
  un enlace (24 h) a `/verificar-correo`; sin verificar no se puede ingresar.
- **Inicio local** (`POST /auth/login`): 5 intentos fallidos por correo e IP bloquean 15 min (429).
  La respuesta es `SESION_INICIADA` o `PASO_PENDIENTE` con un `reto` y el `paso`:
  - `CAMBIAR_CLAVE` → `POST /auth/clave-inicial` (clave temporal del superadministrador).
  - `CONFIGURAR_MFA` → `POST /auth/mfa/configurar` (QR) y `POST /auth/mfa/verificar`.
  - `VERIFICAR_MFA` → `POST /auth/mfa/verificar`.
  MFA (TOTP, RFC 6238) es obligatorio para `SUPERADMIN` y `ADMIN_AGENCIA`. El secreto se guarda
  cifrado con AES-256-GCM (`CLAVE_CIFRADO_MFA`) y un código no se acepta dos veces.
- **Google** (`GET /auth/oidc/google/inicio?cliente=web|movil`): código de autorización + PKCE,
  `state` y `nonce` en Redis; el ID token se valida con las llaves públicas de Google. Una cuenta
  nueva se crea como asociado sin documento (lo completa con `PATCH /auth/yo`). Si el correo ya
  existe se vincula; si esa cuenta local no estaba verificada, se borra su contraseña.
  La web vuelve a `/ingresar?oidc=ok` con la cookie puesta; el móvil a `cootepturno://oidc?codigo=…`
  y canjea el código en `POST /auth/oidc/canjear`.
- **Sesión**: JWT de acceso de 10 min (HS256, con `roles` y `amr`) y renovación opaca que rota en
  cada uso (30 min sin uso, 12 h máximo). Web: cookie `cootep_sesion` HttpOnly, SameSite=Strict,
  `Path=/api/v1/auth`, y cabecera anti-CSRF `X-Cootep-Csrf: 1`. Móvil: cabecera `X-Cliente: movil`
  y tokens en el cuerpo. `POST /auth/cerrar-sesion` borra la renovación y revoca el `jti`.
- **Recuperación** (`POST /auth/recuperar` → `POST /auth/restablecer`): enlace de un solo uso de
  15 min; solo vale el último enviado; al usarlo se cierran todas las sesiones. Responde igual
  exista o no la cuenta. El mismo formulario sirve para activar las cuentas que crea un administrador.

## Primer superadministrador

```bash
docker compose -f infra/compose.apps.yml exec backend-principal node dist/cli/crear-superadmin.js
```

Ingresa con `SUPERADMIN_EMAIL` y la clave temporal; el sistema exige cambiarla y configurar MFA.
