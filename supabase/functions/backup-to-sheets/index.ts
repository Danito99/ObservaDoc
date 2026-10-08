// ObservaDoc — respaldo de todas las tablas a una hoja de Google Sheets.
//
// Motivo: tener una copia legible fuera de Supabase por si algo le pasa a la
// base de datos (incidente, borrado accidental, etc.). No es un dashboard en
// vivo ni reemplaza a Supabase — es una red de seguridad.
//
// Se puede disparar de dos formas:
//   1. Manualmente, desde el botón "🔄 Respaldar ahora" en Gestionar equipo
//      (ver backupToSheets() en index.html).
//   2. Automáticamente, con un cron job de Supabase (pg_cron) que llame esta
//      función cada N minutos — ver instrucciones en el README del proyecto
//      o pedir a Daniel el detalle de configuración.
//
// Cada tabla de la app se escribe en su propia hoja (tab) dentro de un mismo
// spreadsheet, sobreescribiendo el contenido completo en cada corrida (no es
// incremental — así no hay riesgo de que quede información vieja mezclada).
//
// Requiere los secretos:
//   GOOGLE_SA_EMAIL        correo de la cuenta de servicio de Google Cloud
//   GOOGLE_SA_PRIVATE_KEY  llave privada (PEM) de esa cuenta de servicio
//   GOOGLE_SHEETS_ID       ID del spreadsheet destino (de su URL)
// La cuenta de servicio debe tener permiso de Editor sobre ese spreadsheet.
//
// Desplegar con verify_jwt = true (default): solo usuarios autenticados de
// la app, o el propio cron con la service_role key, pueden disparar esto.

import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleAuth } from "npm:google-auth-library@9";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_SA_EMAIL = Deno.env.get("GOOGLE_SA_EMAIL")!;
const GOOGLE_SA_PRIVATE_KEY = Deno.env.get("GOOGLE_SA_PRIVATE_KEY")!;
const GOOGLE_SHEETS_ID = Deno.env.get("GOOGLE_SHEETS_ID")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Todas las tablas que usa la app. Si se agrega una tabla nueva en el futuro,
// agregarla aquí para que también quede respaldada.
const TABLES = [
  "teachers", "leaders", "profiles", "activities",
  "badge_validations", "team_challenges",
  "form_lw", "form_fo", "form_mc", "form_fb",
  "coaching_plans", "coaching_cycles",
];

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

function cellValue(v: unknown): string | number | boolean {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({
    credentials: {
      client_email: GOOGLE_SA_EMAIL,
      // Los secretos a veces guardan el salto de línea como "\n" literal en
      // vez de un salto real — normalizamos por si acaso.
      private_key: GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("No se pudo obtener token de acceso de Google");
  return token.token;
}

async function ensureSheetsExist(token: string, titles: string[]) {
  const res = await fetch(`${SHEETS_API}/${GOOGLE_SHEETS_ID}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`No se pudo leer el spreadsheet: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const existing = new Set((data.sheets || []).map((s: any) => s.properties.title));
  const missing = titles.filter((t) => !existing.has(t));
  if (!missing.length) return;

  const res2 = await fetch(`${SHEETS_API}/${GOOGLE_SHEETS_ID}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
    }),
  });
  if (!res2.ok) throw new Error(`No se pudieron crear las hojas faltantes: ${res2.status} ${await res2.text()}`);
}

async function writeSheet(token: string, title: string, rows: Record<string, unknown>[]) {
  const range = encodeURIComponent(`${title}!A1:ZZ`);
  // Limpia todo el contenido anterior de la hoja antes de escribir — evita
  // que queden filas viejas si la tabla ahora tiene menos registros.
  const clearRes = await fetch(`${SHEETS_API}/${GOOGLE_SHEETS_ID}/values/${range}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!clearRes.ok) throw new Error(`No se pudo limpiar ${title}: ${clearRes.status} ${await clearRes.text()}`);

  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const values = [headers, ...rows.map((r) => headers.map((h) => cellValue(r[h])))];

  const updateRange = encodeURIComponent(`${title}!A1`);
  const updateRes = await fetch(
    `${SHEETS_API}/${GOOGLE_SHEETS_ID}/values/${updateRange}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
  if (!updateRes.ok) throw new Error(`No se pudo escribir ${title}: ${updateRes.status} ${await updateRes.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Método no soportado" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = await getAccessToken();
    await ensureSheetsExist(token, [...TABLES, "_status"]);

    const results: { name: string; rows: number }[] = [];
    for (const table of TABLES) {
      const { data, error } = await admin.from(table).select("*");
      if (error) {
        results.push({ name: table, rows: -1 });
        console.log(`ERROR leyendo ${table}: ${error.message}`);
        continue;
      }
      await writeSheet(token, table, data || []);
      results.push({ name: table, rows: (data || []).length });
    }

    // Hoja de estado: para que al abrir el spreadsheet se vea de un vistazo
    // cuándo fue la última corrida y si alguna tabla falló.
    await writeSheet(token, "_status", [
      {
        ultima_sincronizacion: new Date().toISOString(),
        tablas_ok: results.filter((r) => r.rows >= 0).length,
        tablas_con_error: results.filter((r) => r.rows < 0).map((r) => r.name).join(", ") || "ninguna",
        detalle: results.map((r) => `${r.name}:${r.rows}`).join(" | "),
      },
    ]);

    return new Response(JSON.stringify({ ok: true, tables: results }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.log(`ERROR en backup-to-sheets: ${String(err)}`);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 502, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
