import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const RECIPIENT_EMAIL = Deno.env.get('RECIPIENT_EMAIL') || 'christian.garcia@sfgarba.com.mx';
const MAIL_FROM = Deno.env.get('MAIL_FROM') || 'GarBa Expedientes <expedientes@sfgarba.com.mx>';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*';
const BUCKET = 'expedientes-clientes';
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function corsHeaders(origin: string | null) {
  const allow = ALLOWED_ORIGIN === '*' ? '*' : (origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function clean(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'cliente';
}

function requireText(fd: FormData, name: string, label: string) {
  const value = clean(fd.get(name));
  if (!value) throw new Error(`Falta ${label}.`);
  return value;
}

function requireFile(fd: FormData, name: string, label: string) {
  const value = fd.get(name);
  if (!(value instanceof File) || !value.name || value.size === 0) throw new Error(`Falta ${label}.`);
  if (value.size > MAX_FILE_SIZE) throw new Error(`${label} excede 10 MB.`);
  const ok = value.type.startsWith('image/') || value.type === 'application/pdf';
  if (!ok) throw new Error(`${label} debe ser imagen o PDF.`);
  return value;
}

function collectBeneficiaries(fd: FormData) {
  const byIndex = new Map<string, { name?: string; relationship?: string; percentage?: number }>();
  for (const [key, raw] of fd.entries()) {
    const m = key.match(/^beneficiary_(\d+)_(name|relationship|percentage)$/);
    if (!m || typeof raw !== 'string') continue;
    const [, index, field] = m;
    const item = byIndex.get(index) || {};
    if (field === 'percentage') item.percentage = Number(raw) || 0;
    else if (field === 'name') item.name = raw.trim();
    else item.relationship = raw.trim();
    byIndex.set(index, item);
  }
  const list = [...byIndex.values()].filter(b => b.name || b.relationship || b.percentage);
  if (!list.length) throw new Error('Falta al menos un beneficiario.');
  for (const b of list) {
    if (!b.name || !b.relationship || !b.percentage) throw new Error('Completa todos los datos de beneficiarios.');
  }
  const total = list.reduce((sum, b) => sum + (b.percentage || 0), 0);
  if (total !== 100) throw new Error('Los porcentajes de beneficiarios deben sumar 100%.');
  return list as { name: string; relationship: string; percentage: number }[];
}

async function uploadFile(path: string, file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`No fue posible guardar ${file.name}.`);
  return path;
}

function wrapText(text: string, max = 82) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

async function appendFileToPdf(pdf: PDFDocument, file: File, label: string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === 'application/pdf') {
    const source = await PDFDocument.load(bytes);
    const copied = await pdf.copyPages(source, source.getPageIndices());
    copied.forEach(page => pdf.addPage(page));
    return;
  }

  let image;
  if (file.type === 'image/png') image = await pdf.embedPng(bytes);
  else image = await pdf.embedJpg(bytes);

  const page = pdf.addPage([612, 792]);
  const { width, height } = image.scale(1);
  const maxW = 552;
  const maxH = 700;
  const scale = Math.min(maxW / width, maxH / height, 1);
  const w = width * scale;
  const h = height * scale;
  page.drawText(label, { x: 30, y: 756, size: 13 });
  page.drawImage(image, { x: (612 - w) / 2, y: 30 + (700 - h) / 2, width: w, height: h });
}

