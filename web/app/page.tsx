"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Det = { x: number; y: number; w: number; h: number; score: number; cls: number };
const NAMES = ["break", "thunderbolt"];
const COLORS = ["#FF5A3C", "#FFC53D"];
const INPUT = 640;

export default function Page() {
  const [ready, setReady] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [mode, setMode] = useState<"live" | "upload">("live");
  const [running, setRunning] = useState(false);
  const [thresh, setThresh] = useState(0.35);
  const [fps, setFps] = useState(0);
  const [counts, setCounts] = useState<[number, number]>([0, 0]);
  const [dets, setDets] = useState<Det[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [provider, setProvider] = useState("");

  const ortRef = useRef<any>(null);
  const sessionRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const threshRef = useRef(thresh);
  const preRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fpsRef = useRef({ t: 0, n: 0 });
  const busyRef = useRef(false);

  useEffect(() => { threshRef.current = thresh; }, [thresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ort = await import("onnxruntime-web/webgpu");
        ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
        ort.env.wasm.numThreads = 1;
        ortRef.current = ort;

        const resp = await fetch("/models/best.onnx");
        const total = Number(resp.headers.get("content-length") || 0);
        const reader = resp.body!.getReader();
        const chunks: Uint8Array[] = []; let recv = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); recv += value.length; if (total) setLoadPct(Math.round((recv / total) * 100)); }
        const buf = new Uint8Array(recv); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }

        let session: any, prov = "wasm";
        try { session = await ort.InferenceSession.create(buf, { executionProviders: ["webgpu"] }); prov = "webgpu"; }
        catch { session = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"] }); prov = "wasm"; }
        if (cancelled) return;
        sessionRef.current = session; setProvider(prov); setReady(true);
      } catch (e: any) {
        setErr("Failed to load model: " + (e?.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const preprocess = useCallback((src: CanvasImageSource, sw: number, sh: number) => {
    let pre = preRef.current;
    if (!pre) { pre = document.createElement("canvas"); pre.width = INPUT; pre.height = INPUT; preRef.current = pre; }
    const g = pre.getContext("2d", { willReadFrequently: true })!;
    const scale = Math.min(INPUT / sw, INPUT / sh);
    const nw = sw * scale, nh = sh * scale, px = (INPUT - nw) / 2, py = (INPUT - nh) / 2;
    g.fillStyle = "rgb(114,114,114)"; g.fillRect(0, 0, INPUT, INPUT);
    g.drawImage(src, px, py, nw, nh);
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
      const ox1 = (x1 - px) / scale, oy1 = (y1 - py) / scale, ox2 = (x2 - px) / scale, oy2 = (y2 - py) / scale;
      res.push({ x: ox1, y: oy1, w: ox2 - ox1, h: oy2 - oy1, score, cls: Math.round(cls) });
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

  const draw = useCallback((src: CanvasImageSource, sw: number, sh: number, detections: Det[]) => {
    const cv = canvasRef.current!; const ctx = cv.getContext("2d")!;
    const cw = cv.width, ch = cv.height;
    const scale = Math.min(cw / sw, ch / sh); const dw = sw * scale, dh = sh * scale, dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(src, dx, dy, dw, dh);
    for (const d of detections) {
      const bx = dx + d.x * scale, by = dy + d.y * scale, bw = d.w * scale, bh = d.h * scale;
      const col = COLORS[d.cls] || "#35E0C4";
      ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.strokeRect(bx, by, bw, bh);
      const label = `${NAMES[d.cls] || d.cls} ${(d.score * 100).toFixed(0)}%`;
      ctx.font = "600 13px 'Space Grotesk', sans-serif";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = col; ctx.fillRect(bx - 1.25, by - 20, tw + 12, 20);
      ctx.fillStyle = "#080B0F"; ctx.fillText(label, bx + 5, by - 6);
    }
  }, []);

  const fitCanvas = useCallback(() => {
    const cv = canvasRef.current; if (!cv || !cv.parentElement) return;
    cv.width = cv.parentElement.clientWidth; cv.height = cv.parentElement.clientHeight;
  }, []);

  const applyResult = useCallback((detections: Det[]) => {
    setDets(detections);
    setCounts([detections.filter(d => d.cls === 0).length, detections.filter(d => d.cls === 1).length]);
  }, []);

  const loop = useCallback(async () => {
    if (!runningRef.current) return;
    const v = videoRef.current!;
    if (v.readyState >= 2 && !busyRef.current) {
      busyRef.current = true;
      const detections = await infer(v, v.videoWidth, v.videoHeight);
      draw(v, v.videoWidth, v.videoHeight, detections);
      applyResult(detections);
      const fr = fpsRef.current; fr.n++; const now = performance.now();
      if (now - fr.t >= 500) { setFps(Math.round((fr.n * 1000) / (now - fr.t))); fr.n = 0; fr.t = now; }
      busyRef.current = false;
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [infer, draw, applyResult]);

  const startCam = useCallback(async () => {
    setErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = s; const v = videoRef.current!; v.srcObject = s; await v.play();
      fitCanvas(); fpsRef.current = { t: performance.now(), n: 0 };
      runningRef.current = true; setRunning(true); loop();
    } catch { setErr("Camera blocked or unavailable. Allow access, or use Upload."); }
  }, [fitCanvas, loop]);

  const stopCam = useCallback(() => {
    runningRef.current = false; setRunning(false); cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  }, []);

  const onUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    stopCam();
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      requestAnimationFrame(async () => {
        fitCanvas();
        draw(img, img.naturalWidth, img.naturalHeight, []);
        const detections = await infer(img, img.naturalWidth, img.naturalHeight);
        draw(img, img.naturalWidth, img.naturalHeight, detections);
        applyResult(detections);
      });
    };
    img.src = URL.createObjectURL(file);
  }, [infer, draw, applyResult, fitCanvas, stopCam]);

  useEffect(() => { if (ready) fitCanvas(); }, [ready, mode, fitCanvas]);

  useEffect(() => {
    if (mode === "upload" && imgRef.current && ready) {
      (async () => { const img = imgRef.current!; const detections = await infer(img, img.naturalWidth, img.naturalHeight); draw(img, img.naturalWidth, img.naturalHeight, detections); applyResult(detections); })();
    }
  }, [thresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const r = () => { fitCanvas(); if (mode === "upload" && imgRef.current) draw(imgRef.current, imgRef.current.naturalWidth, imgRef.current.naturalHeight, dets); };
    window.addEventListener("resize", r); return () => window.removeEventListener("resize", r);
  }, [fitCanvas, draw, dets, mode]);

  useEffect(() => () => stopCam(), [stopCam]);

  function switchMode(m: "live" | "upload") {
    if (m === mode) return;
    if (m === "upload") stopCam();
    setMode(m); imgRef.current = null; setDets([]); setCounts([0, 0]);
    const cv = canvasRef.current; if (cv) cv.getContext("2d")!.clearRect(0, 0, cv.width, cv.height);
  }

  return (
    <div className="wrap">
      <header className="hdr">
        <div className="brand">
          <div className="mark"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#04120F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v6M12 22v-6M2 12h6M22 12h-6"/><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/></svg></div>
          <div><h1>Cable-Guard</h1><span>Real-time cable fault detection</span></div>
        </div>
        <div className="hstat">
          <span className="prov">{provider || "loading"}</span>
          <span className={"live" + (running ? " on" : "")}><i />{running ? "LIVE" : "IDLE"}</span>
        </div>
      </header>

      <main className="main">
        <div className="stagewrap">
          <div className="stage">
            <canvas ref={canvasRef} />
            {!ready && !err && <div className="overlay"><div className="spin" /><p>Loading detector… {loadPct}%</p></div>}
            {ready && mode === "live" && !running && !err && <div className="overlay"><button className="cta" onClick={startCam}>Start camera</button><p>Point the camera at a cable to scan for breaks and thunderbolt faults.</p></div>}
            {err && <div className="overlay err"><p>{err}</p></div>}
            <video ref={videoRef} playsInline muted style={{ display: "none" }} />
          </div>
        </div>

        <aside className="side">
          <div className="seg">
            <button className={mode === "live" ? "on" : ""} onClick={() => switchMode("live")}>Live</button>
            <button className={mode === "upload" ? "on" : ""} onClick={() => switchMode("upload")}>Upload</button>
          </div>

          {mode === "live"
            ? (running
              ? <button className="btn stop" onClick={stopCam}>Stop camera</button>
              : <button className="btn go" onClick={startCam} disabled={ready === false}>Start camera</button>)
            : <label className="btn go">Choose image<input type="file" accept="image/*" hidden onChange={onUpload} disabled={ready === false} /></label>}

          <div className="metrics">
            <div className="metric"><span className="k">FPS</span><span className="v">{mode === "live" && running ? fps : "—"}</span></div>
            <div className="metric"><span className="k">Engine</span><span className="v sm">{provider || "—"}</span></div>
          </div>

          <div className="counts">
            <div className="cnt" style={{ ["--c" as any]: COLORS[0] }}><span className="dot" /><span className="lbl">Break</span><span className="num">{counts[0]}</span></div>
            <div className="cnt" style={{ ["--c" as any]: COLORS[1] }}><span className="dot" /><span className="lbl">Thunderbolt</span><span className="num">{counts[1]}</span></div>
          </div>

          <div className="thr">
            <div className="thrhead"><span>Sensitivity</span><span>{thresh.toFixed(2)}</span></div>
            <input type="range" min="0.1" max="0.9" step="0.05" value={thresh} onChange={e => setThresh(parseFloat(e.target.value))} />
          </div>

          <div className="detlist">
            <h4>Detections</h4>
            {dets.length === 0
              ? <p className="none">No faults detected.</p>
              : dets.slice().sort((a, b) => b.score - a.score).map((d, i) => (
                <div className="detrow" key={i}><span className="dd" style={{ background: COLORS[d.cls] }} /><span className="dn">{NAMES[d.cls]}</span><span className="dp" style={{ color: COLORS[d.cls] }}>{(d.score * 100).toFixed(0)}%</span></div>
              ))}
          </div>

          <div className="foot">YOLO26 · mAP50 0.871 · in-browser</div>
        </aside>
      </main>
    </div>
  );
}
