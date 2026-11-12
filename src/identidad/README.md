# Módulo de identidad (pendiente)

El contrato ya existe (`AuthController`, puertos en `application/ports/out/identidad.ports.ts`).
Falta implementar, en este orden:

1. **Inicio local** (`POST /auth/login`): buscar el usuario por correo normalizado, verificar con
   `Argon2PasswordAdapter`, contar intentos fallidos en Redis (`login:intentos:{correo}:{ip}`,
   5 intentos, 15 min, respuesta 429) y registrar en la auditoría los accesos administrativos.
2. **MFA TOTP** (RFC 6238): obligatorio para `SUPERADMIN` y `ADMIN_AGENCIA`. Guardar el secreto
   cifrado en `usuario.mfa_secreto_cifrado`. Si `debe_cambiar_password` es true, exigir el cambio.
3. **Sesiones**: JWT de acceso de 10 min firmado con `JWT_SECRETO` (mismo formato que
   `src/cli/token-desarrollo.ts`) y token de renovación opaco en Redis (`sess:{id}`), que rota en
   cada uso y caduca a los 30 min sin uso o a las 12 h. Web: cookie `HttpOnly`, `Secure`,
   `SameSite=Strict`, `Path=/api/v1/auth`. Al cerrar sesión, borrar `sess:{id}` y revocar el `jti`.
4. **OIDC con Google y Microsoft** (`OidcProviderAdapter`): código de autorización con PKCE,
   `state` y `nonce` en Redis por 10 min; validar el ID token con `createRemoteJWKSet` y
   `jwtVerify` de `jose`; buscar `(proveedor, sub)` en `identidad_federada`; si no existe, crear el
   usuario como `ASOCIADO`. La cuenta externa nunca trae privilegios.
5. **Recuperación de contraseña**: enlace de un solo uso válido 15 min (solo su hash en Redis).
