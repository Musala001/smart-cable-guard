"use client";

import { useCallback, useMemo, useState } from "react";
import { CableMap } from "./CableMap";
import { filterDetections, recordsToCsv, STATUS_LABEL } from "./data";
import { Icon, type IconName } from "./Icon";
import type { CableDetection, DashboardProps, ReviewStatus } from "./types";
import type { InspectionRecord } from "./bridge";
import styles from "./RailwayDashboard.module.css";

type View = "overview" | "map" | "inspections" | "reports";

const SEV_COLOR: Record<string, string> = { Critical: "#c23a34", High: "#c67a2c", Medium: "#a98a25" };

const navigation: { id: View; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "map", label: "Cable map", icon: "map" },
  { id: "inspections", label: "Inspections", icon: "scan" },
  { id: "reports", label: "Reports", icon: "report" },
];

const shortDate = new Intl.DateTimeFormat("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
const shortTime = new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" });

function dateLabel(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${shortDate.format(date)} · ${shortTime.format(date)}` : "Invalid date";
}
function confidenceLabel(value: number | null) { return value == null ? "—" : `${Math.round(value * 100)}%`; }

function downloadFile(contents: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// severity from the cause string we stored ("Break · Critical · upper span")
function sevOf(rec: CableDetection): string {
  const m = /·\s*(Critical|High|Medium)\s*·/.exec(rec.cause || "");
  return m ? m[1] : "Medium";
}

export function RailwayDashboard({
  initialDetections,
  onReviewSave,
  workspaceName = "Cable monitoring",
  assetBasePath = "/rail-dashboard",
  inspections = [],
  onDeleteInspection,
}: DashboardProps & { inspections?: InspectionRecord[]; onDeleteInspection?: (id: string) => void }) {
  const normalizedAssetPath = assetBasePath.replace(/\/$/, "");
  const [records, setRecords] = useState<CableDetection[]>(() => (initialDetections ?? []).map((r) => ({ ...r })));
  const [view, setView] = useState<View>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(() => (initialDetections?.[0]?.id ?? null));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ReviewStatus | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<ReviewStatus>("confirmed");
  const [draftNote, setDraftNote] = useState("");
  const [openReport, setOpenReport] = useState<InspectionRecord | null>(null);
  const [toast, setToast] = useState("");

  const hasData = records.length > 0;
  const filtered = useMemo(() => filterDetections(records, { search, status }), [records, search, status]);
  const selected = useMemo(() => records.find((r) => r.id === selectedId) ?? null, [records, selectedId]);
  const visibleRows = showAll ? filtered : filtered.slice(0, 8);

  const awaiting = records.filter((r) => r.status === "awaiting").length;
  const confirmed = records.filter((r) => r.status === "confirmed").length;
  const resolved = records.filter((r) => r.status === "resolved").length;
  const scored = records.filter((r) => r.confidence != null);
  const avgConf = scored.length ? Math.round(scored.reduce((s, r) => s + (r.confidence ?? 0), 0) / scored.length * 100) : null;

  function flash(msg: string) { setToast(msg); window.setTimeout(() => setToast(""), 2600); }

  function selectAndReveal(id: string) {
    setSelectedId(id); setView("overview");
    window.setTimeout(() => document.getElementById("rail-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
  }
  function beginReview(rec: CableDetection) {
    setSelectedId(rec.id);
    setDraftStatus(rec.status === "awaiting" ? "confirmed" : rec.status);
    setDraftNote(rec.note); setReviewOpen(true);
  }
  async function saveReview() {
    if (!selected) return;
    const updated = { ...selected, status: draftStatus, note: draftNote.trim() };
    setRecords((cur) => cur.map((r) => r.id === updated.id ? updated : r));
    try { await onReviewSave?.(updated, { status: draftStatus, note: draftNote.trim() }); } catch {}
    setReviewOpen(false); flash(`${updated.id} review saved.`);
  }

  function exportAllJson() {
    downloadFile(JSON.stringify({ exportedAt: new Date().toISOString(), detections: filtered }, null, 2), "application/json", "cable-detections.json");
  }
  function exportAllCsv() {
    downloadFile(recordsToCsv(filtered), "text/csv;charset=utf-8", "cable-detections.csv");
  }

  const filterBar = <div className={styles.filters}>
    <label className={styles.searchField}>
      <span className={styles.srOnly}>Search detections</span><Icon name="search" />
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search location or ID" />
    </label>
    <label className={styles.selectField}>
      <span className={styles.srOnly}>Filter by status</span>
      <select value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus | "all")}>
        <option value="all">All statuses</option>
        <option value="awaiting">Awaiting review</option>
        <option value="confirmed">Confirmed</option>
        <option value="resolved">Resolved</option>
        <option value="dismissed">Dismissed</option>
      </select><Icon name="chevron" />
    </label>
    {(search || status !== "all") && <button type="button" className={styles.clearButton} onClick={() => { setSearch(""); setStatus("all"); }}>Clear</button>}
  </div>;

  const mapCard = <section className={`${styles.card} ${styles.mapCard}`} aria-labelledby="map-title">
    <div className={styles.cardHeader}>
      <div><p className={styles.eyebrow}>Geospatial view</p><h2 id="map-title">Detected cable faults</h2></div>
      <span className={styles.countPill}>{filtered.length} visible</span>
    </div>
    {filterBar}
    <CableMap detections={filtered} selectedId={selectedId} isDemo={false} onSelect={setSelectedId} leafletScriptUrl={`${normalizedAssetPath}/vendor/leaflet.js`} />
  </section>;

  const empty = <div className={styles.emptyState} style={{ padding: 60, textAlign: "center" }}>
    <p style={{ fontSize: "1rem", color: "#3b5549", fontWeight: 700, margin: "0 0 6px" }}>No inspections yet</p>
    <p style={{ maxWidth: 360, margin: "0 auto", color: "#7e9086" }}>Run a scan in the detector with location enabled. Findings appear here on the map, and each scan becomes a full inspection report.</p>
    <a href="/" className={styles.primaryButton} style={{ marginTop: 18, textDecoration: "none" }}><Icon name="scan" />Open the detector</a>
  </div>;

  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <img src={`${normalizedAssetPath}/logo.jpeg`} alt="rAIL" className={styles.brandImage} />
        <span>Railway intelligence</span>
      </div>
      <nav className={styles.navigation} aria-label="Dashboard">
        {navigation.map((item) => <button type="button" key={item.id} className={view === item.id ? styles.activeNav : ""} onClick={() => setView(item.id)} aria-current={view === item.id ? "page" : undefined}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </button>)}
      </nav>
      <div className={styles.sidebarFooter}>
        <div className={styles.workspaceIcon}><Icon name="route" /></div>
        <div><strong>{workspaceName}</strong><span>{records.length} detections</span></div>
      </div>
    </aside>

    <main className={styles.main}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Computer vision operations</p>
          <h1>{navigation.find((i) => i.id === view)?.label}</h1>
          <p>Monitor, inspect and report on detected cable faults.</p>
        </div>
        <div className={styles.topActions}>
          <a href="/" className={styles.secondaryButton} style={{ textDecoration: "none" }}><Icon name="scan" />Detector</a>
          <button type="button" className={styles.secondaryButton} onClick={exportAllCsv} disabled={!hasData}><Icon name="download" />CSV</button>
          <button type="button" className={styles.primaryButton} onClick={exportAllJson} disabled={!hasData}><Icon name="download" />Export</button>
        </div>
      </header>

      {view === "overview" && (hasData ? <>
        <section className={styles.stats} aria-label="Detection summary">
          <article><span className={styles.statIcon}><Icon name="cable" /></span><div><span>Total detections</span><strong>{records.length}</strong><small>Across all scans</small></div></article>
          <article><span className={`${styles.statIcon} ${styles.pendingIcon}`}><Icon name="clock" /></span><div><span>Awaiting review</span><strong>{awaiting}</strong><small>{records.length ? Math.round(awaiting / records.length * 100) : 0}% of total</small></div></article>
          <article><span className={`${styles.statIcon} ${styles.confirmedIcon}`}><Icon name="check" /></span><div><span>Confirmed</span><strong>{confirmed}</strong><small>Human verified</small></div></article>
          <article><span className={`${styles.statIcon} ${styles.resolvedIcon}`}><Icon name="report" /></span><div><span>Model confidence</span><strong>{avgConf == null ? "—" : `${avgConf}%`}</strong><small>{resolved} resolved</small></div></article>
        </section>
        <div className={styles.workspace}>
          <div className={styles.leftColumn}>
            {mapCard}
            <DetectionTable records={visibleRows} total={filtered.length} selectedId={selectedId} onSelect={selectAndReveal} onReview={beginReview} />
            {filtered.length > 8 && <button className={styles.showButton} type="button" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${filtered.length}`} <Icon name="arrow" /></button>}
          </div>
          <DetailPanel detection={selected} onClose={() => setSelectedId(null)} onReview={beginReview} />
        </div>
      </> : empty)}

      {view === "map" && (hasData ? <div className={styles.mapView}>{mapCard}<DetailPanel detection={selected} onClose={() => setSelectedId(null)} onReview={beginReview} /></div> : empty)}

      {view === "inspections" && <section className={styles.pageCard}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Inspection runs</p><h2>Saved inspections</h2></div><span>{inspections.length} reports</span></div>
        {inspections.length === 0 ? empty : <div className={styles.inspectionGrid}>
          {inspections.map((ins) => {
            const crit = ins.findings.filter((f) => f.sev === "Critical").length;
            return <article key={ins.id} className={styles.inspectionCard}>
              <span className={styles.inspectionIcon}><Icon name="scan" /></span>
              <div><h3>{shortDate.format(new Date(ins.createdAt))} · {shortTime.format(new Date(ins.createdAt))}</h3><p style={{ textTransform: "capitalize" }}>{ins.mode} scan{ins.geo ? " · GPS" : ""}</p></div>
              <dl>
                <div><dt>Findings</dt><dd>{ins.findings.length}</dd></div>
                <div><dt>Critical</dt><dd>{crit}</dd></div>
              </dl>
              <button type="button" onClick={() => setOpenReport(ins)}>Open report <Icon name="arrow" /></button>
            </article>;
          })}
        </div>}
      </section>}

      {view === "reports" && <section className={styles.pageCard}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Operational reporting</p><h2>Reports &amp; data quality</h2></div><button type="button" className={styles.primaryButton} onClick={exportAllCsv} disabled={!hasData}><Icon name="download" />Export CSV</button></div>
        {inspections.length === 0 ? empty : <div className={styles.reportGrid}>
          <article className={styles.reportCard}>
            <h3>Review status</h3><p>Across all detections.</p>
            <div className={styles.bars}>
              {(Object.keys(STATUS_LABEL) as ReviewStatus[]).map((s) => {
                const count = records.filter((r) => r.status === s).length;
                const max = Math.max(...(Object.keys(STATUS_LABEL) as ReviewStatus[]).map((k) => records.filter((r) => r.status === k).length), 1);
                return <div key={s}><span>{STATUS_LABEL[s]}</span><div><i style={{ width: `${count / max * 100}%` }} /></div><strong>{count}</strong></div>;
              })}
            </div>
          </article>
          <article className={styles.reportCard}>
            <h3>Inspection log</h3><p>Open any saved report as a printable PDF.</p>
            <dl className={styles.qualityList}>
              {inspections.slice(0, 6).map((ins) => <div key={ins.id}>
                <dt>{shortDate.format(new Date(ins.createdAt))} · {ins.mode}</dt>
                <dd><button type="button" className={styles.tableAction} onClick={() => setOpenReport(ins)}>{ins.findings.length} findings <Icon name="chevron" /></button></dd>
              </div>)}
            </dl>
          </article>
        </div>}
      </section>}
    </main>

    {reviewOpen && selected && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setReviewOpen(false); }}>
      <section className={styles.modal} role="dialog" aria-modal="true">
        <button className={styles.iconButton} type="button" onClick={() => setReviewOpen(false)} aria-label="Close"><Icon name="close" /></button>
        <p className={styles.eyebrow}>Human validation</p>
        <h2>Review {selected.id}</h2>
        <p className={styles.modalIntro}>Confirm the finding and record the operational outcome.</p>
        <label className={styles.formField}><span>Status</span><select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value as ReviewStatus)}><option value="awaiting">Awaiting review</option><option value="confirmed">Confirmed</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label>
        <label className={styles.formField}><span>Review note</span><textarea value={draftNote} onChange={(e) => setDraftNote(e.target.value)} maxLength={1500} rows={4} placeholder="Add maintenance or validation notes…" /></label>
        <div className={styles.modalActions}><button type="button" className={styles.secondaryButton} onClick={() => setReviewOpen(false)}>Cancel</button><button type="button" className={styles.primaryButton} onClick={saveReview}>Save review</button></div>
      </section>
    </div>}

    {openReport && <ReportModal inspection={openReport} onClose={() => setOpenReport(null)} onDelete={onDeleteInspection ? (id) => { onDeleteInspection(id); setOpenReport(null); flash("Inspection deleted."); } : undefined} />}

    <div className={`${styles.toast} ${toast ? styles.toastVisible : ""}`} role="status" aria-live="polite">{toast}</div>
  </div>;
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  const icon: IconName = status === "resolved" || status === "confirmed" ? "check" : status === "dismissed" ? "dismissed" : "clock";
  return <span className={`${styles.status} ${styles[status]}`}><Icon name={icon} />{STATUS_LABEL[status]}</span>;
}

