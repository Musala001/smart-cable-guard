"use client";
import { Icon } from "../../components/railway-dashboard/Icon";
import { useCallback, useEffect, useRef, useState } from "react";
import { incidentToDetection, appendDetections, buildInspection, saveInspection } from "../../components/railway-dashboard/bridge";

type Det = { x: number; y: number; w: number; h: number; score: number; cls: number };
type Track = { id: number; cls: number; x: number; y: number; w: number; h: number; hits: number; missed: number; peak: number; logged: boolean };
type Sev = "Critical" | "High" | "Medium";
type Geo = { lat: number; lon: number; acc: number } | null;
type Region = { label: string; box: number[] };
type Incident = { id: number; cls: number; sev: Sev; conf: number; ts: number; thumb: string; action: string; areaFrac: number; persist: number; region: string; geo: Geo };
type AI = { cablePresent: string; observation: string; condition: string; concerns: string; verdict: string; regions?: Region[]; source?: string };

const NAMES = ["break", "thunderbolt", "foreign object"];
const SEV_COLOR: Record<Sev, string> = { Critical: "#FF3B3B", High: "#FF8A2F", Medium: "#C99A18" };
const AI_COLOR = "#8B7CF6";
const CONFIRM = 2, MAX_MISSED = 8, IOU_MATCH = 0.3;

function iou(a: Track | Det, b: Det) {
  const ax2 = a.x + a.w, ay2 = a.y + a.h, bx2 = b.x + b.w, by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy; const uni = a.w * a.h + b.w * b.h - inter;
  return uni <= 0 ? 0 : inter / uni;
}
function sevScore(cls: number, conf: number, areaFrac: number) {
  const base = cls === 0 ? 0.45 : cls === 1 ? 0.28 : 0.34;
  return base + 0.35 * conf + 0.2 * Math.min(areaFrac * 6, 1);
}
function sevBucket(s: number): Sev { return s >= 0.78 ? "Critical" : s >= 0.58 ? "High" : "Medium"; }
function regionOf(cy: number) { return cy < 0.34 ? "upper span" : cy < 0.67 ? "mid span" : "lower span"; }
function actionFor(cls: number, sev: Sev) {
  if (cls === 0) return sev === "Critical" ? "Conductor break — de-energize section and dispatch emergency crew."
    : sev === "High" ? "Probable break — schedule urgent inspection; prepare to isolate."
    : "Minor strand damage — log for scheduled maintenance.";
  if (cls === 1) return sev === "Critical" ? "Severe arc damage — inspect insulation and hardware immediately."
    : sev === "High" ? "Arc/lightning damage — inspect hardware; monitor for recurrence."
    : "Surface arc marking — log for scheduled maintenance.";
  return sev === "Critical" ? "Large foreign object on the line — dispatch crew to remove; risk of flashover or mechanical load."
    : sev === "High" ? "Foreign object entangled on conductor — schedule prompt removal."
    : "Minor debris on line — log for routine removal.";
}

