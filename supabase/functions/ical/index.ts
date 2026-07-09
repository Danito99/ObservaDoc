// ObservaDoc — feed iCal en vivo para Outlook/Google Calendar.
//
// Dos modos:
//  1. GET ?t=<token>   → devuelve el calendario (text/calendar) del líder.
//     Outlook lo consulta periódicamente sin autenticación; el token es un
//     HMAC firmado con la service-role key, así nadie puede adivinar el feed
//     de otro líder.
//  2. GET con Authorization: Bearer <jwt de usuario> → devuelve JSON con la
//     URL personal del feed. La app lo llama al iniciar sesión para mostrar
//     el link en "Mi calendario".
//
// Desplegar con verify_jwt = false (ver supabase/config.toml) para que
// Outlook pueda leer el feed sin headers.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const TYPE_LABELS: Record<string, string> = {
  LW: "Learning Walk",
  FO: "Observación Formal",
  FB: "Feedback",
  MC: "Modeling Class",
};

const enc = new TextEncoder();

async function signLeader(leader: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(leader));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function b64urlEncode(s: string): string {
  return btoa(String.fromCharCode(...enc.encode(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
}

async function makeToken(leader: string): Promise<string> {
  return `${b64urlEncode(leader)}.${await signLeader(leader)}`;
}

// Escapa texto para propiedades iCal (RFC 5545 §3.3.11)
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Pliega líneas a máximo 75 octetos (RFC 5545 §3.1); la continuación
// arranca con un espacio que también cuenta dentro del límite.
function fold(line: string): string {
  let out = "", cur = "", curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > 75) {
      out += cur + "\r\n ";
      cur = "";
      curBytes = 1;
    }
    cur += ch;
    curBytes += b;
  }
  return out + cur;
}

// deno-lint-ignore no-explicit-any
function buildICS(leader: string, activities: any[]): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ObservaDoc//MX",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc("ObservaDoc — " + leader)}`,
    "X-WR-TIMEZONE:America/Mexico_City",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    "BEGIN:VTIMEZONE",
    "TZID:America/Mexico_City",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0600",
    "TZOFFSETTO:-0600",
    "TZNAME:CST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  for (const a of activities) {
    if (!a.date) continue;
    const dateStr = a.date.replace(/-/g, "");
    const nextDay = new Date(a.date + "T00:00:00Z");
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextStr = nextDay.toISOString().split("T")[0].replace(/-/g, "");
    let dtstart, dtend;
    if (a.start_time && a.end_time) {
      const st = a.start_time.replace(/:/g, "").substring(0, 4) + "00";
      const et = a.end_time.replace(/:/g, "").substring(0, 4) + "00";
      dtstart = `DTSTART;TZID=America/Mexico_City:${dateStr}T${st}`;
      dtend = `DTEND;TZID=America/Mexico_City:${dateStr}T${et}`;
    } else {
      dtstart = `DTSTART;VALUE=DATE:${dateStr}`;
      dtend = `DTEND;VALUE=DATE:${nextStr}`;
    }
    const summary = `${TYPE_LABELS[a.type] || a.type} - ${a.teacher_name || ""}`;
    const descParts = [`Estado: ${a.status === "done" ? "Completada" : "Pendiente"}`];
    if (a.notes) descParts.push(a.notes);
    lines.push(
      "BEGIN:VEVENT",
      `UID:act_${a.id}@observadoc.mx`,
      `DTSTAMP:${now}`,
      `SUMMARY:${esc(summary)}`,
      dtstart,
      dtend,
      `DESCRIPTION:${esc(descParts.join("\n"))}`,
      `STATUS:${a.status === "done" ? "CONFIRMED" : "TENTATIVE"}`,
    );
    if (a.evidence_url) lines.push(`URL:${a.evidence_url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Modo 1: Outlook pide el feed con su token
  if (token) {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return new Response("Token inválido", { status: 400, headers: CORS });
    let leader: string;
    try {
      leader = b64urlDecode(token.slice(0, dot));
    } catch {
      return new Response("Token inválido", { status: 400, headers: CORS });
    }
    const expected = await signLeader(leader);
    if (token.slice(dot + 1) !== expected) {
      return new Response("Token inválido", { status: 403, headers: CORS });
    }
    const { data, error } = await admin
      .from("activities")
      .select("*")
      .eq("leader_name", leader)
      .order("date", { ascending: true });
    if (error) return new Response("Error al leer actividades", { status: 500, headers: CORS });
    return new Response(buildICS(leader, data || []), {
      headers: {
        ...CORS,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="observadoc.ics"',
        "Cache-Control": "no-cache",
      },
    });
  }

  // Modo 2: la app (usuario autenticado) pide su URL personal
  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  const { data: profiles } = await admin
    .from("profiles")
    .select("leader_name")
    .eq("id", userData.user.id)
    .limit(1);
  const leaderName = profiles?.[0]?.leader_name;
  if (!leaderName) {
    return new Response(JSON.stringify({ error: "Tu perfil no tiene nombre de líder asignado" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  const feedUrl = `${SUPABASE_URL}/functions/v1/ical?t=${await makeToken(leaderName)}`;
  return new Response(JSON.stringify({ url: feedUrl }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
