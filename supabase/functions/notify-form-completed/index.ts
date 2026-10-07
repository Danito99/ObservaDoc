// ObservaDoc — correo con el PDF adjunto cuando se completa una observación
// (Observación Formal, Learning Walk, Modelaje o Feedback).
//
// La llama el cliente (ver emailFormPdf en index.html) justo después de
// guardar el formulario correspondiente. El PDF ya viene generado del lado
// del cliente (html2pdf.js) en base64 — esta función solo busca el correo
// del docente observado y lo adjunta al correo.
//
// Envía por SMTP usando la misma cuenta de servicio que notify-hito-validado
// (ver ese archivo para el detalle de los secretos SMTP_USER/SMTP_PASSWORD).
//
// Desplegar con verify_jwt = true (default): solo usuarios autenticados de
// la app pueden disparar el envío.

import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { encodeHeaderSubject } from "../_shared/subject-encode.ts";

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

const FORM_LABELS: Record<string, string> = {
  fo: "Observación Formal",
  lw: "Learning Walk",
  mc: "Modelaje de Clase",
  fb: "Sesión de Feedback",
};

const FORM_COLOR: Record<string, string> = {
  fo: "#F59120",
  lw: "#2B91CF",
  mc: "#44579C",
  fb: "#e11d48",
};

function escHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function buildEmailHtml(opts: { teacherName: string; label: string; color: string }): string {
  const { teacherName, label, color } = opts;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(label)}</title>
<style>
  @keyframes pop { 0% { transform: scale(0.4); opacity: 0; } 70% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
  .badge-anim { animation: pop .6s cubic-bezier(.26,1.4,.4,1) both; }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f3f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f1;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06);">
        <tr>
          <td style="background:linear-gradient(135deg, ${color}, ${color}cc);padding:32px 32px 24px;text-align:center;">
            <span class="badge-anim" style="display:inline-block;background:#ffffff;color:${color};width:60px;height:60px;border-radius:50%;line-height:60px;font-size:28px;margin-bottom:10px;">📄</span>
            <div style="color:#ffffff;font-weight:700;font-size:19px;letter-spacing:.2px;">${escHtml(label)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 32px 30px;">
            <p style="margin:0 0 4px;font-size:14px;color:#6b6b6b;">Hola <strong style="color:#1a1a1a;">${escHtml(teacherName)}</strong>,</p>
            <p style="margin:0;font-size:14.5px;color:#3a3a3a;line-height:1.55;">
              Adjunto encontrarás el PDF de tu sesión de ${escHtml(label).toLowerCase()}. Gracias por seguir abierto(a) al acompañamiento — ¡sigue así!
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 28px;text-align:center;">
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

  const formType = String(body.form_type || "").trim();
  const teacherName = String(body.teacher_name || "").trim();
  const pdfBase64 = String(body.pdf_base64 || "");

  const label = FORM_LABELS[formType];
  if (!label || !teacherName || !pdfBase64) {
    console.log(`SKIP: datos incompletos — form_type=${formType} teacher_name="${teacherName}" pdf_len=${pdfBase64.length}`);
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: teacherRows, error: teacherErr } = await admin
    .from("teachers")
    .select("email")
    .eq("name", teacherName)
    .limit(1);
  const email = teacherRows?.[0]?.email;
  if (!email) {
    console.log(`SKIP: sin correo para teacher_name="${teacherName}" — filas encontradas=${teacherRows?.length ?? 0} error=${teacherErr?.message ?? "ninguno"}`);
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "Sin correo registrado" }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  console.log(`ENVIANDO a ${email} (docente="${teacherName}", form_type=${formType})`);

  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: true,
      auth: { username: SMTP_USER, password: SMTP_PASSWORD },
    },
  });

  try {
    await client.send({
      from: FROM_EMAIL,
      to: email,
      bcc: BCC_EMAIL,
      subject: encodeHeaderSubject(`${label} — PDF de tu sesión`),
      html: buildEmailHtml({ teacherName, label, color: FORM_COLOR[formType] }),
      content: "auto",
      attachments: [
        {
          filename: `${label.replace(/\s+/g, "_")}_${teacherName.replace(/\s+/g, "_")}.pdf`,
          content: pdfBase64,
          encoding: "base64",
          contentType: "application/pdf",
        },
      ],
    });
  } catch (err) {
    console.log(`ERROR al enviar a ${email}: ${String(err)}`);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 502, headers: { ...CORS, "Content-Type": "application/json" },
    });
  } finally {
    await client.close();
  }

  console.log(`OK: correo enviado a ${email}`);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
