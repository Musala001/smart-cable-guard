"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Det = { x: number; y: number; w: number; h: number; score: number; cls: number };
type Track = { id: number; cls: number; x: number; y: number; w: number; h: number; hits: number; missed: number; peak: number; logged: boolean };
type Sev = "Critical" | "High" | "Medium";
type Incident = { id: number; cls: number; sev: Sev; conf: number; ts: number; thumb: string; action: string; areaFrac: number; persist: number; region: string };

const NAMES = ["break", "thunderbolt"];
const SEV_COLOR: Record<Sev, string> = { Critical: "#FF3B3B", High: "#FF8A2F", Medium: "#C99A18" };
const INPUT = 640, CONFIRM = 3, MAX_MISSED = 12, IOU_MATCH = 0.3;

function iou(a: Track | Det, b: Det) {
  const ax2 = a.x + a.w, ay2 = a.y + a.h, bx2 = b.x + b.w, by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy; const uni = a.w * a.h + b.w * b.h - inter;
  return uni <= 0 ? 0 : inter / uni;
}
function sevScore(cls: number, conf: number, areaFrac: number) {
  const base = cls === 0 ? 0.45 : 0.28;
  return base + 0.35 * conf + 0.2 * Math.min(areaFrac * 6, 1);
}
function sevBucket(s: number): Sev { return s >= 0.78 ? "Critical" : s >= 0.58 ? "High" : "Medium"; }
function regionOf(cy: number) { return cy < 0.34 ? "upper span" : cy < 0.67 ? "mid span" : "lower span"; }
function actionFor(cls: number, sev: Sev) {
  if (cls === 0) return sev === "Critical"
    ? "Conductor break — de-energize section and dispatch emergency crew."
    : sev === "High" ? "Probable break — schedule urgent inspection; prepare to isolate."
    : "Minor strand damage — log for scheduled maintenance.";
  return sev === "Critical"
    ? "Severe arc damage — inspect insulation/hardware immediately."
    : sev === "High" ? "Arc/lightning damage — inspect hardware; monitor for recurrence."
    : "Surface arc marking — log for scheduled maintenance.";
}