function DetectionTable({ records, total, selectedId, onSelect, onReview }: { records: CableDetection[]; total: number; selectedId: string | null; onSelect: (id: string) => void; onReview: (r: CableDetection) => void }) {
  return <section className={`${styles.card} ${styles.tableCard}`}>
    <div className={styles.cardHeader}><div><p className={styles.eyebrow}>Latest findings</p><h2>Detection queue</h2></div><span className={styles.countPill}>{total} results</span></div>
    <div className={styles.tableScroll}>
      <table>
        <thead><tr><th>Detection</th><th>Fault</th><th>Confidence</th><th>Status</th><th>Detected</th><th><span className={styles.srOnly}>Action</span></th></tr></thead>
        <tbody>
          {records.map((r) => <tr key={r.id} className={selectedId === r.id ? styles.selectedRow : ""}>
            <td><button className={styles.rowLink} type="button" onClick={() => onSelect(r.id)}><span className={styles.miniCable}><Icon name="cable" /></span><span><strong>{r.id}</strong><small>{r.location}</small></span></button></td>
            <td><strong>{(r.cause || "").split(" · ")[0]}</strong><small>{sevOf(r)}</small></td>
            <td><span className={styles.confidence}>{confidenceLabel(r.confidence)}</span></td>
            <td><StatusBadge status={r.status} /></td>
            <td>{dateLabel(r.detectedAt)}</td>
            <td><button type="button" className={styles.tableAction} onClick={() => r.status === "awaiting" ? onReview(r) : onSelect(r.id)}>{r.status === "awaiting" ? "Review" : "View"}<Icon name="chevron" /></button></td>
          </tr>)}
          {!records.length && <tr><td colSpan={6} className={styles.emptyState}>No detections match these filters.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

function DetailPanel({ detection, onClose, onReview }: { detection: CableDetection | null; onClose: () => void; onReview: (r: CableDetection) => void }) {
  if (!detection) return <aside id="rail-detail" className={`${styles.card} ${styles.detailPanel} ${styles.emptyDetail}`}><Icon name="cable" /><h2>Select a detection</h2><p>Choose a marker or table row to inspect the fault record.</p></aside>;
  return <aside id="rail-detail" className={`${styles.card} ${styles.detailPanel}`}>
    <div className={styles.detailHeader}><div><p className={styles.eyebrow}>Detection detail</p><h2>{detection.id}</h2></div><button className={styles.iconButton} type="button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
    <div className={styles.imageFrame}>
      {detection.imageUrl ? <img src={detection.imageUrl} alt={`Evidence for ${detection.id}`} /> : <div className={styles.imagePlaceholder}><Icon name="image" /><span>No image</span></div>}
      <span className={styles.imageConfidence}>{confidenceLabel(detection.confidence)} confidence</span>
    </div>
    <div className={styles.detailIdentity}><span className={styles.largeCable}><Icon name="cable" /></span><div><h3>{(detection.cause || "").split(" · ")[0]}</h3><p>{detection.location}</p></div><StatusBadge status={detection.status} /></div>
    <dl className={styles.detailGrid}>
      <div><dt>Detected</dt><dd>{dateLabel(detection.detectedAt)}</dd></div>
      <div><dt>Inspection</dt><dd>{detection.inspectionId}</dd></div>
      <div><dt>Coordinates</dt><dd>{detection.latitude.toFixed(5)}, {detection.longitude.toFixed(5)}</dd></div>
      <div><dt>Assessment</dt><dd>{detection.cause}</dd></div>
    </dl>
    {detection.note && <div className={styles.note}><strong>Review note</strong><p>{detection.note}</p></div>}
    <button type="button" className={styles.primaryButton} onClick={() => onReview(detection)}><Icon name="check" />{detection.status === "awaiting" ? "Review detection" : "Update review"}</button>
  </aside>;
}

function ReportModal({ inspection, onClose, onDelete }: { inspection: InspectionRecord; onClose: () => void; onDelete?: (id: string) => void }) {
  const ins = inspection;
  const crit = ins.findings.filter((f) => f.sev === "Critical").length;
  const high = ins.findings.filter((f) => f.sev === "High").length;
  const med = ins.findings.filter((f) => f.sev === "Medium").length;
  const concerns = ins.ai && ins.ai.concerns && !["none visible", "none", "n/a", ""].includes(ins.ai.concerns.toLowerCase().trim());
  let risk = "No issues identified", riskColor = "#1d7a54";
  if (crit > 0) { risk = "Elevated"; riskColor = "#c23a34"; }
  else if (high > 0 || concerns) { risk = "Moderate"; riskColor = "#c67a2c"; }
  else if (med > 0) { risk = "Low–Moderate"; riskColor = "#a98a25"; }
  const sorted = [...ins.findings].sort((a, b) => (["Medium", "High", "Critical"].indexOf(b.sev) - ["Medium", "High", "Critical"].indexOf(a.sev)) || b.conf - a.conf);

  function exportCsv() {
    const head = "id,type,severity,confidence,region,area_pct,latitude,longitude,action";
    const body = ins.findings.map((f) => [f.id, f.className, f.sev, (f.conf * 100).toFixed(1), f.region, (f.areaFrac * 100).toFixed(2), f.lat ?? "", f.lon ?? "", `"${f.action.replace(/"/g, "'")}"`].join(",")).join("\n");
    downloadFile(head + "\n" + body, "text/csv;charset=utf-8", `inspection-${ins.id}.csv`);
  }

  return <div className={styles.reportBackdrop} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={styles.reportSheet}>
      <div className={styles.rHead}>
        <div><h2>Cable Inspection Report</h2><p>Specialist detector + vision-model review · Cable-Guard</p></div>
        <div className={styles.rBadge}><span className={styles.rLvl} style={{ background: riskColor }}>{risk} risk</span><div className={styles.rCnt}>{ins.findings.length}</div><div className={styles.rCntL}>findings</div></div>
      </div>

      <div className={styles.rMeta}>
        <div><span>Date</span><strong>{dateLabel(ins.createdAt)}</strong></div>
        <div><span>Source</span><strong style={{ textTransform: "capitalize" }}>{ins.mode}{ins.mode !== "image" ? ` · ${Math.floor(ins.durationSec / 60)}:${String(ins.durationSec % 60).padStart(2, "0")}` : ""}</strong></div>
        <div><span>Frames</span><strong>{ins.frames || 1}</strong></div>
        <div><span>Location</span><strong>{ins.geo ? `${ins.geo.lat.toFixed(4)}, ${ins.geo.lon.toFixed(4)}` : "Not available"}</strong></div>
      </div>

      <div className={styles.rBody}>
        {ins.hero && <div className={styles.rHero}>
          <img src={ins.hero} alt="Annotated inspection frame" />
          <div className={styles.rCap}>
            <i><span style={{ background: SEV_COLOR.Critical }} />Critical</i>
            <i><span style={{ background: SEV_COLOR.High }} />High</i>
            <i><span style={{ background: SEV_COLOR.Medium }} />Medium</i>
            <i><span style={{ background: "#8B7CF6" }} />AI review (indicative)</i>
          </div>
        </div>}

        <div className={styles.rSum}>
          <div className={styles.rSumCard} style={{ ["--c" as any]: "#15181c" }}><div className="n">{ins.findings.length}</div><div className="l">Total findings</div></div>
          <div className={styles.rSumCard} style={{ ["--c" as any]: SEV_COLOR.Critical }}><div className="n">{crit}</div><div className="l">Critical</div></div>
          <div className={styles.rSumCard} style={{ ["--c" as any]: SEV_COLOR.High }}><div className="n">{high}</div><div className="l">High</div></div>
          <div className={styles.rSumCard} style={{ ["--c" as any]: concerns ? "#c67a2c" : "#1d7a54" }}><div className="n" style={{ fontSize: "1.3rem" }}>{concerns ? "Yes" : ins.ai ? "No" : "—"}</div><div className="l">Visual concerns</div></div>
        </div>

        {ins.ai && <div className={styles.rSec}>
          <h3>Vision-model review</h3>
          <div className={styles.rAi}>
            <span className={styles.rAiTag}>Independent AI assessment</span>
            <p>{ins.ai.observation}</p>
            {ins.ai.condition && <><b>Condition</b><p>{ins.ai.condition}</p></>}
            {ins.ai.concerns && <><b>Additional concerns</b><p>{ins.ai.concerns}</p></>}
            {ins.ai.verdict && <><b>Verdict</b><p>{ins.ai.verdict}</p></>}
            {ins.ai.cablePresent === "no" && <div className={styles.rFlag}>No cable was identified in the reviewed frame — detector findings are likely false positives.</div>}
            {concerns && ins.findings.length === 0 && <div className={styles.rFlag}>The detector reported zero faults, but this review identified concerns outside its three trained fault types. A nil result does not mean the asset is healthy.</div>}
          </div>
        </div>}

        <div className={styles.rSec}>
          <h3>Detector findings ({sorted.length})</h3>
          {sorted.length === 0 ? <p className={styles.rNone}>The detector logged no faults of its three trained types in this scan.</p>
            : sorted.map((f, idx) => <div className={styles.rFind} key={f.id}>
              <img src={f.thumb} alt="" />
              <div className={styles.rFindBody}>
                <div className={styles.rFindHead}>
                  <span className={styles.rIdx}>#{idx + 1}</span>
                  <span className={styles.rFindType}>{f.className}</span>
                  <span className={styles.rChip} style={{ background: SEV_COLOR[f.sev] }}>{f.sev}</span>
                  {f.conf < 0.5 && <span className={styles.rVerify}>Verify</span>}
                </div>
                <p className={styles.rEv}>{(f.conf * 100).toFixed(0)}% confidence · ~{(f.areaFrac * 100).toFixed(1)}% of frame · {f.region}{f.lat != null ? ` · ${f.lat.toFixed(4)}, ${f.lon!.toFixed(4)}` : ""}</p>
                <div className={styles.rAct}><b>Recommended action</b>{f.action}</div>
              </div>
            </div>)}
        </div>
      </div>

      <div className={styles.rFoot}>
        {onDelete && <button className={styles.rDelete} onClick={() => onDelete(ins.id)}>Delete</button>}
        <button className={styles.rClose} onClick={onClose}>Close</button>
        <button className={styles.rExp} onClick={exportCsv}>Export CSV</button>
        <button className={styles.rPrint} onClick={() => window.print()}>Print / Save PDF</button>
      </div>
    </div>
  </div>;
}
