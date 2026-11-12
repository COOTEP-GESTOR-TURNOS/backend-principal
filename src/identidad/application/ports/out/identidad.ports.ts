export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

/** Hash adaptable de contraseñas. El adaptador usa Argon2id. */
export interface PasswordHasherPort {
  hash(clave: string): Promise<string>;
  verificar(hash: string, clave: string): Promise<boolean>;
}

export type ProveedorOidc = 'google' | 'microsoft';

/** Identidad confirmada por el proveedor. No trae roles: el rol se asigna en el sistema. */
export interface IdentidadExterna {
  proveedor: ProveedorOidc;
  sujeto: string; // claim sub del ID token
  email: string;
  emailVerificado: boolean;
  nombre: string;
}

export interface InicioAutorizacion {
  url: string;
  state: string;
  nonce: string;
  verificadorPkce: string;
}

/** Puerto de salida hacia los proveedores de OpenID Connect. */
export interface IdentityProviderPort {
  iniciar(proveedor: ProveedorOidc): Promise<InicioAutorizacion>;
  /** Canjea el código y valida el ID token: firma (JWKS), emisor, audiencia, vencimiento y nonce. */
  completar(proveedor: ProveedorOidc, codigo: string, verificadorPkce: string, nonce: string): Promise<IdentidadExterna>;
}