function sevDrivers(i: Incident) {
  const d: string[] = [];
  d.push(i.conf >= 0.75 ? "high detection confidence" : i.conf >= 0.5 ? "moderate confidence" : "low confidence");
  if (i.areaFrac >= 0.03) d.push("a large affected area"); else if (i.areaFrac >= 0.01) d.push("a moderate affected area");
  if (i.persist >= 15) d.push("persistence across many frames"); else if (i.persist >= CONFIRM + 2) d.push("confirmation across multiple frames");
  return d;
}
function evidenceText(i: Incident) {
  const p = [`${(i.conf * 100).toFixed(0)}% confidence`, `~${(i.areaFrac * 100).toFixed(1)}% of frame`];
  if (i.persist > 1) p.push(`tracked ${i.persist}+ frames`);
  p.push(i.region);
  return p.join(" · ");
}
function reasoningText(i: Incident) {
  const base = i.cls === 0 ? "conductor break (strand separation)" : "arc / lightning (thunderbolt) damage";
  let r = `Classified as ${base}. Rated ${i.sev}, driven by ${sevDrivers(i).join(", ")}.`;
  if (i.conf < 0.5) r += " Confidence is low — flagged for human verification rather than automatic action.";
  return r;
}
function buildAnalysis(incidents: Incident[], ctx: { mode: string; frames: number; dur: string }) {
  const n = incidents.length;
  const crit = incidents.filter(i => i.sev === "Critical").length;
  const high = incidents.filter(i => i.sev === "High").length;
  const med = incidents.filter(i => i.sev === "Medium").length;
  const breaks = incidents.filter(i => i.cls === 0).length;
  const arcs = incidents.filter(i => i.cls === 1).length;
  const low = incidents.filter(i => i.conf < 0.5).length;
  let risk = "No faults detected", riskColor = "#1D9E8B";
  if (crit > 0) { risk = "Elevated — immediate attention required"; riskColor = "#FF3B3B"; }
  else if (high > 0) { risk = "Moderate — prioritized inspection advised"; riskColor = "#FF8A2F"; }
  else if (med > 0) { risk = "Low–Moderate — routine maintenance"; riskColor = "#C99A18"; }
  const order = (s: Sev) => ["Medium", "High", "Critical"].indexOf(s);
  const sorted = [...incidents].sort((a, b) => (order(b.sev) - order(a.sev)) || b.conf - a.conf);
  const narr: string[] = [];
  const scope = ctx.mode === "image" ? "1 image" : `${ctx.frames} frame(s) over ${ctx.dur}`;
  narr.push(`Automated inspection analysed ${scope} and logged ${n} fault${n === 1 ? "" : "s"}: ${breaks} conductor break${breaks === 1 ? "" : "s"} and ${arcs} arc-damage finding${arcs === 1 ? "" : "s"}.`);
  if (n > 0) narr.push(`Severity distribution: ${crit} Critical, ${high} High, ${med} Medium.`);
  if (sorted[0] && sorted[0].sev !== "Medium") { const t = sorted[0]; narr.push(`Highest-priority finding: ${t.cls === 0 ? "conductor break" : "arc damage"} on the ${t.region} at ${(t.conf * 100).toFixed(0)}% confidence, flagged ${t.sev}.`); }
  if (breaks >= 3) narr.push(`Multiple break findings (${breaks}) suggest a recurring or localized mechanical issue along the scanned span rather than an isolated defect.`);
  else if (arcs >= 3) narr.push(`Multiple arc-damage findings (${arcs}) may indicate repeated electrical stress or lightning exposure in this section.`);
  if (low > 0) narr.push(`${low} finding${low === 1 ? "" : "s"} fell below 50% confidence and ${low === 1 ? "is" : "are"} flagged for human verification, not automatic classification.`);
  if (ctx.mode !== "image" && n > 0) narr.push(`Motion blur and lighting in recorded/live footage can lower confidence; static high-resolution images give the most reliable reads.`);
  const recs: { c: string; t: string }[] = [];
  if (crit > 0) recs.push({ c: "#FF3B3B", t: "Immediate: de-energize affected section(s) and dispatch an emergency crew." });
  if (high > 0) recs.push({ c: "#FF8A2F", t: "Urgent: schedule a prioritized on-site inspection of high-severity spans." });
  if (med > 0) recs.push({ c: "#C99A18", t: "Routine: add medium-severity findings to the scheduled maintenance cycle." });
  if (n > 0) recs.push({ c: "#444", t: "Verify all AI findings on-site before any switching or repair action." });
  if (n === 0) recs.push({ c: "#1D9E8B", t: "No action required from this scan. Re-inspect per routine schedule." });
  const caveat = "This assessment is generated automatically from the detector's measurable outputs — fault type, confidence, affected area, position and frame-persistence. The model recognizes two fault types (conductor break and arc/thunderbolt damage); other defects are outside its scope, and the absence of detections does not certify a cable as fault-free. All findings require confirmation by a qualified inspector.";
  return { risk, riskColor, crit, high, med, narr, recs, caveat, findings: sorted };
}

