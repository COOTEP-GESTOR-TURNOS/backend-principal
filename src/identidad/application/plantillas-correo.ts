import type { MensajeCorreo } from './ports/out/seguridad.ports';

const escapar = (texto: string) =>
  texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Correo sencillo y accesible: un párrafo, un botón con texto claro y el enlace en texto plano. */
function armar(para: string, asunto: string, nombre: string, parrafos: string[], boton: { texto: string; url: string }, pie: string): MensajeCorreo {
  const texto = [`Hola, ${nombre}:`, '', ...parrafos, '', `${boton.texto}: ${boton.url}`, '', pie, '', 'COOTEP Turno'].join('\n');
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#F5F7FA;font-family:Arial,Helvetica,sans-serif;color:#1F2933">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E7EB;border-radius:8px;padding:24px">
    <h1 style="margin:0 0 16px;font-size:20px;color:#0F6E56">COOTEP Turno</h1>
    <p>Hola, ${escapar(nombre)}:</p>
    ${parrafos.map((p) => `<p>${escapar(p)}</p>`).join('\n    ')}
    <p style="margin:24px 0"><a href="${escapar(boton.url)}" style="display:inline-block;background:#0F6E56;color:#FFFFFF;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">${escapar(boton.texto)}</a></p>
    <p style="font-size:14px;color:#52606D">Si el botón no funciona, copia este enlace en tu navegador:<br>${escapar(boton.url)}</p>
    <p style="font-size:14px;color:#52606D">${escapar(pie)}</p>
  </div>
</body></html>`;
  return { para, asunto, texto, html };
}

export const plantillas = {
  recuperar: (para: string, nombre: string, url: string): MensajeCorreo =>
    armar(
      para,
      'Restablece tu contraseña de COOTEP Turno',
      nombre,
      ['Recibimos una solicitud para restablecer tu contraseña. El enlace sirve una sola vez y vence en 15 minutos.'],
      { texto: 'Restablecer contraseña', url },
      'Si no fuiste tú, ignora este correo: tu contraseña no cambia.',
    ),

  activar: (para: string, nombre: string, url: string, rol: string): MensajeCorreo =>
    armar(
      para,
      'Activa tu cuenta de COOTEP Turno',
      nombre,
      [
        `Un administrador creó tu cuenta con el rol ${rol}.`,
        'Define tu contraseña para empezar. El enlace sirve una sola vez y vence en 72 horas.',
      ],
      { texto: 'Activar mi cuenta', url },
      'Si no esperabas este correo, avisa al administrador de tu agencia.',
    ),

  verificarCorreo: (para: string, nombre: string, url: string): MensajeCorreo =>
    armar(
      para,
      'Confirma tu correo en COOTEP Turno',
      nombre,
      ['Gracias por registrarte. Confirma tu correo para poder iniciar sesión. El enlace vence en 24 horas.'],
      { texto: 'Confirmar mi correo', url },
      'Si no creaste esta cuenta, ignora este correo.',
    ),
};
