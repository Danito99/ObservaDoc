// ObservaDoc — correo de felicitación cuando se valida un hito.
//
// La llama el cliente (ver saveHitoValidation en index.html) justo después de
// guardar una validación con validated = true, solo para los programas
// "Aprendizaje Activo y Clases Atractivas" (aprendizaje) y "Talleres
// Innovation Lab" (lab).
//
// Envía por SMTP usando una cuenta de servicio de Google Workspace
// (chcbooks.com) — así el remitente es un dominio institucional ya
// verificado, sin depender de registros DNS propios de ObservaDoc.
// Requiere los secretos:
//   SMTP_USER     cuenta de servicio, ej. observadoc@chcbooks.com
//   SMTP_PASSWORD contraseña de aplicación (App Password) de esa cuenta
//
// Desplegar con verify_jwt = true (default): solo usuarios autenticados de
// la app pueden disparar el envío.

import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMTP_USER = Deno.env.get("SMTP_USER")!;
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD")!;
const SMTP_HOST = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465");
const FROM_EMAIL = Deno.env.get("NOTIFY_FROM_EMAIL") || `ObservaDoc <${SMTP_USER}>`;
const BCC_EMAIL = Deno.env.get("NOTIFY_BCC_EMAIL") || SMTP_USER;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Solo estos programas disparan correo (Aprendizaje Activo y Clases
// Atractivas, y Talleres Innovation Lab). Clínicas de Estrategias de Aula
// queda fuera a propósito.
const PROGRAMA_LABELS: Record<string, string> = {
  aprendizaje: "Aprendizaje Activo y Clases Atractivas",
  lab: "Talleres Innovation Lab",
};

const PROGRAMA_COLOR: Record<string, string> = {
  aprendizaje: "#F59120",
  lab: "#2e8b5b",
};

function escHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function buildTeammateEmailHtml(opts: {
  teacherName: string;
  programaLabel: string;
  color: string;
  hitoNombre: string;
  flotilla: string;
}): string {
  const { teacherName, programaLabel, color, hitoNombre, flotilla } = opts;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Un compañero de tu flotilla avanzó</title>
<style>
  @keyframes pop { 0% { transform: scale(0.4); opacity: 0; } 70% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
  @keyframes float1 { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-10px) rotate(12deg); } }
  @keyframes float2 { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(8px) rotate(-10deg); } }
  .badge-anim { animation: pop .6s cubic-bezier(.26,1.4,.4,1) both; }
  .confetti-a { animation: float1 2.6s ease-in-out infinite; display:inline-block; }
  .confetti-b { animation: float2 2.2s ease-in-out infinite; display:inline-block; }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f3f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f1;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06);">
        <tr>
          <td style="background:linear-gradient(135deg, ${color}, ${color}cc);padding:36px 32px 28px;text-align:center;">
            <div style="font-size:30px;line-height:1;margin-bottom:10px;">
              <span class="confetti-a">🎉</span>
              <span class="badge-anim" style="display:inline-block;background:#ffffff;color:${color};width:64px;height:64px;border-radius:50%;line-height:64px;font-size:32px;margin:0 10px;vertical-align:middle;">★</span>
              <span class="confetti-b">🎊</span>
            </div>
            <div style="color:#ffffff;font-weight:700;font-size:20px;letter-spacing:.2px;">¡Tu flotilla avanzó!</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 8px;">
            <p style="margin:0 0 20px;font-size:14.5px;color:#3a3a3a;line-height:1.55;">
              <strong style="color:#1a1a1a;">${escHtml(teacherName)}</strong>, de <strong>${escHtml(flotilla)}</strong>, acaba de validar un nuevo hito. ¡Aprovecha para felicitarlo cuando lo veas!
            </p>
            <table role="presentation" width="100%" style="background:#f8f7f5;border-radius:12px;border-left:4px solid ${color};margin-bottom:20px;">
              <tr><td style="padding:16px 18px;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${color};margin-bottom:4px;">${escHtml(programaLabel)}</div>
                <div style="font-size:16px;font-weight:600;color:#1a1a1a;margin-bottom:2px;">${escHtml(hitoNombre)}</div>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;text-align:center;">
            <div style="font-size:11px;color:#b5b5b5;">ObservaDoc · Christel House</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildEmailHtml(opts: {
  teacherName: string;
  programaLabel: string;
  color: string;
  hitoNombre: string;
  validatedBy: string;
}): string {
  const { teacherName, programaLabel, color, hitoNombre, validatedBy } = opts;
  // Animación por CSS (@keyframes): la ven Apple Mail, iOS/Mac Mail, y la
  // mayoría de clientes basados en WebKit/Blink. Outlook de escritorio
  // ignora @keyframes y simplemente muestra el diseño estático de abajo, que
  // ya está pensado para verse bien sin movimiento.
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hito validado</title>
<style>
  @keyframes pop { 0% { transform: scale(0.4); opacity: 0; } 70% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
  @keyframes float1 { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-10px) rotate(12deg); } }
  @keyframes float2 { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(8px) rotate(-10deg); } }
  .badge-anim { animation: pop .6s cubic-bezier(.26,1.4,.4,1) both; }
  .confetti-a { animation: float1 2.6s ease-in-out infinite; display:inline-block; }
  .confetti-b { animation: float2 2.2s ease-in-out infinite; display:inline-block; }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f3f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f1;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06);">
        <tr>
          <td style="background:linear-gradient(135deg, ${color}, ${color}cc);padding:36px 32px 28px;text-align:center;">
            <div style="font-size:30px;line-height:1;margin-bottom:10px;">
              <span class="confetti-a">🎉</span>
              <span class="badge-anim" style="display:inline-block;background:#ffffff;color:${color};width:64px;height:64px;border-radius:50%;line-height:64px;font-size:32px;margin:0 10px;vertical-align:middle;">✓</span>
              <span class="confetti-b">🎊</span>
            </div>
            <div style="color:#ffffff;font-weight:700;font-size:20px;letter-spacing:.2px;">¡Hito validado!</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 8px;">
            <p style="margin:0 0 4px;font-size:14px;color:#6b6b6b;">Hola <strong style="color:#1a1a1a;">${escHtml(teacherName)}</strong>,</p>
            <p style="margin:0 0 20px;font-size:14.5px;color:#3a3a3a;line-height:1.55;">
              ¡Felicidades! Se validó un nuevo hito de tu programa de formación. Este es otro paso en tu camino de crecimiento docente — sigue así.
            </p>
            <table role="presentation" width="100%" style="background:#f8f7f5;border-radius:12px;border-left:4px solid ${color};margin-bottom:20px;">
              <tr><td style="padding:16px 18px;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${color};margin-bottom:4px;">${escHtml(opts.programaLabel)}</div>
                <div style="font-size:16px;font-weight:600;color:#1a1a1a;margin-bottom:2px;">${escHtml(hitoNombre)}</div>
                ${validatedBy ? `<div style="font-size:12.5px;color:#8a8a8a;margin-top:6px;">Validado por ${escHtml(validatedBy)}</div>` : ""}
              </td></tr>
            </table>
            <p style="margin:0 0 24px;font-size:13px;color:#8a8a8a;line-height:1.5;">
              Puedes ver tu avance completo y los próximos hitos dentro de ObservaDoc.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;text-align:center;">
            <div style="font-size:11px;color:#b5b5b5;">ObservaDoc · Christel House</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Método no soportado" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON inválido" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const teacherName = String(body.teacher_name || "").trim();
  const programaId = String(body.programa_id || "").trim();
  const hitoNombre = String(body.hito_nombre || "").trim();
  const validatedBy = String(body.validated_by || "").trim();

  const programaLabel = PROGRAMA_LABELS[programaId];
  if (!teacherName || !programaLabel || !hitoNombre) {
    // Programa fuera del alcance (p.ej. clínicas) o datos incompletos: no es
    // un error, simplemente no hay correo que mandar.
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: teacherRows } = await admin
    .from("teachers")
    .select("email, flotilla")
    .eq("name", teacherName)
    .limit(1);
  const teacher = teacherRows?.[0];
  const color = PROGRAMA_COLOR[programaId] || "#F59120";

  let teammates: { name: string; email: string }[] = [];
  if (teacher?.flotilla) {
    const { data: teammateRows } = await admin
      .from("teachers")
      .select("name, email")
      .eq("flotilla", teacher.flotilla)
      .eq("active", true)
      .neq("name", teacherName);
    teammates = (teammateRows || []).filter((t) => !!t.email);
  }

  if (!teacher?.email && teammates.length === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "Sin correo registrado" }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: true,
      auth: { username: SMTP_USER, password: SMTP_PASSWORD },
    },
  });

  let sentToSelf = false;
  let sentToTeammates = 0;
  try {
    if (teacher?.email) {
      await client.send({
        from: FROM_EMAIL,
        to: teacher.email,
        bcc: BCC_EMAIL,
        subject: `✓ Hito validado: ${hitoNombre}`,
        html: buildEmailHtml({ teacherName, programaLabel, color, hitoNombre, validatedBy }),
        content: "auto",
      });
      sentToSelf = true;
    }

    if (teammates.length > 0) {
      const teammateHtml = buildTeammateEmailHtml({
        teacherName, programaLabel, color, hitoNombre, flotilla: teacher!.flotilla,
      });
      for (const mate of teammates) {
        await client.send({
          from: FROM_EMAIL,
          to: mate.email,
          bcc: BCC_EMAIL,
          subject: `🎉 ${teacherName} validó un hito — ¡felicítalo!`,
          html: teammateHtml,
          content: "auto",
        });
        sentToTeammates++;
      }
    }
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err), sentToSelf, sentToTeammates }), {
      status: 502, headers: { ...CORS, "Content-Type": "application/json" },
    });
  } finally {
    await client.close();
  }

  return new Response(JSON.stringify({ ok: true, sentToSelf, sentToTeammates }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
