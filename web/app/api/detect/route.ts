import { NextRequest, NextResponse } from "next/server";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const N = 640;
const MODEL = path.join(process.cwd(), "models", "best.onnx");

let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession() {
  if (!sessionPromise) sessionPromise = ort.InferenceSession.create(MODEL);
  return sessionPromise;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  const image: string = body.image || "";
  const thresh: number = typeof body.thresh === "number" ? body.thresh : 0.45;
  if (!image.startsWith("data:image")) return NextResponse.json({ error: "no image" }, { status: 400 });

  const buf = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");

  // original size, for mapping boxes back
  const meta = await sharp(buf).metadata();
  const sw = meta.width || N, sh = meta.height || N;

  // letterbox to N x N with grey padding (matches training preprocessing)
  const scale = Math.min(N / sw, N / sh);
  const nw = Math.round(sw * scale), nh = Math.round(sh * scale);
  const px = Math.floor((N - nw) / 2), py = Math.floor((N - nh) / 2);

  const resized = await sharp(buf).removeAlpha().resize(nw, nh, { fit: "fill" }).raw().toBuffer();
  const canvas = Buffer.alloc(N * N * 3, 114); // grey pad
  for (let y = 0; y < nh; y++) {
    resized.copy(canvas, ((y + py) * N + px) * 3, y * nw * 3, (y + 1) * nw * 3);
  }

  // BGR, CHW, normalized
  const plane = N * N;
  const f = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    f[i]           = canvas[i * 3 + 2] / 255;
    f[plane + i]   = canvas[i * 3 + 1] / 255;
    f[2 * plane + i] = canvas[i * 3]     / 255;
  }

  try {
    const session = await getSession();
    const tensor = new ort.Tensor("float32", f, [1, 3, N, N]);
    const out = await session.run({ [session.inputNames[0]]: tensor });
    const o = out[session.outputNames[0]];
    const dims = o.dims as number[];
    const d = o.data as Float32Array;

    let n: number, rowmajor = true;
    if (dims.length === 3 && dims[2] === 6) { n = dims[1]; rowmajor = true; }
    else if (dims.length === 3 && dims[1] === 6) { n = dims[2]; rowmajor = false; }
    else { n = dims[1] || 0; rowmajor = true; }
    const get = (i: number, j: number) => (rowmajor ? d[i * 6 + j] : d[j * n + i]);

    const dets: any[] = [];
    for (let i = 0; i < n; i++) {
      let x1 = get(i, 0), y1 = get(i, 1), x2 = get(i, 2), y2 = get(i, 3);
      const score = get(i, 4), cls = get(i, 5);
      if (!score || score < thresh) continue;
      if (x2 <= 1.5 && y2 <= 1.5) { x1 *= N; y1 *= N; x2 *= N; y2 *= N; }
      dets.push({
        x: (x1 - px) / scale,
        y: (y1 - py) / scale,
        w: (x2 - x1) / scale,
        h: (y2 - y1) / scale,
        score,
        cls: Math.round(cls),
      });
    }
    return NextResponse.json({ dets, sw, sh });
  } catch (e: any) {
    return NextResponse.json({ error: "inference failed: " + (e?.message || e) }, { status: 500 });
  }
}
