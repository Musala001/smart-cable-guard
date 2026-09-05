import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";

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

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!key) return NextResponse.json({ error: "GEMINI_API_KEY not set in .env.local" }, { status: 500 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  const image: string = body.image || "";
  const findings: string = body.findings || "no local detections";
  if (!image.startsWith("data:image")) return NextResponse.json({ error: "no image" }, { status: 400 });

  const comma = image.indexOf(",");
  const mime = image.slice(5, image.indexOf(";"));
  const b64 = image.slice(comma + 1);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{
      parts: [
        { inline_data: { mime_type: mime, data: b64 } },
        { text: `Our automated cable-fault detector reported: ${findings}\n\nGive your independent assessment of this image.` },
      ],
    }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: data?.error?.message || `Gemini error ${r.status}` }, { status: r.status });
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim() || "";
    if (!text) return NextResponse.json({ error: "empty response" }, { status: 500 });

    const get = (k: string) => { const m = text.match(new RegExp(k + ":\\s*(.+)")); return m ? m[1].trim() : ""; };
    const presentRaw = get("CABLE_PRESENT").toLowerCase();
    return NextResponse.json({
      raw: text,
      cablePresent: presentRaw.startsWith("yes") ? "yes" : presentRaw.startsWith("no") ? "no" : "unclear",
      observation: get("OBSERVATION"),
      condition: get("CONDITION"),
      concerns: get("CONCERNS"),
      verdict: get("VERDICT"),
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Request failed: " + (e?.message || e) }, { status: 500 });
  }
}
