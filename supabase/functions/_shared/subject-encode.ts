// ObservaDoc — codificador RFC 2047 correcto para el header Subject.
//
// denomailer@1.6.0 (deno.land/x/denomailer, usado por notify-hito-validado
// y notify-form-completed) tiene un bug en config/mail/encoding.ts:
// quotedPrintableEncodeInline() —la que codifica el Subject cuando trae
// acentos/emoji— llama a quotedPrintableEncode(), que es el codificador del
// CUERPO del mensaje: parte el texto cada 74 caracteres insertando un salto
// de línea suave "=\r\n". Eso es válido en el body (RFC 2045) pero RFC 2047
// prohíbe los saltos de línea suaves DENTRO de un encoded-word de cabecera,
// y además a esa línea partida le falta el espacio inicial que RFC 5322
// exige para reconocerla como continuación del mismo header. El resultado:
// un Subject roto a mitad de una secuencia de escape, que hace que Gmail
// (y otros clientes) descarten el parseo de todo el mensaje y muestren el
// MIME crudo sin decodificar.
//
// Con asuntos cortos (como "✓ Hito validado: <hito>") el texto codificado
// nunca llega a 74 caracteres y el bug no se activa — por eso esos correos
// siempre llegan bien. Con el de felicitación a la flotilla
// ("🎉 <nombre completo> validó un hito — ¡felicítalo!") el nombre completo
// más el emoji y los acentos casi siempre superan el umbral.
//
// No se puede evitar el bug pre-codificando nosotros mismos el subject y
// pasándolo tal cual a denomailer: su condición para decidir si debe
// codificar es `hasNonAsciiCharacters(data) || data.startsWith("=?")`, así
// que si detecta que el string ya empieza con "=?" lo vuelve a envolver en
// otra capa de codificación, dejándolo peor.
//
// La salida de encodeHeaderSubject() es ASCII puro y nunca empieza con
// "=?", así que esa condición da falso en ambos lados y denomailer la deja
// pasar sin tocarla.
const CHUNK_BYTES = 45; // muy por debajo del límite de 75 bytes de RFC 2047

function qpByte(byte: number): string {
  return `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
}

export function encodeHeaderSubject(input: string): string {
  // deno-lint-ignore no-control-regex
  if (!/[^\x00-\x7f]/.test(input)) return input; // ya es ASCII puro, nada que hacer

  const encoder = new TextEncoder();
  let out = "";
  let asciiBuf = "";
  let qpBuf = "";

  const flushAscii = () => {
    out += asciiBuf;
    asciiBuf = "";
  };
  const flushQp = () => {
    if (qpBuf) out += `=?utf-8?Q?${qpBuf}?=`;
    qpBuf = "";
  };

  for (const ch of input) {
    const bytes = encoder.encode(ch);
    const isPlainAscii = bytes.length === 1 && bytes[0] >= 32 && bytes[0] <= 126;

    if (isPlainAscii) {
      flushQp();
      asciiBuf += ch;
    } else {
      flushAscii();
      const enc = Array.from(bytes).map(qpByte).join("");
      if (qpBuf.length + enc.length > CHUNK_BYTES) flushQp();
      qpBuf += enc;
    }
  }
  flushAscii();
  flushQp();

  // Un encoded-word nunca puede quedar como primer token: denomailer
  // reconoce "=?" al inicio y volvería a codificar todo el string.
  return out.startsWith("=?") ? ` ${out}` : out;
}
