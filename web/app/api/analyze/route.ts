import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SYSTEM = `You are a power-line inspection assistant reviewing ONE image from a cable inspection scan.

Respond in EXACTLY this format, nothing else:

CABLE_PRESENT: yes | no | unclear
OBSERVATION: <2-3 sentences describing only what is visibly present in the image>
CONDITION: <one line: overall condition of any cable/conductor visible, or "n/a" if none>
CONCERNS: <any visible issues NOT limited to breaks/arcs - fraying, corrosion, burn marks, foreign objects, vegetation contact, loose hardware - or "none visible">
VERDICT: <one line: is human inspection advised, and how urgently>
REGIONS: <JSON array of any concerning areas you can see, each as {"label":"short name","box":[ymin,xmin,ymax,xmax]} with coordinates normalized 0-1000. Use [] if none. Max 5.>

Rules:
- Describe ONLY what you can actually see. Never invent detail.
- If the image shows no cable or conductor at all, set CABLE_PRESENT: no and say plainly what the image actually shows.
- If blurry/dark/ambiguous, use CABLE_PRESENT: unclear and say so.
- Use hedged language ("appears", "possible") when uncertain.
- REGIONS must be valid JSON on a single line. Only include areas of genuine concern.
- Be concise and factual, no marketing language.`;

const CACHE = new Map<string, any>();
const CACHE_MAX = 40;
function cacheSet(k: string, v: any) {
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(k, v);
}

function parse(text: string, source: string) {
  const get = (k: string) => { const m = text.match(new RegExp(k + ":\\s*(.+)")); return m ? m[1].trim() : ""; };
  const p = get("CABLE_PRESENT").toLowerCase();
  let regions: any[] = [];
  try {
    const raw = get("REGIONS");
    const j = raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1);
    const arr = JSON.parse(j);
    if (Array.isArray(arr)) {
      regions = arr.filter((r: any) => Array.isArray(r?.box) && r.box.length === 4)
        .slice(0, 5)
        .map((r: any) => ({ label: String(r.label || "concern").slice(0, 40), box: r.box.map(Number) }));
    }
  } catch {}
  return {
    raw: text, source,
    cablePresent: p.startsWith("yes") ? "yes" : p.startsWith("no") ? "no" : "unclear",
    observation: get("OBSERVATION"),
    condition: get("CONDITION"),
    concerns: get("CONCERNS"),
    verdict: get("VERDICT"),
    regions,
  };
}

async function callGemini(key: string, label: string, image: string, findings: string) {
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const mime = image.slice(5, image.indexOf(";"));
  const b64 = image.slice(image.indexOf(",") + 1);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ parts: [
        { inline_data: { mime_type: mime, data: b64 } },
        { text: `Our automated cable-fault detector reported: ${findings}\n\nGive your independent assessment of this image.` },
      ]}],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1400 },
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `${label} ${r.status}`);
  const text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim() || "";
  if (!text) throw new Error(`${label} empty`);
  return parse(text, label);
}

async function callOpenRouter(image: string, findings: string) {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "minimax/minimax-m3:free";
  if (!key) throw new Error("no openrouter key");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, max_tokens: 800, temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: [
          { type: "text", text: `Our automated cable-fault detector reported: ${findings}\n\nGive your independent assessment of this image.` },
          { type: "image_url", image_url: { url: image } },
        ]},
      ],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `openrouter ${r.status}`);
  const text = d?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("openrouter empty");
  return parse(text, "openrouter");
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  const image: string = body.image || "";
  const findings: string = body.findings || "no local detections";
  if (!image.startsWith("data:image")) return NextResponse.json({ error: "no image" }, { status: 400 });

  const key = crypto.createHash("sha1").update(image).update("|").update(findings).digest("hex");
  const hit = CACHE.get(key);
  if (hit) return NextResponse.json({ ...hit, cached: true });

  const providers: [string, () => Promise<any>][] = [];
  if (process.env.GEMINI_API_KEY) providers.push(["gemini", () => callGemini(process.env.GEMINI_API_KEY!, "gemini", image, findings)]);
  if (process.env.GEMINI_API_KEY_2) providers.push(["gemini-2", () => callGemini(process.env.GEMINI_API_KEY_2!, "gemini-2", image, findings)]);
  providers.push(["openrouter", () => callOpenRouter(image, findings)]);

  const errs: string[] = [];
  for (const [name, fn] of providers) {
    try { const out = await fn(); cacheSet(key, out); return NextResponse.json(out); }
    catch (e: any) { errs.push(`${name}: ${e?.message || e}`); }
  }
  return NextResponse.json({ error: "All vision providers unavailable. " + errs.join(" | ") }, { status: 503 });
}
