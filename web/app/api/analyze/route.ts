import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are a power-line inspection assistant reviewing ONE image from a cable inspection scan.

Respond in EXACTLY this format, nothing else:

CABLE_PRESENT: yes | no | unclear
OBSERVATION: <2-3 sentences describing only what is visibly present in the image>
CONDITION: <one line: overall condition of any cable/conductor visible, or "n/a" if none>
CONCERNS: <any visible issues NOT limited to breaks/arcs - fraying, corrosion, burn marks, foreign objects, vegetation contact, loose hardware - or "none visible">
VERDICT: <one line: is human inspection advised, and how urgently>

Rules:
- Describe ONLY what you can actually see. Never invent detail.
- If the image shows no cable or conductor at all, set CABLE_PRESENT: no and say plainly what the image actually shows.
- If blurry/dark/ambiguous, use CABLE_PRESENT: unclear and say so.
- Use hedged language ("appears", "possible") when uncertain.
- Be concise and factual, no marketing language.`;

function parse(text: string, source: string) {
  const get = (k: string) => { const m = text.match(new RegExp(k + ":\\s*(.+)")); return m ? m[1].trim() : ""; };
  const p = get("CABLE_PRESENT").toLowerCase();
  return {
    raw: text,
    source,
    cablePresent: p.startsWith("yes") ? "yes" : p.startsWith("no") ? "no" : "unclear",
    observation: get("OBSERVATION"),
    condition: get("CONDITION"),
    concerns: get("CONCERNS"),
    verdict: get("VERDICT"),
  };
}

async function tryGemini(image: string, findings: string) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  if (!key) throw new Error("no gemini key");
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
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `gemini ${r.status}`);
  const text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim() || "";
  if (!text) throw new Error("gemini empty");
  return parse(text, "gemini");
}

async function tryOpenRouter(image: string, findings: string) {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
  if (!key) throw new Error("no openrouter key");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      temperature: 0.2,
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

  const errs: string[] = [];
  for (const [name, fn] of [["gemini", tryGemini], ["openrouter", tryOpenRouter]] as const) {
    try {
      const out = await fn(image, findings);
      return NextResponse.json(out);
    } catch (e: any) {
      errs.push(`${name}: ${e?.message || e}`);
    }
  }
  return NextResponse.json({ error: "All vision providers unavailable. " + errs.join(" | ") }, { status: 503 });
}