export default function Page() {
  const [ready, setReady] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [mode, setMode] = useState<"live" | "video" | "image">("live");
  const [running, setRunning] = useState(false);
  const [thresh, setThresh] = useState(0.35);
  const [fps, setFps] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [vprog, setVprog] = useState(0);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [provider, setProvider] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [utility, setUtility] = useState("Grid Operator");

  const ortRef = useRef<any>(null);
  const sessionRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const threshRef = useRef(thresh);
  const preRef = useRef<HTMLCanvasElement | null>(null);
  const cropRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fpsRef = useRef({ t: 0, n: 0 });
  const busyRef = useRef(false);
  const tracksRef = useRef<Track[]>([]);
  const nextIdRef = useRef(1);
  const incRef = useRef<Incident[]>([]);
  const startRef = useRef(0);
  const framesRef = useRef(0);

  useEffect(() => { threshRef.current = thresh; }, [thresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ort = await import("onnxruntime-web/webgpu");
        ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
        ort.env.wasm.numThreads = 1; ort.env.logLevel = "error"; ortRef.current = ort;
        const resp = await fetch("/models/best.onnx");
        const total = Number(resp.headers.get("content-length") || 0);
        const reader = resp.body!.getReader();
        const chunks: Uint8Array[] = []; let recv = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); recv += value.length; if (total) setLoadPct(Math.round((recv / total) * 100)); }
        const buf = new Uint8Array(recv); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
        let session: any, prov = "wasm";
        try { session = await ort.InferenceSession.create(buf, { executionProviders: ["webgpu"], logSeverityLevel: 3 }); prov = "webgpu"; }
        catch { session = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"], logSeverityLevel: 3 }); prov = "wasm"; }
        if (cancelled) return;
        sessionRef.current = session; setProvider(prov); setReady(true);
      } catch (e: any) { setErr("Failed to load model: " + (e?.message || e)); }
    })();
    return () => { cancelled = true; };
  }, []);

  const preprocess = useCallback((src: CanvasImageSource, sw: number, sh: number) => {
    let pre = preRef.current;
    if (!pre) { pre = document.createElement("canvas"); pre.width = INPUT; pre.height = INPUT; preRef.current = pre; }
    const g = pre.getContext("2d", { willReadFrequently: true })!;
    const scale = Math.min(INPUT / sw, INPUT / sh);
    const nw = sw * scale, nh = sh * scale, px = (INPUT - nw) / 2, py = (INPUT - nh) / 2;
    g.fillStyle = "rgb(114,114,114)"; g.fillRect(0, 0, INPUT, INPUT); g.drawImage(src, px, py, nw, nh);
    const { data } = g.getImageData(0, 0, INPUT, INPUT);
    const f = new Float32Array(3 * INPUT * INPUT); const plane = INPUT * INPUT;
    for (let i = 0; i < plane; i++) { f[i] = data[i * 4] / 255; f[plane + i] = data[i * 4 + 1] / 255; f[2 * plane + i] = data[i * 4 + 2] / 255; }
    return { f, scale, px, py };
  }, []);

  const decode = useCallback((out: any, scale: number, px: number, py: number) => {
    const dims = out.dims as number[]; const d = out.data as Float32Array;
    let n: number, rowmajor = true;
    if (dims.length === 3 && dims[2] === 6) { n = dims[1]; rowmajor = true; }
    else if (dims.length === 3 && dims[1] === 6) { n = dims[2]; rowmajor = false; }
    else { n = dims[1] || 0; rowmajor = true; }
    const get = (i: number, j: number) => (rowmajor ? d[i * 6 + j] : d[j * n + i]);
    const th = threshRef.current; const res: Det[] = [];
    for (let i = 0; i < n; i++) {
      let x1 = get(i, 0), y1 = get(i, 1), x2 = get(i, 2), y2 = get(i, 3); const score = get(i, 4), cls = get(i, 5);
      if (!score || score < th) continue;
      if (x2 <= 1.5 && y2 <= 1.5) { x1 *= INPUT; y1 *= INPUT; x2 *= INPUT; y2 *= INPUT; }
      res.push({ x: (x1 - px) / scale, y: (y1 - py) / scale, w: (x2 - x1) / scale, h: (y2 - y1) / scale, score, cls: Math.round(cls) });
    }
    return res;
  }, []);

  const infer = useCallback(async (src: CanvasImageSource, sw: number, sh: number) => {
    const ort = ortRef.current, session = sessionRef.current; if (!session) return [] as Det[];
    const { f, scale, px, py } = preprocess(src, sw, sh);
    const t = new ort.Tensor("float32", f, [1, 3, INPUT, INPUT]);
    const out = await session.run({ [session.inputNames[0]]: t });
    return decode(out[session.outputNames[0]], scale, px, py);
  }, [preprocess, decode]);

  const makeThumb = useCallback((src: CanvasImageSource, d: { x: number; y: number; w: number; h: number }, sw: number, sh: number) => {
    let c = cropRef.current; if (!c) { c = document.createElement("canvas"); c.width = 96; c.height = 96; cropRef.current = c; }
    const g = c.getContext("2d")!; const pad = 0.2;
    let sx = d.x - d.w * pad, sy = d.y - d.h * pad, sW = d.w * (1 + 2 * pad), sH = d.h * (1 + 2 * pad);
    sx = Math.max(0, sx); sy = Math.max(0, sy); sW = Math.min(sw - sx, sW); sH = Math.min(sh - sy, sH);
    g.fillStyle = "#05080B"; g.fillRect(0, 0, 96, 96);
    if (sW > 0 && sH > 0) g.drawImage(src, sx, sy, sW, sH, 0, 0, 96, 96);
    return c.toDataURL("image/jpeg", 0.7);
  }, []);

  const logIncident = useCallback((id: number, cls: number, conf: number, box: any, src: CanvasImageSource, sw: number, sh: number, persist: number) => {
    const areaFrac = (box.w * box.h) / (sw * sh);
    const sev = sevBucket(sevScore(cls, conf, areaFrac));
    const region = regionOf((box.y + box.h / 2) / sh);
    const inc: Incident = { id, cls, sev, conf, ts: Date.now(), thumb: makeThumb(src, box, sw, sh), action: actionFor(cls, sev), areaFrac, persist, region };
    incRef.current = [inc, ...incRef.current].slice(0, 200);
    setIncidents(incRef.current);
  }, [makeThumb]);

  const track = useCallback((dets: Det[], src: CanvasImageSource, sw: number, sh: number) => {
    const tracks = tracksRef.current;
    tracks.forEach(t => t.missed++);
    const used = new Set<number>();
    dets.sort((a, b) => b.score - a.score);
    for (const det of dets) {
      let best = -1, bi = -1;
      tracks.forEach((t, i) => { if (used.has(i) || t.cls !== det.cls) return; const v = iou(t, det); if (v > IOU_MATCH && v > best) { best = v; bi = i; } });
      if (bi >= 0) {
        const t = tracks[bi]; used.add(bi);
        t.x = det.x; t.y = det.y; t.w = det.w; t.h = det.h; t.hits++; t.missed = 0; t.peak = Math.max(t.peak, det.score);
        if (t.hits >= CONFIRM && !t.logged) { t.logged = true; logIncident(t.id, t.cls, t.peak, t, src, sw, sh, t.hits); }
      } else {
        tracks.push({ id: nextIdRef.current++, cls: det.cls, x: det.x, y: det.y, w: det.w, h: det.h, hits: 1, missed: 0, peak: det.score, logged: false });
      }
    }
    tracksRef.current = tracks.filter(t => t.missed <= MAX_MISSED);
    return tracksRef.current.filter(t => t.hits >= CONFIRM);
  }, [logIncident]);

  const fitCanvas = useCallback(() => {
    const cv = canvasRef.current; if (!cv || !cv.parentElement) return;
    cv.width = cv.parentElement.clientWidth; cv.height = cv.parentElement.clientHeight;
  }, []);

  const draw = useCallback((src: CanvasImageSource, sw: number, sh: number, boxes: { x: number; y: number; w: number; h: number; cls: number; peak: number }[]) => {
    const cv = canvasRef.current!; const ctx = cv.getContext("2d")!; const cw = cv.width, ch = cv.height;
    const scale = Math.min(cw / sw, ch / sh); const dw = sw * scale, dh = sh * scale, dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    ctx.clearRect(0, 0, cw, ch); ctx.drawImage(src, dx, dy, dw, dh);
    for (const b of boxes) {
      const areaFrac = (b.w * b.h) / (sw * sh);
      const sev = sevBucket(sevScore(b.cls, b.peak, areaFrac)); const col = SEV_COLOR[sev];
      const bx = dx + b.x * scale, by = dy + b.y * scale, bw = b.w * scale, bh = b.h * scale;
      ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.strokeRect(bx, by, bw, bh);
      const label = `${NAMES[b.cls]} · ${sev} ${(b.peak * 100).toFixed(0)}%`;
      ctx.font = "600 13px 'Space Grotesk', sans-serif"; const tw = ctx.measureText(label).width;
      ctx.fillStyle = col; ctx.fillRect(bx - 1.25, by - 20, tw + 12, 20);
      ctx.fillStyle = "#0a0a0a"; ctx.fillText(label, bx + 5, by - 6);
    }
  }, []);

  const loop = useCallback(async () => {
    if (!runningRef.current) return;
    const v = videoRef.current!;
    if (v.readyState >= 2 && !busyRef.current) {
      busyRef.current = true;
      const dets = await infer(v, v.videoWidth, v.videoHeight);
      const boxes = track(dets, v, v.videoWidth, v.videoHeight);
      draw(v, v.videoWidth, v.videoHeight, boxes);
      framesRef.current++;
      const fr = fpsRef.current; fr.n++; const now = performance.now();
      if (now - fr.t >= 500) { setFps(Math.round((fr.n * 1000) / (now - fr.t))); fr.n = 0; fr.t = now; setElapsed(Math.round((Date.now() - startRef.current) / 1000)); if (v.duration) setVprog(v.currentTime / v.duration); }
      busyRef.current = false;
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [infer, track, draw]);

  const resetScan = useCallback(() => {
    tracksRef.current = []; incRef.current = []; setIncidents([]); framesRef.current = 0; setElapsed(0); setVprog(0);
    const cv = canvasRef.current; if (cv) cv.getContext("2d")!.clearRect(0, 0, cv.width, cv.height);
  }, []);

  const startCam = useCallback(async () => {
    setErr(null); resetScan();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = s; const v = videoRef.current!; v.srcObject = s; v.src = ""; await v.play();
      fitCanvas(); fpsRef.current = { t: performance.now(), n: 0 }; startRef.current = Date.now();
      runningRef.current = true; setRunning(true); loop();
    } catch { setErr("Camera blocked or unavailable. Allow access, or use Video/Image."); }
  }, [fitCanvas, loop, resetScan]);

  const stopCam = useCallback(() => {
    runningRef.current = false; setRunning(false); cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    const v = videoRef.current; if (v) { v.pause(); if (v.src) { v.removeAttribute("src"); v.load(); } }
  }, []);

  const onVideo = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    stopCam(); resetScan(); setErr(null);
    const v = videoRef.current!; v.srcObject = null; v.src = URL.createObjectURL(file); v.muted = true;
    v.onloadeddata = async () => { fitCanvas(); fpsRef.current = { t: performance.now(), n: 0 }; startRef.current = Date.now(); runningRef.current = true; setRunning(true); await v.play(); loop(); };
    v.onended = () => { runningRef.current = false; setRunning(false); cancelAnimationFrame(rafRef.current); setVprog(1); if (incRef.current.length) setShowReport(true); };
  }, [stopCam, resetScan, fitCanvas, loop]);

  const onImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    stopCam(); resetScan();
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      requestAnimationFrame(async () => {
        fitCanvas();
        const dets = await infer(img, img.naturalWidth, img.naturalHeight);
        draw(img, img.naturalWidth, img.naturalHeight, dets.map(d => ({ x: d.x, y: d.y, w: d.w, h: d.h, cls: d.cls, peak: d.score })));
        dets.forEach((d, i) => logIncident(1000 + i, d.cls, d.score, d, img, img.naturalWidth, img.naturalHeight, 1));
      });
    };
    img.src = URL.createObjectURL(file);
  }, [stopCam, resetScan, fitCanvas, infer, draw, logIncident]);

  useEffect(() => { if (ready) fitCanvas(); }, [ready, mode, fitCanvas]);
  useEffect(() => { const r = () => fitCanvas(); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, [fitCanvas]);
  useEffect(() => () => stopCam(), [stopCam]);

  function switchMode(m: "live" | "video" | "image") { if (m === mode) return; stopCam(); resetScan(); imgRef.current = null; setMode(m); }

  const counts = { Critical: 0, High: 0, Medium: 0 } as Record<Sev, number>;
  incidents.forEach(i => counts[i.sev]++);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0"), ss = String(elapsed % 60).padStart(2, "0");
  const A = showReport ? buildAnalysis(incidents, { mode, frames: framesRef.current || (mode === "image" ? 1 : 0), dur: `${mm}:${ss}` }) : null;

  return (
    <div className="wrap">
      <header className="hdr">
        <div className="brand">
          <div className="mark"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#04120F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg></div>
          <div><h1>Cable-Guard</h1><span>AI cable inspection &amp; fault triage</span></div>
        </div>
        <div className="hstat">
          <span className="prov">{provider || "loading"}</span>
          <span className={"live" + (running ? " on" : "")}><i />{running ? "SCANNING" : "IDLE"}</span>
        </div>
      </header>

      <main className="main">
        <div className="stagewrap">
          <div className="stage">
            <canvas ref={canvasRef} />
            {!ready && !err && <div className="overlay"><div className="spin" /><p>Loading detector… {loadPct}%</p></div>}
            {ready && mode === "live" && !running && !err && <div className="overlay"><button className="cta" onClick={startCam}>Start scan</button><p>Point the camera along a cable to inspect for breaks and arc (thunderbolt) faults.</p></div>}
            {ready && mode === "video" && !running && incidents.length === 0 && !err && <div className="overlay"><label className="cta">Upload footage<input type="file" accept="video/*" hidden onChange={onVideo} /></label><p>Upload a recorded line-scan video to auto-generate an inspection report.</p></div>}
            {ready && mode === "image" && !imgRef.current && !err && <div className="overlay"><label className="cta">Choose image<input type="file" accept="image/*" hidden onChange={onImage} /></label><p>Analyse a single still image for cable faults.</p></div>}
            {err && <div className="overlay err"><p>{err}</p></div>}
            <video ref={videoRef} playsInline muted style={{ display: "none" }} />
          </div>
          {mode === "video" && <div className="vbar"><i style={{ width: `${vprog * 100}%` }} /></div>}
        </div>

        <aside className="side">
          <div className="seg">
            <button className={mode === "live" ? "on" : ""} onClick={() => switchMode("live")}>Live</button>
            <button className={mode === "video" ? "on" : ""} onClick={() => switchMode("video")}>Video</button>
            <button className={mode === "image" ? "on" : ""} onClick={() => switchMode("image")}>Image</button>
          </div>

          <div className="ctl">
            {mode === "live" && (running
              ? <button className="btn stop" onClick={stopCam}>Stop scan</button>
              : <button className="btn go" onClick={startCam} disabled={ready === false}>Start scan</button>)}
            {mode === "video" && (running
              ? <button className="btn stop" onClick={stopCam}>Stop</button>
              : <label className="btn go" style={{ opacity: ready ? 1 : .45 }}>Upload footage<input type="file" accept="video/*" hidden onChange={onVideo} disabled={ready === false} /></label>)}
            {mode === "image" && <label className="btn go" style={{ opacity: ready ? 1 : .45 }}>Choose image<input type="file" accept="image/*" hidden onChange={onImage} disabled={ready === false} /></label>}
            <button className="btn ghost" onClick={() => setShowReport(true)} disabled={incidents.length === 0} style={{ flex: "0 0 auto", minWidth: 92 }}>Report</button>
          </div>

          <div className="stats">
            <div className="stat"><span className="k">Engine</span><span className="v" style={{ fontSize: ".92rem", textTransform: "uppercase" }}>{provider || "—"}</span></div>
            <div className="stat"><span className="k">{mode === "image" ? "Faults" : "FPS"}</span><span className="v">{mode === "image" ? incidents.length : (running ? fps : "—")}</span></div>
            <div className="stat"><span className="k">Duration</span><span className="v">{mode === "image" ? "—" : `${mm}:${ss}`}</span></div>
          </div>

          <div className="sevbar">
            <div className="sv" style={{ ["--c" as any]: SEV_COLOR.Critical }}><div className="n">{counts.Critical}</div><div className="l">Critical</div></div>
            <div className="sv" style={{ ["--c" as any]: SEV_COLOR.High }}><div className="n">{counts.High}</div><div className="l">High</div></div>
            <div className="sv" style={{ ["--c" as any]: SEV_COLOR.Medium }}><div className="n">{counts.Medium}</div><div className="l">Medium</div></div>
          </div>

          <div className="thr">
            <div className="thrhead"><span>Sensitivity</span><span>{thresh.toFixed(2)}</span></div>
            <input type="range" min="0.1" max="0.9" step="0.05" value={thresh} onChange={e => setThresh(parseFloat(e.target.value))} />
          </div>

          <div className="feed">
            <h4><span>Incident log</span><span>{incidents.length}</span></h4>
            <div className="feedscroll">
              {incidents.length === 0
                ? <p className="none">No faults logged yet.</p>
                : incidents.map(i => (
                  <div className="inc" key={i.id}>
                    <img src={i.thumb} alt="" />
                    <div className="body">
                      <div className="top"><span className="ty">{NAMES[i.cls]}</span><span className="chip" style={{ background: SEV_COLOR[i.sev] }}>{i.sev}</span></div>
                      <div className="act">{i.action}</div>
                    </div>
                    <span className="cf">{(i.conf * 100).toFixed(0)}%</span>
                  </div>
                ))}
            </div>
          </div>

          <div className="foot">YOLO26 · mAP50 0.871 · runs in-browser, offline</div>
        </aside>
      </main>

      {showReport && A && (
        <div className="report" onClick={e => { if (e.target === e.currentTarget) setShowReport(false); }}>
          <div className="reportsheet">
            <h2>Cable Inspection Report</h2>
            <p className="sub">Generated by Cable-Guard automated analysis</p>
            <div className="rmeta">
              <span>Operator: <input value={utility} onChange={e => setUtility(e.target.value)} /></span>
              <span>Date: {new Date().toLocaleString()}</span>
              {mode !== "image" && <span>Scan duration: {mm}:{ss}</span>}
              <span>Frames analysed: {framesRef.current || (mode === "image" ? 1 : 0)}</span>
              <span>Engine: {provider}</span>
            </div>

            <div className="rsum">
              <div className="c"><div className="n">{incidents.length}</div><div className="l">Total faults</div></div>
              <div className="c"><div className="n" style={{ color: SEV_COLOR.Critical }}>{A.crit}</div><div className="l">Critical</div></div>
              <div className="c"><div className="n" style={{ color: SEV_COLOR.High }}>{A.high}</div><div className="l">High</div></div>
              <div className="c"><div className="n" style={{ color: SEV_COLOR.Medium }}>{A.med}</div><div className="l">Medium</div></div>
            </div>

            <div className="rrisk" style={{ background: A.riskColor }}>
              <span className="rl">Risk level</span><span className="rt">{A.risk}</span>
            </div>

            <div className="rsection">
              <h3>Automated assessment</h3>
              <div className="rnarr">
                {A.narr.map((p, i) => <p key={i}>{p}</p>)}
                <p className="caveat">{A.caveat}</p>
              </div>
            </div>

            <div className="rsection">
              <h3>Prioritized recommendations</h3>
              <ul className="rrecs">
                {A.recs.map((r, i) => <li key={i} style={{ ["--rc" as any]: r.c }}>{r.t}</li>)}
              </ul>
            </div>

            <div className="rsection">
              <h3>Findings ({A.findings.length})</h3>
              {A.findings.length === 0
                ? <p style={{ color: "#777", fontSize: ".86rem" }}>No faults were logged in this scan.</p>
                : A.findings.map(i => (
                  <div className="finding" key={i.id}>
                    <img src={i.thumb} alt="" />
                    <div className="fb">
                      <div className="fh"><span className="ft">{NAMES[i.cls]}</span><span className="rchip" style={{ background: SEV_COLOR[i.sev] }}>{i.sev}</span>{i.conf < 0.5 && <span className="vtag">Verify</span>}</div>
                      <p className="fev">{evidenceText(i)}</p>
                      <p className="fr">{reasoningText(i)}</p>
                      <div className="fa"><b>Recommended action</b>{i.action}</div>
                    </div>
                  </div>
                ))}
            </div>

            <div className="rbtns">
              <button className="close" onClick={() => setShowReport(false)}>Close</button>
              <button className="print" onClick={() => window.print()}>Print / Save PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