export default function Page() {
  const [mode, setMode] = useState<"live" | "video" | "image">("live");
  const [running, setRunning] = useState(false);
  const [thresh, setThresh] = useState(0.45);
  const [fps, setFps] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ai, setAi] = useState<AI | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [geo, setGeo] = useState<Geo>(null);
  const [busyImg, setBusyImg] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const threshRef = useRef(thresh);
  const sendRef = useRef<HTMLCanvasElement | null>(null);
  const cropRef = useRef<HTMLCanvasElement | null>(null);
  const snapRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fpsRef = useRef({ t: 0, n: 0 });
  const busyRef = useRef(false);
  const tracksRef = useRef<Track[]>([]);
  const nextIdRef = useRef(1);
  const incRef = useRef<Incident[]>([]);
  const startRef = useRef(0);
  const framesRef = useRef(0);
  const lastBoxesRef = useRef<any[]>([]);
  const aiRegionsRef = useRef<Region[]>([]);
  const aiRef = useRef<AI | null>(null);
  const heroRef = useRef<string | null>(null);
  const geoRef = useRef<Geo>(null);
  const watchRef = useRef<number | null>(null);

  useEffect(() => { threshRef.current = thresh; }, [thresh]);
  useEffect(() => { geoRef.current = geo; }, [geo]);
  useEffect(() => { aiRef.current = ai; }, [ai]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    watchRef.current = navigator.geolocation.watchPosition(
      p => setGeo({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
    );
    return () => { if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current); };
  }, []);

  const detect = useCallback(async (src: CanvasImageSource, sw: number, sh: number, maxSide: number) => {
    let c = sendRef.current; if (!c) { c = document.createElement("canvas"); sendRef.current = c; }
    const s = Math.min(maxSide / sw, maxSide / sh, 1);
    c.width = Math.round(sw * s); c.height = Math.round(sh * s);
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.75);
    const r = await fetch("/api/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl, thresh: threshRef.current }) });
    if (!r.ok) throw new Error("detect failed");
    const j = await r.json();
    const back = 1 / s;
    return (j.dets as Det[]).map(d => ({ ...d, x: d.x * back, y: d.y * back, w: d.w * back, h: d.h * back }));
  }, []);

  const makeThumb = useCallback((src: CanvasImageSource, d: any, sw: number, sh: number, size = 160) => {
    let c = cropRef.current; if (!c) { c = document.createElement("canvas"); cropRef.current = c; }
    c.width = size; c.height = size;
    const g = c.getContext("2d")!; const pad = 0.25;
    let sx = Math.max(0, d.x - d.w * pad), sy = Math.max(0, d.y - d.h * pad);
    let sW = Math.min(sw - sx, d.w * (1 + 2 * pad)), sH = Math.min(sh - sy, d.h * (1 + 2 * pad));
    g.fillStyle = "#0B0E12"; g.fillRect(0, 0, size, size);
    if (sW > 0 && sH > 0) g.drawImage(src, sx, sy, sW, sH, 0, 0, size, size);
    return c.toDataURL("image/jpeg", 0.82);
  }, []);

  const logIncident = useCallback((id: number, cls: number, conf: number, box: any, src: CanvasImageSource, sw: number, sh: number, persist: number) => {
    const areaFrac = (box.w * box.h) / (sw * sh);
    const sev = sevBucket(sevScore(cls, conf, areaFrac));
    const inc: Incident = { id, cls, sev, conf, ts: Date.now(), thumb: makeThumb(src, box, sw, sh), action: actionFor(cls, sev), areaFrac, persist, region: regionOf((box.y + box.h / 2) / sh), geo: geoRef.current };
    incRef.current = [inc, ...incRef.current].slice(0, 200);
    setIncidents(incRef.current);
    const rec = incidentToDetection(inc as any, `INS-${new Date().toISOString().slice(0, 10)}`);
    if (rec) appendDetections([rec]);
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
      } else tracks.push({ id: nextIdRef.current++, cls: det.cls, x: det.x, y: det.y, w: det.w, h: det.h, hits: 1, missed: 0, peak: det.score, logged: false });
    }
    tracksRef.current = tracks.filter(t => t.missed <= MAX_MISSED);
    return tracksRef.current.filter(t => t.hits >= CONFIRM);
  }, [logIncident]);

  const fitCanvas = useCallback(() => {
    const cv = canvasRef.current; if (!cv || !cv.parentElement) return;
    cv.width = cv.parentElement.clientWidth; cv.height = cv.parentElement.clientHeight;
  }, []);

  const paint = useCallback((ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, cw: number, ch: number, boxes: any[], regions: Region[]) => {
    const scale = Math.min(cw / sw, ch / sh); const dw = sw * scale, dh = sh * scale, dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    ctx.clearRect(0, 0, cw, ch); ctx.drawImage(src, dx, dy, dw, dh);
    ctx.font = "600 13px 'Space Grotesk', sans-serif";
    for (const b of boxes) {
      const sev = sevBucket(sevScore(b.cls, b.peak ?? b.score, (b.w * b.h) / (sw * sh))); const col = SEV_COLOR[sev];
      const bx = dx + b.x * scale, by = dy + b.y * scale, bw = b.w * scale, bh = b.h * scale;
      ctx.setLineDash([]); ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.strokeRect(bx, by, bw, bh);
      const label = `${NAMES[b.cls]} · ${sev} ${((b.peak ?? b.score) * 100).toFixed(0)}%`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = col; ctx.fillRect(bx - 1.25, by - 20, tw + 12, 20);
      ctx.fillStyle = "#0a0a0a"; ctx.fillText(label, bx + 5, by - 6);
    }
    for (const r of regions) {
      const [ymin, xmin, ymax, xmax] = r.box;
      const bx = dx + (xmin / 1000) * dw, by = dy + (ymin / 1000) * dh;
      const bw = ((xmax - xmin) / 1000) * dw, bh = ((ymax - ymin) / 1000) * dh;
      if (bw <= 2 || bh <= 2) continue;
      ctx.setLineDash([7, 5]); ctx.lineWidth = 2.5; ctx.strokeStyle = AI_COLOR; ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
      const label = `AI review · ${r.label}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = AI_COLOR; ctx.fillRect(bx - 1.25, by + bh, tw + 12, 20);
      ctx.fillStyle = "#fff"; ctx.fillText(label, bx + 5, by + bh + 14);
    }
  }, []);

  const draw = useCallback((src: CanvasImageSource, sw: number, sh: number, boxes: any[]) => {
    const cv = canvasRef.current!; const ctx = cv.getContext("2d")!;
    paint(ctx, src, sw, sh, cv.width, cv.height, boxes, aiRegionsRef.current);
  }, [paint]);

  const captureHero = useCallback((src: CanvasImageSource, sw: number, sh: number, boxes: any[]) => {
    const c = document.createElement("canvas");
    const s = Math.min(1100 / sw, 1100 / sh, 1);
    c.width = Math.round(sw * s); c.height = Math.round(sh * s);
    paint(c.getContext("2d")!, src, sw, sh, c.width, c.height, boxes, aiRegionsRef.current);
    heroRef.current = c.toDataURL("image/jpeg", 0.85);
  }, [paint]);

  const loop = useCallback(async () => {
    if (!runningRef.current) return;
    const v = videoRef.current!;
    if (v.readyState >= 2) {
      draw(v, v.videoWidth, v.videoHeight, lastBoxesRef.current);
      const now = performance.now();
      if (now - fpsRef.current.t >= 1000) {
        setFps(fpsRef.current.n); fpsRef.current.n = 0; fpsRef.current.t = now;
        setElapsed(Math.round((Date.now() - startRef.current) / 1000));
      }
      if (!busyRef.current && !v.paused && !v.ended) {
        busyRef.current = true;
        (async () => {
          try {
            const dets = await detect(v, v.videoWidth, v.videoHeight, 512);
            const boxes = track(dets, v, v.videoWidth, v.videoHeight);
            lastBoxesRef.current = boxes.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, cls: b.cls, peak: b.peak }));
            framesRef.current++; fpsRef.current.n++;
          } catch {}
          busyRef.current = false;
        })();
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [detect, track, draw]);

  const grabFrame = useCallback(() => {
    let c = snapRef.current; if (!c) { c = document.createElement("canvas"); snapRef.current = c; }
    const g = c.getContext("2d")!;
    if (mode === "image" && imgRef.current) {
      const im = imgRef.current; const s = Math.min(1024 / im.naturalWidth, 1024 / im.naturalHeight, 1);
      c.width = im.naturalWidth * s; c.height = im.naturalHeight * s;
      g.drawImage(im, 0, 0, c.width, c.height);
    } else {
      const v = videoRef.current!; if (!v.videoWidth) return null;
      const s = Math.min(1024 / v.videoWidth, 1024 / v.videoHeight, 1);
      c.width = v.videoWidth * s; c.height = v.videoHeight * s;
      g.drawImage(v, 0, 0, c.width, c.height);
    }
    return c.toDataURL("image/jpeg", 0.85);
  }, [mode]);

  const runAI = useCallback(async () => {
    const image = grabFrame(); if (!image) { setAiErr("No frame to analyse."); return; }
    setAiBusy(true); setAiErr(null);
    const f = incRef.current.length ? incRef.current.slice(0, 5).map(i => `${NAMES[i.cls]} (${(i.conf * 100).toFixed(0)}%)`).join(", ") : "no faults detected";
    try {
      const r = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, findings: f }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "failed");
      setAi(d); aiRegionsRef.current = d.regions || [];
      const src: any = mode === "image" ? imgRef.current : videoRef.current;
      const sw = mode === "image" ? imgRef.current!.naturalWidth : videoRef.current!.videoWidth;
      const sh = mode === "image" ? imgRef.current!.naturalHeight : videoRef.current!.videoHeight;
      if (src && sw) { draw(src, sw, sh, lastBoxesRef.current); captureHero(src, sw, sh, lastBoxesRef.current); }
    } catch (e: any) { setAiErr(e?.message || "AI analysis failed."); }
    setAiBusy(false);
  }, [grabFrame, mode, draw, captureHero]);

    const commitInspection = useCallback(async (m: string) => {
    // auto-run the vision review if there are findings and it hasn't run yet
    if (incRef.current.length > 0 && !aiRef.current) {
      const image = grabFrame();
      if (image) {
        setAiBusy(true);
        const f = incRef.current.slice(0, 5).map(i => `${NAMES[i.cls]} (${(i.conf * 100).toFixed(0)}%)`).join(", ");
        try {
          const r = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, findings: f }) });
          const d = await r.json();
          if (r.ok) {
            aiRef.current = d; setAi(d); aiRegionsRef.current = d.regions || [];
            const src: any = m === "image" ? imgRef.current : videoRef.current;
            const sw = m === "image" ? imgRef.current?.naturalWidth : videoRef.current?.videoWidth;
            const sh = m === "image" ? imgRef.current?.naturalHeight : videoRef.current?.videoHeight;
            if (src && sw) { draw(src, sw!, sh!, lastBoxesRef.current); captureHero(src, sw!, sh!, lastBoxesRef.current); }
          }
        } catch {}
        setAiBusy(false);
      }
    }
    const rec = buildInspection({
      incidents: incRef.current as any, ai: aiRef.current, mode: m,
      frames: framesRef.current, durationSec: Math.round((Date.now() - startRef.current) / 1000),
      hero: heroRef.current, geo: geoRef.current, operator: "Grid Operator",
    });
    if (rec) { saveInspection(rec); setSavedBanner(true); }
  }, [grabFrame, draw, captureHero]);

  const resetScan = useCallback(() => {
    tracksRef.current = []; incRef.current = []; setIncidents([]); framesRef.current = 0; setElapsed(0);
    setAi(null); setAiErr(null); aiRef.current = null; lastBoxesRef.current = []; aiRegionsRef.current = []; heroRef.current = null;
    setSavedBanner(false);
    const cv = canvasRef.current; if (cv) cv.getContext("2d")!.clearRect(0, 0, cv.width, cv.height);
  }, []);

  const startCam = useCallback(async () => {
    setErr(null); resetScan(); setHasVideo(false);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      streamRef.current = s; const v = videoRef.current!; v.srcObject = s; v.removeAttribute("src"); v.muted = true; await v.play();
      fitCanvas(); fpsRef.current = { t: performance.now(), n: 0 }; startRef.current = Date.now();
      runningRef.current = true; setRunning(true); loop();
    } catch { setErr("Camera blocked or unavailable. Allow access, or use Video/Image."); }
  }, [fitCanvas, loop, resetScan]);

  const stopCam = useCallback((save = true) => {
    runningRef.current = false; setRunning(false); cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (save) commitInspection(mode);
  }, [commitInspection, mode]);

  const onVideo = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    runningRef.current = false; cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    resetScan(); setErr(null); setHasVideo(true);
    const v = videoRef.current!; v.srcObject = null; v.src = URL.createObjectURL(file); v.muted = false; v.volume = 1;
    v.onloadeddata = async () => {
      fitCanvas(); fpsRef.current = { t: performance.now(), n: 0 }; startRef.current = Date.now();
      runningRef.current = true; setRunning(true);
      try { await v.play(); } catch {}
      loop();
    };
    v.onended = () => { runningRef.current = false; setRunning(false); cancelAnimationFrame(rafRef.current); commitInspection("video"); };
  }, [resetScan, fitCanvas, loop, commitInspection]);

  const clearVideo = useCallback(() => {
    runningRef.current = false; setRunning(false); cancelAnimationFrame(rafRef.current);
    const v = videoRef.current; if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
    setHasVideo(false); resetScan();
  }, [resetScan]);

  const onImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    runningRef.current = false; cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    resetScan(); setErr(null); setBusyImg(true); setHasVideo(false);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      requestAnimationFrame(async () => {
        fitCanvas();
        draw(img, img.naturalWidth, img.naturalHeight, []);
        try {
          const dets = await detect(img, img.naturalWidth, img.naturalHeight, 900);
          lastBoxesRef.current = dets;
          draw(img, img.naturalWidth, img.naturalHeight, dets);
          captureHero(img, img.naturalWidth, img.naturalHeight, dets);
          dets.forEach((d, i) => logIncident(1000 + i, d.cls, d.score, d, img, img.naturalWidth, img.naturalHeight, 1));
          commitInspection("image");
        } catch (e: any) { setErr("Detection failed. Try a smaller image."); }
        setBusyImg(false);
      });
    };
    img.src = URL.createObjectURL(file);
  }, [resetScan, fitCanvas, detect, draw, captureHero, logIncident, commitInspection]);

  useEffect(() => { fitCanvas(); }, [mode, fitCanvas]);
  useEffect(() => { const r = () => fitCanvas(); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, [fitCanvas]);
  useEffect(() => () => { runningRef.current = false; if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); }, []);

  function switchMode(m: "live" | "video" | "image") {
    if (m === mode) return;
    runningRef.current = false; setRunning(false); cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    const v = videoRef.current; if (v && v.getAttribute("src")) { v.pause(); v.removeAttribute("src"); v.load(); }
    resetScan(); imgRef.current = null; setMode(m); setHasVideo(false);
  }

  const counts = { Critical: 0, High: 0, Medium: 0 } as Record<Sev, number>;
  incidents.forEach(i => counts[i.sev]++);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0"), ss = String(elapsed % 60).padStart(2, "0");
  const aiTag = ai ? (ai.cablePresent === "yes" ? { t: "Cable confirmed", c: "var(--brand)" } : ai.cablePresent === "no" ? { t: "No cable seen", c: "#FF5A3C" } : { t: "Unclear view", c: "#C99A18" }) : null;
  const sideConcern = ai && ai.concerns && !["none visible", "none", "n/a"].includes(ai.concerns.toLowerCase().trim()) && ai.cablePresent !== "no";
  const falsePos = ai && ai.cablePresent === "no" && incidents.length > 0;

  return (
    <div className="wrap">
      <header className="hdr">
        <div className="brand">
          <div className="mark"><img src="/brand/rail-logo.png" alt="rAIL" /></div>
                    <div><h1>rAIL</h1><span>Railway intelligence</span></div>
        </div>
        <div className="hstat">
	  <a href="/" className="homelink"><Icon name="back" size={16} />Home</a>
          <a href="/dashboard" className="prov" style={{ textDecoration: "none" }}>Dashboard <Icon name="arrow" size={16} /></a>
          <span className={"gps" + (geo ? " on" : "")} title={geo ? `±${geo.acc.toFixed(0)}m` : "No location"}>
            <Icon name="location" size={14} />
            {geo ? "GPS" : "—"}
          </span>
          <span className="prov">server</span>
          <span className={"live" + (running ? " on" : "")}><i />{running ? "SCANNING" : "IDLE"}</span>
        </div>
      </header>

      <main className="main">
        <div className="stagewrap">
          <div className="stage">
            <canvas ref={canvasRef} />
            {mode === "live" && !running && !err && <div className="overlay"><button className="cta" onClick={startCam}><Icon name="scan" size={18} />Start scan</button><p>Point the camera along a cable to inspect for breaks, arc faults and foreign objects.</p></div>}
            {mode === "video" && !hasVideo && !err && <div className="overlay"><label className="cta"><Icon name="upload" size={18} />Upload footage<input type="file" accept="video/*" hidden onChange={onVideo} /></label><p>Upload a line-scan video. Pause any time and run AI Analysis on that frame.</p></div>}
            {mode === "image" && !imgRef.current && !err && <div className="overlay"><label className="cta"><Icon name="image" size={18} />Choose image<input type="file" accept="image/*" hidden onChange={onImage} /></label><p>Analyse a single still image at full resolution.</p></div>}
            {busyImg && <div className="overlay"><div className="spin" /><p>Analysing image…</p></div>}
            {err && <div className="overlay err"><p>{err}</p></div>}
          </div>
          <div className="vidbar" style={{ display: mode === "video" && hasVideo ? "flex" : "none" }}>
            <video ref={videoRef} playsInline controls={mode === "video"} />
            <button className="vclear" onClick={clearVideo}>Clear video</button>
          </div>
        </div>

        <aside className="side">
          <div className="seg">
            <button className={mode === "live" ? "on" : ""} onClick={() => switchMode("live")}><Icon name="camera" size={18} />Live</button>
            <button className={mode === "video" ? "on" : ""} onClick={() => switchMode("video")}><Icon name="video" size={18} />Video</button>
            <button className={mode === "image" ? "on" : ""} onClick={() => switchMode("image")}><Icon name="image" size={18} />Image</button>
          </div>

          <div className="ctl">
            {mode === "live" && (running ? <button className="btn stop" onClick={() => stopCam(true)}><Icon name="stop" size={18} />Stop scan</button> : <button className="btn go" onClick={startCam}><Icon name="scan" size={18} />Start scan</button>)}
            {mode === "video" && <label className="btn go"><Icon name="upload" size={18} />{hasVideo ? "Replace footage" : "Upload footage"}<input type="file" accept="video/*" hidden onChange={onVideo} /></label>}
            {mode === "image" && <label className="btn go"><Icon name="image" size={18} />Choose image<input type="file" accept="image/*" hidden onChange={onImage} /></label>}
          </div>

          <button className="btn ai" onClick={runAI} disabled={aiBusy} style={{ width: "100%" }}>
            <Icon name="ai" size={18} />{aiBusy ? "Analysing…" : "AI Analysis" + (mode === "video" ? " (current frame)" : "")}
          </button>

          {savedBanner && <a href="/dashboard" className="savedbanner">
            <span>Inspection saved · {incidents.length} finding{incidents.length === 1 ? "" : "s"}</span>
            <strong>View in dashboard <Icon name="arrow" size={16} /></strong>
          </a>}

          <div className="stats">
            <div className="stat"><span className="k">Engine</span><span className="v" style={{ fontSize: ".92rem", textTransform: "uppercase" }}>server</span></div>
            <div className="stat"><span className="k">{mode === "image" ? "Faults" : "FPS"}</span><span className="v">{mode === "image" ? incidents.length : (running ? fps : "—")}</span></div>
            <div className="stat"><span className="k">Duration</span><span className="v">{mode === "image" ? "—" : `${mm}:${ss}`}</span></div>
          </div>

          <div className="sevbar">
            <div className="sv" style={{ ["--c" as any]: SEV_COLOR.Critical }}><div className="n">{counts.Critical}</div><div className="l">Critical</div></div>
            <div className="sv" style={{ ["--c" as any]: SEV_COLOR.High }}><div className="n">{counts.High}</div><div className="l">High</div></div>
            <div className="sv" style={{ ["--c" as any]: SEV_COLOR.Medium }}><div className="n">{counts.Medium}</div><div className="l">Medium</div></div>
          </div>

          {(ai || aiBusy || aiErr) && (
            <div className="aibox">
              <div className="aihead">
                <span className="t">Vision-model review</span>
                {aiTag && <span className="aitag" style={{ background: aiTag.c }}>{aiTag.t}</span>}
              </div>
              {aiBusy && <div className="aispin"><i />Reviewing the frame…</div>}
              {aiErr && <div className="aiwarn">{aiErr}</div>}
              {ai && !aiBusy && (
                <div className="aibody">
                  {ai.observation}
                  {sideConcern && (<><b>Concerns</b>{ai.concerns}</>)}
                  {ai.regions && ai.regions.length > 0 && <><b>Marked regions</b>{ai.regions.map(r => r.label).join(", ")}</>}
                  {falsePos && <div className="aiwarn">No cable identified in view — the {incidents.length} logged detection(s) are likely false positives.</div>}
                </div>
              )}
            </div>
          )}

          <div className="thr">
            <div className="thrhead"><span>Sensitivity</span><span>{thresh.toFixed(2)}</span></div>
            <input type="range" min="0.1" max="0.9" step="0.05" value={thresh} onChange={e => setThresh(parseFloat(e.target.value))} />
          </div>

          <div className="feed">
            <h4><span>Live incident feed</span><span>{incidents.length}</span></h4>
            <div className="feedscroll">
              {incidents.length === 0 ? <p className="none">No faults detected yet.</p>
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

          <div className="foot">YOLO26m · 3 classes · mAP50 0.884 · reports in dashboard</div>
        </aside>
      </main>
    </div>
  );
}