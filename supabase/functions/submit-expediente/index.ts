import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'GarBa Expedientes <expedientes@sfgarba.com.mx>';
const RECIPIENT_EMAIL = Deno.env.get('RECIPIENT_EMAIL') || 'christian.garcia@sfgarba.com.mx';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || 'https://christiangarcia-ctrl.github.io';
const BUCKET = 'expedientes-privados';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function cors(origin: string | null) {
  const allowed = origin && (origin === ALLOWED_ORIGIN || origin.startsWith(`${ALLOWED_ORIGIN}/`)) ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) },
  });
}

function clean(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeFileName(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

function assertFile(value: FormDataEntryValue | null, label: string): File {
  if (!(value instanceof File) || value.size === 0) throw new Error(`Falta ${label}.`);
  if (!ALLOWED_MIME.has(value.type)) throw new Error(`${label}: formato no permitido.`);
  if (value.size > MAX_FILE_BYTES) throw new Error(`${label}: el archivo supera 10 MB.`);
  return value;
}

type Beneficiary = { name: string; relationship: string; percentage: number };

function readBeneficiaries(form: FormData): Beneficiary[] {
  const map = new Map<string, Partial<Beneficiary>>();
  for (const [key, value] of form.entries()) {
    const m = key.match(/^beneficiary_(\d+)_(name|relationship|percentage)$/);
    if (!m || typeof value !== 'string') continue;
    const [, id, field] = m;
    const current = map.get(id) || {};
    if (field === 'percentage') current.percentage = Number(value);
    else current[field] = value.trim();
    map.set(id, current);
  }
  const result = [...map.values()].map((b) => ({
    name: b.name || '',
    relationship: b.relationship || '',
    percentage: Number(b.percentage) || 0,
  }));
  if (!result.length || result.some((b) => !b.name || !b.relationship || b.percentage <= 0)) {
    throw new Error('Completa correctamente los beneficiarios.');
  }
  const total = result.reduce((sum, b) => sum + b.percentage, 0);
  if (Math.abs(total - 100) > 0.001) throw new Error('Los porcentajes de beneficiarios deben sumar 100%.');
  return result;
}

async function upload(path: string, file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
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
    if (`${line} ${word}`.trim().length > max) {
      if (line) lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

async function appendDocument(pdf: PDFDocument, file: File, title: string, bold: any) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === 'application/pdf') {
    const source = await PDFDocument.load(bytes);
    const pages = await pdf.copyPages(source, source.getPageIndices());
    for (const page of pages) pdf.addPage(page);
    return;
  }

  const page = pdf.addPage([612, 792]);
  page.drawText(title, { x: 40, y: 752, size: 15, font: bold, color: rgb(0.06, 0.15, 0.28) });
  const image = file.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const maxW = 532;
  const maxH = 680;
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, { x: (612 - w) / 2, y: 40 + (maxH - h) / 2, width: w, height: h });
}

async function buildPdf(data: Record<string, string>, beneficiaries: Beneficiary[], docs: { front: File; back: File; proof: File }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  page.drawText('GarBa — Expediente de cliente', { x: 44, y: 744, size: 20, font: bold, color: rgb(0.06, 0.15, 0.28) });
  page.drawText('Resumen de información proporcionada', { x: 44, y: 716, size: 11, font: regular, color: rgb(0.35, 0.39, 0.45) });

  const rows = [
    ['Nombre', data.fullName], ['Profesión / ocupación', data.profession], ['Correo', data.email], ['Teléfono', data.phone],
    ['Domicilio basado en', data.addressSource], ['Calle y número', data.street], ['Colonia', data.neighborhood],
    ['Código postal', data.postalCode], ['Ciudad / municipio', data.city], ['Estado', data.state],
  ];
  let y = 675;
  for (const [label, value] of rows) {
    page.drawText(`${label}:`, { x: 44, y, size: 10, font: bold });
    const lines = wrapText(value || '—', 62);
    for (let i = 0; i < lines.length; i++) page.drawText(lines[i], { x: 180, y: y - (i * 13), size: 10, font: regular });
    y -= Math.max(24, lines.length * 13 + 8);
  }

  page.drawText('Beneficiarios', { x: 44, y, size: 12, font: bold });
  y -= 21;
  beneficiaries.forEach((b, i) => {
    const line = `${i + 1}. ${b.name} — ${b.relationship} — ${b.percentage}%`;
    page.drawText(line.slice(0, 95), { x: 58, y, size: 10, font: regular });
    y -= 18;
  });
  y -= 6;
  page.drawText('Consentimiento confirmado por el cliente.', { x: 44, y, size: 9, font: regular, color: rgb(0.35, 0.39, 0.45) });

  await appendDocument(pdf, docs.front, 'INE — Frente', bold);
  await appendDocument(pdf, docs.back, 'INE — Reverso', bold);
  await appendDocument(pdf, docs.proof, 'Comprobante de domicilio', bold);
  return new Uint8Array(await pdf.save());
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function sendEmail(fullName: string, pdfBytes: Uint8Array) {
  if (!RESEND_API_KEY) return { sent: false };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [RECIPIENT_EMAIL],
      subject: `Nuevo expediente — ${fullName}`,
      html: `<p>Se recibió un nuevo expediente de <strong>${fullName}</strong>.</p><p>El PDF completo va adjunto.</p>`,
      attachments: [{ filename: `Expediente-${safeFileName(fullName)}.pdf`, content: toBase64(pdfBytes) }],
    }),
  });
  if (!response.ok) throw new Error('El expediente se guardó, pero no fue posible enviar el correo.');
  return { sent: true };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405, origin);

  try {
    const form = await req.formData();
    const fullName = clean(form.get('fullName'));
    const profession = clean(form.get('profession'));
    const email = clean(form.get('email'));
    const phone = clean(form.get('phone'));
    const addressSource = clean(form.get('addressSource'));
    const street = clean(form.get('street'));
    const neighborhood = clean(form.get('neighborhood'));
    const postalCode = clean(form.get('postalCode'));
    const city = clean(form.get('city'));
    const state = clean(form.get('state'));
    const consent = clean(form.get('consent')) === 'on';

    const required = { fullName, profession, email, phone, addressSource, street, neighborhood, postalCode, city, state };
    const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) return json({ error: 'Faltan datos obligatorios.', fields: missing }, 400, origin);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Correo electrónico inválido.' }, 400, origin);
    if (phone.replace(/\D/g, '').length < 10) return json({ error: 'Teléfono inválido.' }, 400, origin);
    if (!['ine', 'proof', 'other'].includes(addressSource)) return json({ error: 'Origen de domicilio inválido.' }, 400, origin);
    if (!consent) return json({ error: 'Falta confirmar el consentimiento.' }, 400, origin);

    const beneficiaries = readBeneficiaries(form);
    const front = assertFile(form.get('ineFront'), 'INE frente');
    const back = assertFile(form.get('ineBack'), 'INE reverso');
    const proof = assertFile(form.get('addressProof'), 'comprobante de domicilio');

    const { data: expediente, error: insertError } = await supabase.from('expedientes').insert({
      full_name: fullName, profession, email, phone, address_source: addressSource,
      street, neighborhood, postal_code: postalCode, city, state, consent: true,
      metadata: { user_agent: req.headers.get('user-agent') || null },
    }).select('id').single();
    if (insertError || !expediente) throw new Error('No fue posible crear el expediente.');

    const id = expediente.id as string;
    const base = `${id}`;
    const docSpecs = [
      { kind: 'ine_front', file: front, path: `${base}/ine-frente-${safeFileName(front.name)}` },
      { kind: 'ine_back', file: back, path: `${base}/ine-reverso-${safeFileName(back.name)}` },
      { kind: 'address_proof', file: proof, path: `${base}/comprobante-${safeFileName(proof.name)}` },
    ];

    for (const doc of docSpecs) await upload(doc.path, doc.file);

    const { error: benError } = await supabase.from('expediente_beneficiarios').insert(
      beneficiaries.map((b) => ({ expediente_id: id, full_name: b.name, relationship: b.relationship, percentage: b.percentage })),
    );
    if (benError) throw new Error('No fue posible guardar beneficiarios.');

    const { error: docsError } = await supabase.from('expediente_documentos').insert(
      docSpecs.map((d) => ({ expediente_id: id, kind: d.kind, storage_path: d.path, original_name: d.file.name, mime_type: d.file.type })),
    );
    if (docsError) throw new Error('No fue posible registrar documentos.');

    const pdfBytes = await buildPdf({ fullName, profession, email, phone, addressSource, street, neighborhood, postalCode, city, state }, beneficiaries, { front, back, proof });
    const pdfPath = `${base}/expediente-${safeFileName(fullName)}.pdf`;
    const { error: pdfUploadError } = await supabase.storage.from(BUCKET).upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: false });
    if (pdfUploadError) throw new Error('No fue posible guardar el PDF final.');

    await supabase.from('expediente_documentos').insert({ expediente_id: id, kind: 'compiled_pdf', storage_path: pdfPath, original_name: `Expediente-${fullName}.pdf`, mime_type: 'application/pdf' });
    await supabase.from('expedientes').update({ pdf_path: pdfPath }).eq('id', id);

    const emailResult = await sendEmail(fullName, pdfBytes);
    if (emailResult.sent) await supabase.from('expedientes').update({ email_sent_at: new Date().toISOString() }).eq('id', id);

    return json({ ok: true, expedienteId: id, emailSent: emailResult.sent }, 200, origin);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, 500, origin);
  }
});