async function buildPdf(data: {
  fullName: string; profession: string; email: string; phone: string;
  addressSource: string; street: string; neighborhood: string; postalCode: string; city: string; state: string;
  beneficiaries: { name: string; relationship: string; percentage: number }[];
}, files: { ineFront: File; ineBack: File; addressProof: File }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText('GarBa - Expediente de cliente', { x: 40, y: 748, size: 18, font: bold });
  page.drawText('Datos recibidos', { x: 40, y: 719, size: 11, font, color: rgb(0.35, 0.35, 0.35) });

  const lines: [string, string][] = [
    ['Nombre', data.fullName],
    ['Profesion / ocupacion', data.profession],
    ['Correo', data.email],
    ['Telefono', data.phone],
    ['Domicilio basado en', data.addressSource],
    ['Calle y numero', data.street],
    ['Colonia', data.neighborhood],
    ['Codigo postal', data.postalCode],
    ['Ciudad / municipio', data.city],
    ['Estado', data.state],
  ];
  let y = 682;
  for (const [label, value] of lines) {
    page.drawText(`${label}:`, { x: 40, y, size: 10, font: bold });
    const wrapped = wrapText(value, 62);
    wrapped.forEach((part, i) => page.drawText(part, { x: 165, y: y - i * 13, size: 10, font }));
    y -= Math.max(21, wrapped.length * 13 + 5);
  }
  page.drawText('Beneficiarios:', { x: 40, y, size: 10, font: bold });
  y -= 18;
  data.beneficiaries.forEach((b, i) => {
    page.drawText(`${i + 1}. ${b.name} - ${b.relationship} - ${b.percentage}%`, { x: 55, y, size: 10, font });
    y -= 17;
  });

  await appendFileToPdf(pdf, files.ineFront, 'INE - frente');
  await appendFileToPdf(pdf, files.ineBack, 'INE - reverso');
  await appendFileToPdf(pdf, files.addressProof, 'Comprobante de domicilio');
  return new Uint8Array(await pdf.save());
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function sendEmail(fullName: string, pdfBytes: Uint8Array) {
  if (!RESEND_API_KEY) throw new Error('El servicio de correo aún no está configurado.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [RECIPIENT_EMAIL],
      subject: `Nuevo expediente - ${fullName}`,
      html: `<p>Se recibió un nuevo expediente de <strong>${fullName}</strong>.</p><p>El PDF consolidado se adjunta a este correo.</p>`,
      attachments: [{ filename: `Expediente_${safeName(fullName)}.pdf`, content: toBase64(pdfBytes) }]
    })
  });
  if (!response.ok) throw new Error('El expediente se guardó, pero no fue posible enviar el correo.');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405, origin);

  try {
    const fd = await req.formData();
    const honeypot = clean(fd.get('website'));
    if (honeypot) return json({ ok: true }, 200, origin);

    const fullName = requireText(fd, 'fullName', 'el nombre completo');
    const profession = requireText(fd, 'profession', 'la profesión u ocupación');
    const email = requireText(fd, 'email', 'el correo');
    const phone = requireText(fd, 'phone', 'el teléfono');
    const addressSource = requireText(fd, 'addressSource', 'el origen del domicilio');
    const street = requireText(fd, 'street', 'la calle y número');
    const neighborhood = requireText(fd, 'neighborhood', 'la colonia');
    const postalCode = requireText(fd, 'postalCode', 'el código postal');
    const city = requireText(fd, 'city', 'la ciudad o municipio');
    const state = requireText(fd, 'state', 'el estado');
    const consent = fd.get('consent') === 'on';
    if (!consent) throw new Error('Falta la autorización para gestionar la solicitud.');

    const beneficiaries = collectBeneficiaries(fd);
    const ineFront = requireFile(fd, 'ineFront', 'INE frente');
    const ineBack = requireFile(fd, 'ineBack', 'INE reverso');
    const addressProof = requireFile(fd, 'addressProof', 'el comprobante de domicilio');

    const id = crypto.randomUUID();
    const folder = `${id}-${safeName(fullName)}`;
    const ineFrontPath = await uploadFile(`${folder}/ine-frente-${safeName(ineFront.name)}`, ineFront);
    const ineBackPath = await uploadFile(`${folder}/ine-reverso-${safeName(ineBack.name)}`, ineBack);
    const addressProofPath = await uploadFile(`${folder}/comprobante-${safeName(addressProof.name)}`, addressProof);

    const pdfBytes = await buildPdf({ fullName, profession, email, phone, addressSource, street, neighborhood, postalCode, city, state, beneficiaries }, { ineFront, ineBack, addressProof });
    const pdfPath = `${folder}/expediente.pdf`;
    const { error: pdfError } = await supabase.storage.from(BUCKET).upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: false });
    if (pdfError) throw new Error('No fue posible guardar el PDF consolidado.');

    const { error: insertError } = await supabase.from('expedientes').insert({
      id, full_name: fullName, profession, email, phone, address_source: addressSource,
      street, neighborhood, postal_code: postalCode, city, state, beneficiaries,
      ine_front_path: ineFrontPath, ine_back_path: ineBackPath, address_proof_path: addressProofPath,
      pdf_path: pdfPath, consent: true, user_agent: req.headers.get('user-agent') || null
    });
    if (insertError) throw new Error('No fue posible registrar el expediente.');

    await sendEmail(fullName, pdfBytes);
    return json({ ok: true, id }, 200, origin);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'No fue posible procesar el expediente.' }, 400, origin);
  }
});
