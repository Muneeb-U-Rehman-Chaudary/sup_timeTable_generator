"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";

interface LectureEntry {
  day: string;
  time: string;
  startTime: string;
  endTime: string;
  subject: string;
  teacher: string;
  room: string;
  section: string;
}

interface SectionInfo {
  entries: LectureEntry[];
  grid: Record<string, Record<string, { subject: string; teacher: string; room: string }>>;
  days: string[];
  times: string[];
}

interface ParseResult {
  section: string;
  sectionData: Record<string, SectionInfo>;
  availableSections: string[];
  totalEntries: number;
}

const STORAGE_KEY = "timetable_data";
const FILE_KEY = "timetable_file";

function saveToStorage(data: ParseResult) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}
function loadFromStorage(): ParseResult | null {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function clearStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(FILE_KEY);
  } catch {}
}

export default function Home() {
  const [data, setData] = useState<ParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sectionInput, setSectionInput] = useState("");
  const [activeSection, setActiveSection] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list" | "detail">("grid");
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const storedFileRef = useRef<File | null>(null);
  const [sectionSearch, setSectionSearch] = useState("");
  const [downloading, setDownloading] = useState<"single" | "all" | null>(null);

  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) {
      setData(stored);
      const s = Object.keys(stored.sectionData);
      if (s.length > 0) setActiveSection(s[0]);
    }
    const fn = localStorage.getItem(FILE_KEY);
    if (fn) setFileName(fn);
    setHydrated(true);
  }, []);

  const handleUpload = useCallback(async (file: File, section?: string) => {
    setLoading(true);
    setError("");
    storedFileRef.current = file;
    const form = new FormData();
    form.append("file", file);
    const sec = section ?? sectionInput;
    if (sec.trim()) form.append("section", sec.trim());
    try {
      const res = await fetch("/api/parse", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Failed to parse"); setLoading(false); return; }
      const result = json as ParseResult;
      setData(result);
      saveToStorage(result);
      setFileName(file.name);
      try { localStorage.setItem(FILE_KEY, file.name); } catch {}
      const sections = Object.keys(result.sectionData);
      setActiveSection(sections.length > 0 ? sections[0] : "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }, [sectionInput]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleUpload(f);
  }, [handleUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleUpload(f);
  }, [handleUpload]);

  const handleReset = () => {
    setData(null); setError(""); setSectionInput(""); setActiveSection(""); setFileName("");
    clearStorage();
    storedFileRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSectionClick = async (sec: string) => {
    setActiveSection(sec);
    if (data && (!data.sectionData[sec] || data.sectionData[sec].entries.length === 0) && storedFileRef.current) {
      await handleUpload(storedFileRef.current, sec);
    }
  };

  const downloadPDF = async (sectionKey: string) => {
    if (!data) return;
    const info = data.sectionData[sectionKey];
    if (!info) return;
    setDownloading("single");
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      pdf.text(`Timetable - ${sectionKey}`, 14, 15);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Generated ${new Date().toLocaleDateString()}`, 14, 21);
      autoTable(pdf, {
        head: [["Time", ...info.days]],
        body: info.times.map((ti) => [
          ti,
          ...info.days.map((d) => {
            const cl = info.grid[ti]?.[d];
            return cl ? `${cl.subject}\n${cl.teacher}\n${cl.room}` : "";
          }),
        ]),
        startY: 26,
        styles: { fontSize: 7, cellPadding: 2, lineWidth: 0.1, lineColor: [80, 80, 80] },
        headStyles: { fillColor: [124, 92, 252], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 30 } },
        theme: "grid",
      });
      pdf.addPage();
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text(`Lecture Details - ${sectionKey}`, 14, 15);
      autoTable(pdf, {
        head: [["Sr No.", "Day", "Start Time", "End Time", "Location", "Subject", "Teacher Name"]],
        body: info.entries.map((e, i) => [
          String(i + 1), e.day, e.startTime, e.endTime, e.room, e.subject, e.teacher,
        ]),
        startY: 20,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [124, 92, 252], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        theme: "grid",
      });
      pdf.save(`Timetable-${sectionKey}.pdf`);
    } finally {
      setDownloading(null);
    }
  };

  const downloadAllPDF = async () => {
    if (!data) return;
    const sections = Object.keys(data.sectionData);
    if (sections.length === 0) return;
    setDownloading("all");
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      let first = true;
      for (const sec of sections) {
        const info = data.sectionData[sec];
        if (!info || info.entries.length === 0) continue;
        if (!first) pdf.addPage();
        first = false;
        pdf.setFontSize(16);
        pdf.setFont("helvetica", "bold");
        pdf.text(`${sec}`, 14, 15);
        autoTable(pdf, {
          head: [["Time", ...info.days]],
          body: info.times.map((ti) => [
            ti,
            ...info.days.map((d) => {
              const cl = info.grid[ti]?.[d];
              return cl ? `${cl.subject}\n${cl.teacher}\n${cl.room}` : "";
            }),
          ]),
          startY: 20,
          styles: { fontSize: 6.5, cellPadding: 1.5, lineWidth: 0.1, lineColor: [80, 80, 80] },
          headStyles: { fillColor: [124, 92, 252], textColor: [255, 255, 255], fontStyle: "bold" },
          alternateRowStyles: { fillColor: [245, 245, 245] },
          columnStyles: { 0: { fontStyle: "bold", cellWidth: 28 } },
          theme: "grid",
        });
      }
      pdf.save("Timetable-All-Sections.pdf");
    } finally {
      setDownloading(null);
    }
  };

  const activeSectionData = data?.sectionData[activeSection];
  const sectionKeys = data ? Object.keys(data.sectionData) : [];

  const c = {
    bg: "#000000",
    fg: "#ededed",
    fgMuted: "#888888",
    fgDim: "#666666",
    card: "#0a0a0a",
    cardBorder: "#1a1a1a",
    inputBg: "#0a0a0a",
    inputBorder: "#333333",
    tableHeaderBg: "#0a0a0a",
    tableHeaderFg: "#888888",
    rowBorder: "#1a1a1a",
    filledBg: "rgba(124,92,252,0.05)",
    accent: "#7c5cfc",
    accentHover: "#6d4aed",
    accentBg: "rgba(124,92,252,0.08)",
    navBg: "rgba(0,0,0,0.8)",
    navBorder: "#1a1a1a",
      gridLine: "rgba(255,255,255,0.07)",
    badgeBg: "#1a1a1a",
    badgeBorder: "#333333",
    badgeFg: "#888888",
    activeBadgeBg: "#ededed",
    activeBadgeFg: "#000000",
    detailHeader: "#7c5cfc",
    spinnerClr1: "#7c5cfc",
    spinnerClr2: "#a78bfa",
  };

  if (!hydrated) return null;

  const features = [
    {
      title: "Grid View",
      desc: "See your full weekly schedule at a glance in a clean grid layout.",
      illustration: (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gridTemplateRows: "repeat(3, 1fr)", gap: 3, width: "100%", height: "100%" }}>
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} style={{
              borderRadius: 3,
              background: [2, 4, 7, 9, 11, 13].includes(i) ? "rgba(124,92,252,0.25)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${[2, 4, 7, 9, 11, 13].includes(i) ? "rgba(124,92,252,0.3)" : "rgba(255,255,255,0.05)"}`,
            }} />
          ))}
        </div>
      ),
    },
    {
      title: "PDF Export",
      desc: "Download timetables as beautifully formatted PDFs for print or sharing.",
      illustration: (
        <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", width: "100%", height: "100%", gap: 6 }}>
          <div style={{ width: 52, height: 64, borderRadius: 4, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", position: "relative", display: "flex", flexDirection: "column" as const, padding: "8px 6px", gap: 3 }}>
            <div style={{ height: 3, width: "80%", borderRadius: 2, background: "rgba(124,92,252,0.4)" }} />
            <div style={{ height: 2, width: "100%", borderRadius: 2, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ height: 2, width: "100%", borderRadius: 2, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ height: 2, width: "60%", borderRadius: 2, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ flex: 1 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ height: 4, borderRadius: 1, background: i % 2 === 0 ? "rgba(124,92,252,0.2)" : "rgba(255,255,255,0.04)" }} />
              ))}
            </div>
            <div style={{ position: "absolute", bottom: -3, right: -3, width: 16, height: 16, borderRadius: 3, background: c.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="8" height="8" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4" /></svg>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Multi-Section",
      desc: "Parse and switch between all sections in your department timetable.",
      illustration: (
        <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", width: "100%", height: "100%", gap: 8 }}>
          {["BSSE-4A", "BSAI-3B", "BSDS-2C"].map((label, i) => (
            <div key={i} style={{
              padding: "5px 16px", borderRadius: 6, fontSize: 10, fontWeight: 600, letterSpacing: "0.02em",
              background: i === 0 ? "rgba(124,92,252,0.2)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${i === 0 ? "rgba(124,92,252,0.35)" : "rgba(255,255,255,0.06)"}`,
              color: i === 0 ? c.accent : "rgba(255,255,255,0.25)",
              transform: `translateX(${i === 0 ? 0 : i === 1 ? -8 : 8}px)`,
            }}>
              {label}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "Instant Parsing",
      desc: "Upload your Excel file and get structured results in seconds.",
      illustration: (
        <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", width: "100%", height: "100%", gap: 8 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, border: "1px solid rgba(124,92,252,0.3)",
            background: "rgba(124,92,252,0.08)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke={c.accent} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: "50%",
                background: i === 0 ? c.accent : i === 1 ? "rgba(124,92,252,0.4)" : "rgba(124,92,252,0.15)",
              }} />
            ))}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: c.bg, color: c.fg, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Navbar */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 52, borderBottom: `1px solid ${c.navBorder}`,
        background: c.navBg, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Image src='/images/image1.png' alt='Logo' width={50} height={50} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {data && (
            <button onClick={handleReset} style={{
              padding: "6px 14px", background: "transparent", border: `1px solid ${c.cardBorder}`,
              borderRadius: 6, color: c.fgMuted, fontSize: 13, cursor: "pointer",
              transition: "all 0.15s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = c.inputBorder; e.currentTarget.style.color = c.fg; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = c.cardBorder; e.currentTarget.style.color = c.fgMuted; }}
            >
              New File
            </button>
          )}
              <a href="https://www.linkedin.com/in/muneeb-u-rehman-a0151a31a" target="_blank" rel="noopener noreferrer" style={{
                width: 34, height: 34, borderRadius: 6, border: `1px solid ${c.cardBorder}`,
                background: "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                color: c.fgMuted, textDecoration: "none", transition: "all 0.2s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = c.inputBorder; e.currentTarget.style.color = c.fg; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = c.cardBorder; e.currentTarget.style.color = c.fgMuted; e.currentTarget.style.background = "transparent"; }}
              >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
                <a href="https://github.com/Muneeb-U-Rehman-Chaudary/" target="_blank" rel="noopener noreferrer" style={{
                  width: 34, height: 34, borderRadius: 6, border: `1px solid ${c.cardBorder}`,
                  background: "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                  color: c.fgMuted, textDecoration: "none", transition: "all 0.2s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = c.inputBorder; e.currentTarget.style.color = c.fg; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = c.cardBorder; e.currentTarget.style.color = c.fgMuted; e.currentTarget.style.background = "transparent"; }}
                >
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                </a>
        </div>
      </nav>

      {!data ? (
        /* ========== LANDING PAGE ========== */
        <div>
          {/* Hero Section */}
            <section style={{
              position: "relative", overflow: "hidden",
              paddingTop: "clamp(80px, 12vw, 140px)", paddingBottom: 80,
              textAlign: "center",
            }}>
                {/* Next.js-style subtle gradient background */}
                <div className="hero-aurora" style={{
                  position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden",
                }}>
                  {/* Soft top glow */}
                    <div style={{
                      position: "absolute", top: "-30%", left: "50%", transform: "translateX(-50%)",
                      width: "140%", height: "600px",
                      background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(124,92,252,0.30) 0%, rgba(124,92,252,0.08) 40%, transparent 70%)",
                    }} />
                    {/* Left beam */}
                    <div className="hero-beam hero-beam-1" style={{
                      position: "absolute", top: "-20%", left: "15%",
                      width: "300px", height: "550px",
                      background: "linear-gradient(180deg, rgba(124,92,252,0.28) 0%, rgba(99,102,241,0.12) 40%, transparent 80%)",
                      transform: "rotate(-15deg)", borderRadius: "50%",
                      filter: "blur(50px)",
                    }} />
                    {/* Right beam */}
                    <div className="hero-beam hero-beam-2" style={{
                      position: "absolute", top: "-10%", right: "10%",
                      width: "350px", height: "500px",
                      background: "linear-gradient(180deg, rgba(168,85,247,0.20) 0%, rgba(59,130,246,0.10) 50%, transparent 85%)",
                      transform: "rotate(20deg)", borderRadius: "50%",
                      filter: "blur(50px)",
                    }} />
                </div>

              {/* Grid lines background */}
              <div style={{
                position: "absolute", inset: 0, pointerEvents: "none",
                backgroundImage: `linear-gradient(${c.gridLine} 1px, transparent 1px), linear-gradient(90deg, ${c.gridLine} 1px, transparent 1px)`,
                backgroundSize: "64px 64px",
                maskImage: "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)",
                WebkitMaskImage: "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)",
              }} />

              {/* Horizontal gradient line accent */}
                <div style={{
                  position: "absolute", top: "45%", left: 0, right: 0, height: "1px",
                    background: "linear-gradient(90deg, transparent, rgba(124,92,252,0.12) 30%, rgba(168,85,247,0.18) 50%, rgba(59,130,246,0.12) 70%, transparent)",
                  pointerEvents: "none",
                }} />

            <div style={{ position: "relative", maxWidth: 800, margin: "0 auto", padding: "0 24px" }}>
              {/* Badge */}
              <div className="fade-in-up" style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "6px 16px", borderRadius: 999,
                border: `1px solid ${c.cardBorder}`, background: "rgba(124,92,252,0.06)",
                marginBottom: 28, fontSize: 13, color: c.fgMuted,
              }}>
                <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                  background: c.accent, boxShadow: `0 0 8px ${c.accent}`,
                }} />
                Open Source Timetable Tool
              </div>

              {/* Main heading */}
              <h1 className="fade-in-up delay-1" style={{
                fontSize: "clamp(36px, 6vw, 72px)", fontWeight: 800,
                letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: 20,
                background: "linear-gradient(180deg, #ffffff 0%, #ffffff 40%, #999999 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>
                The Timetable
                <br />
                Generator
              </h1>

              <p className="fade-in-up delay-2" style={{
                fontSize: "clamp(16px, 2vw, 20px)", color: c.fgMuted,
                lineHeight: 1.6, maxWidth: 520, margin: "0 auto 40px",
                letterSpacing: "-0.01em",
              }}>
                Upload your department&apos;s Excel timetable and instantly get a clean,
                organized schedule with PDF export.
              </p>

              {/* Upload area */}
              {loading ? (
                <div className="fade-in-up" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, marginTop: 8 }}>
                  <div
                    className="block-spinner"
                    style={{
                      // @ts-expect-error CSS custom properties
                      "--spinner-clr1": c.spinnerClr1,
                      "--spinner-clr2": c.spinnerClr2,
                    }}
                  />
                  <p style={{ color: c.fgMuted, fontSize: 14 }}>Parsing timetable...</p>
                </div>
              ) : (
                <div className="fade-in-up delay-3" style={{ maxWidth: 460, margin: "0 auto" }}>
                  {/* Section input */}
                  <input
                    type="text"
                    placeholder="Section filter (e.g. BSSE-4C) — leave empty for all"
                    value={sectionInput}
                    onChange={(e) => setSectionInput(e.target.value)}
                    style={{
                      width: "100%", padding: "12px 16px", marginBottom: 14,
                      background: c.inputBg, border: `1px solid ${c.inputBorder}`,
                      borderRadius: 10, color: c.fg, fontSize: 14, outline: "none",
                      boxSizing: "border-box", transition: "border-color 0.2s",
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = c.accent}
                    onBlur={e => e.currentTarget.style.borderColor = c.inputBorder}
                  />

                  {/* Drop zone */}
                  <div
                    style={{
                      padding: "40px 24px", borderRadius: 12,
                      border: `2px dashed ${dragOver ? c.accent : c.inputBorder}`,
                      background: dragOver ? c.accentBg : "rgba(10,10,10,0.5)",
                      cursor: "pointer", transition: "all 0.2s",
                    }}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    onMouseEnter={e => { if (!dragOver) e.currentTarget.style.borderColor = c.fgDim; }}
                    onMouseLeave={e => { if (!dragOver) e.currentTarget.style.borderColor = c.inputBorder; }}
                  >
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange} style={{ display: "none" }} />
                    <div style={{
                      width: 48, height: 48, borderRadius: 12, margin: "0 auto 14px",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(124,92,252,0.1)", border: `1px solid rgba(124,92,252,0.2)`,
                    }}>
                      <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke={c.accent} strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" />
                      </svg>
                    </div>
                    <p style={{ color: c.fg, fontSize: 15, fontWeight: 500 }}>
                      Drop your Excel file here, or <span style={{ color: c.accent, fontWeight: 600 }}>browse</span>
                    </p>
                    <p style={{ color: c.fgDim, fontSize: 13, marginTop: 4 }}>Supports .xlsx and .xls files</p>
                  </div>
                </div>
              )}

              {error && (
                <div style={{
                  marginTop: 16, padding: "10px 16px", background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, color: "#f87171",
                  fontSize: 13, maxWidth: 460, margin: "16px auto 0",
                }}>{error}</div>
              )}
            </div>
          </section>

          {/* Divider */}
          <div style={{ width: "100%", height: 1, background: `linear-gradient(90deg, transparent, ${c.cardBorder}, transparent)` }} />

          {/* Features Section — illustration boxes */}
          <section style={{ maxWidth: 1000, margin: "0 auto", padding: "80px 24px" }}>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <h2 className="fade-in-up" style={{
                fontSize: "clamp(24px, 4vw, 40px)", fontWeight: 700,
                letterSpacing: "-0.03em", marginBottom: 12,
                background: "linear-gradient(180deg, #ffffff 20%, #888888 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>
                Everything you need
              </h2>
              <p className="fade-in-up delay-1" style={{ color: c.fgMuted, fontSize: 16, maxWidth: 440, margin: "0 auto" }}>
                A complete toolkit to transform messy Excel timetables into clean, shareable schedules.
              </p>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}>
              {features.map((f, i) => (
                <div key={i} className={`feature-card fade-in-up delay-${i + 1}`} style={{
                  borderRadius: 16, overflow: "hidden",
                  border: `1px solid ${c.cardBorder}`,
                  background: c.card,
                  transition: "border-color 0.3s, transform 0.3s",
                  cursor: "default",
                }}>
                  {/* Illustration area with grid bg */}
                  <div style={{
                    height: 160, position: "relative", padding: 24,
                    backgroundImage: `linear-gradient(${c.gridLine} 1px, transparent 1px), linear-gradient(90deg, ${c.gridLine} 1px, transparent 1px)`,
                    backgroundSize: "24px 24px",
                    borderBottom: `1px solid ${c.cardBorder}`,
                  }}>
                    {/* Subtle gradient overlay */}
                    <div style={{
                      position: "absolute", inset: 0, pointerEvents: "none",
                      background: "radial-gradient(circle at 50% 80%, rgba(124,92,252,0.06) 0%, transparent 60%)",
                    }} />
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                      {f.illustration}
                    </div>
                  </div>
                  {/* Text area */}
                  <div style={{ padding: "20px 24px 24px" }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 8 }}>{f.title}</h3>
                    <p style={{ fontSize: 14, color: c.fgMuted, lineHeight: 1.55 }}>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Footer */}
            <footer style={{
              borderTop: `1px solid ${c.cardBorder}`,
              padding: "24px", textAlign: "center",
              fontSize: 13, color: c.fgDim,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
            }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <a href="https://github.com/Muneeb-U-Rehman-Chaudary/" target="_blank" rel="noopener noreferrer" style={{ color: c.fgMuted, transition: "color 0.2s", textDecoration: "none" }}
                  onMouseEnter={e => e.currentTarget.style.color = c.fg}
                  onMouseLeave={e => e.currentTarget.style.color = c.fgMuted}
                >
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                  </a>
                  <a href="https://www.linkedin.com/in/muneeb-u-rehman-a0151a31a" target="_blank" rel="noopener noreferrer" style={{ color: c.fgMuted, transition: "color 0.2s", textDecoration: "none" }}
                    onMouseEnter={e => e.currentTarget.style.color = c.fg}
                    onMouseLeave={e => e.currentTarget.style.color = c.fgMuted}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
              </div>
              <span>&copy; {new Date().getFullYear()} Muneeb u Rehman &middot; Superior University</span>
            </footer>
        </div>
      ) : (
        /* ========== RESULTS VIEW ========== */
        <div className="results-container" style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "24px 24px 60px" }}>
          {/* Header row */}
          <div className="results-header fade-in-up" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.02em" }}>
                {activeSection || "All Sections"}
              </h2>
              <p style={{ fontSize: 13, color: c.fgMuted, marginTop: 4 }}>
                {activeSectionData?.entries.length ?? 0} lectures
                {fileName && <> &middot; {fileName}</>}
              </p>
            </div>
            <div className="results-actions" style={{ display: "flex", gap: 8 }}>
              {activeSection && (
                <button onClick={() => downloadPDF(activeSection)} disabled={downloading !== null} style={{
                  display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 18px",
                  background: downloading === "single" ? c.accentHover : c.accent, color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 13, fontWeight: 600, cursor: downloading ? "not-allowed" : "pointer",
                  opacity: downloading && downloading !== "single" ? 0.5 : 1, transition: "all 0.15s",
                }}>
                  {downloading === "single" ? (
                    <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                  ) : (
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" /></svg>
                  )}
                  {downloading === "single" ? "Generating..." : "Download PDF"}
                </button>
              )}
              {sectionKeys.length > 1 && (
                <button onClick={downloadAllPDF} disabled={downloading !== null} style={{
                  display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 18px",
                  background: "transparent", color: c.fg, border: `1px solid ${c.cardBorder}`,
                  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: downloading ? "not-allowed" : "pointer",
                  opacity: downloading && downloading !== "all" ? 0.5 : 1, transition: "all 0.15s",
                }}>
                  {downloading === "all" ? (
                    <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.15)", borderTopColor: c.accent, borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                  ) : (
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" /></svg>
                  )}
                  {downloading === "all" ? "Generating..." : "Download All"}
                </button>
              )}
            </div>
          </div>

          {/* Section selector with search */}
          {sectionKeys.length > 1 && (() => {
            const filtered = sectionSearch.trim()
              ? sectionKeys.filter(s => s.toLowerCase().includes(sectionSearch.toLowerCase()))
              : sectionKeys;
            return (
              <div className="section-selector fade-in-up delay-1" style={{
                marginBottom: 20, padding: "14px 16px",
                background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 10,
                height: 140, display: "flex", flexDirection: "column",
              }}>
                {/* Search input */}
                <div className="search-wrap" style={{ position: "relative", marginBottom: 10, maxWidth: 280, flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.fgDim} strokeWidth={2}
                    style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    placeholder={`Search ${sectionKeys.length} sections...`}
                    value={sectionSearch}
                    onChange={e => setSectionSearch(e.target.value)}
                    style={{
                      width: "100%", padding: "8px 12px 8px 34px",
                      background: c.bg, border: `1px solid ${c.cardBorder}`,
                      borderRadius: 7, color: c.fg, fontSize: 13, outline: "none",
                      boxSizing: "border-box", transition: "border-color 0.15s",
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = c.inputBorder}
                    onBlur={e => e.currentTarget.style.borderColor = c.cardBorder}
                  />
                </div>
                {/* Filtered badges */}
                <div className="section-scroll" style={{
                  display: "flex", flexWrap: "wrap", gap: 6, overflowY: "auto",
                  paddingBottom: 4, flex: 1,
                }}>
                  {filtered.map((sec, i) => (
                    <button key={sec} onClick={() => { handleSectionClick(sec); setSectionSearch(""); }}
                      className="section-badge"
                      style={{
                        padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        border: activeSection === sec ? "none" : `1px solid ${c.badgeBorder}`,
                        background: activeSection === sec ? c.activeBadgeBg : "transparent",
                        color: activeSection === sec ? c.activeBadgeFg : c.badgeFg,
                        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                        whiteSpace: "nowrap", flexShrink: 0, height: "fit-content",
                        animation: `badgeSlideIn 0.3s ease-out ${i * 0.02}s both`,
                      }}>
                      {sec}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <span style={{ fontSize: 13, color: c.fgDim, padding: "6px 0" }}>No sections match &ldquo;{sectionSearch}&rdquo;</span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* View toggle */}
          <div className="view-toggle fade-in-up delay-2" style={{ display: "inline-flex", gap: 1, marginBottom: 20, background: c.card, borderRadius: 8, padding: 3, border: `1px solid ${c.cardBorder}` }}>
            {(["grid", "detail", "list"] as const).map((m) => (
              <button key={m} onClick={() => setViewMode(m)} style={{
                padding: "5px 14px", borderRadius: 5, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: viewMode === m ? c.accent : "transparent",
                color: viewMode === m ? "#fff" : c.fgMuted,
                transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              }}>
                {m === "grid" ? "Weekly" : m === "detail" ? "Details" : "List"}
              </button>
            ))}
          </div>

          {/* Content */}
          {activeSectionData && activeSectionData.entries.length > 0 ? (
            <div className="fade-in-up delay-3">
              {viewMode === "grid" && (
                <div className="table-wrap">
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={thStyle(c)}>Time</th>
                        {activeSectionData.days.map((d) => (
                          <th key={d} style={thStyle(c)}>{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeSectionData.times.map((ti, rowIdx) => (
                        <tr key={ti} style={{ animation: `tableRowFade 0.3s ease-out ${rowIdx * 0.04}s both` }}>
                          <td style={{ padding: "7px 10px", borderBottom: `1px solid ${c.rowBorder}`, fontWeight: 600, color: c.fg, whiteSpace: "nowrap", fontSize: 11, background: c.tableHeaderBg }}>{ti}</td>
                          {activeSectionData.days.map((d) => {
                            const cell = activeSectionData.grid[ti]?.[d];
                            return (
                              <td key={d} style={{ padding: "6px 8px", borderBottom: `1px solid ${c.rowBorder}`, borderLeft: `1px solid ${c.rowBorder}`, background: cell ? c.filledBg : "transparent", minWidth: 110, verticalAlign: "top" }}>
                                {cell ? (
                                  <>
                                    <div style={{ fontWeight: 600, fontSize: 11, color: c.fg, lineHeight: 1.3 }}>{cell.subject}</div>
                                    <div style={{ fontSize: 10, color: c.fgMuted, marginTop: 1 }}>{cell.teacher}</div>
                                    <div style={{ fontSize: 10, color: c.fgDim, marginTop: 1 }}>{cell.room}</div>
                                  </>
                                ) : (
                                  <span style={{ color: c.fgDim, fontSize: 10 }}>-</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {viewMode === "detail" && (
                <div className="table-wrap">
                  <table className="detail-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {["Sr No.", "Day", "Start Time", "End Time", "Location", "Subject", "Teacher Name"].map((h) => (
                          <th key={h} style={{
                            padding: "9px 12px", textAlign: "left", fontWeight: 700, fontSize: 12,
                            background: c.detailHeader, color: "#fff",
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeSectionData.entries.map((e, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "#0d0b14" : "#0a0a0a", animation: `tableRowFade 0.3s ease-out ${i * 0.03}s both` }}>
                          <td style={dtdStyle(c)}>{i + 1}</td>
                          <td style={{ ...dtdStyle(c), fontWeight: 600 }}>{e.day}</td>
                          <td style={dtdStyle(c)}>{e.startTime}</td>
                          <td style={dtdStyle(c)}>{e.endTime}</td>
                          <td style={dtdStyle(c)}>{e.room}</td>
                          <td style={{ ...dtdStyle(c), fontWeight: 600 }}>{e.subject}</td>
                          <td style={dtdStyle(c)}>{e.teacher}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {viewMode === "list" && (
                <div className="table-wrap">
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {["#", "Day", "Time", "Subject", "Teacher", "Room"].map((h) => (
                          <th key={h} style={thStyle(c)}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeSectionData.entries.map((e, i) => (
                        <tr key={i} style={{ animation: `tableRowFade 0.3s ease-out ${i * 0.03}s both` }}>
                          <td style={{ padding: "7px 10px", borderBottom: `1px solid ${c.rowBorder}`, color: c.fgMuted, fontSize: 11 }}>{i + 1}</td>
                          <td style={{ padding: "7px 10px", borderBottom: `1px solid ${c.rowBorder}`, color: c.fg, fontSize: 11 }}>{e.day}</td>
                          <td style={{ padding: "7px 10px", borderBottom: `1px solid ${c.rowBorder}`, color: c.fg, fontSize: 11 }}>{e.time}</td>
                          <td style={{ padding: "7px 10px", borderBottom: `1px solid ${c.rowBorder}`, color: c.fg, fontWeight: 600, fontSize: 11 }}>{e.subject}</td>
                          <td style={{ padding: "7px 10px", borderBottom: `1px solid ${c.rowBorder}`, color: c.fg, fontSize: 11 }}>{e.teacher}</td>
                          <td style={{ padding: "7px 10px", borderBottom: `1px solid ${c.rowBorder}`, color: c.fg, fontSize: 11 }}>{e.room}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="fade-in-up delay-3" style={{ textAlign: "center", padding: 32, border: `1px solid ${c.cardBorder}`, borderRadius: 8, background: c.card }}>
              <p style={{ color: c.fgMuted, fontSize: 13 }}>No lectures found for this section.</p>
              {sectionKeys.length > 0 ? (
                <p style={{ color: c.fgDim, fontSize: 12, marginTop: 8 }}>
                  Select a section from the list above to view its timetable.
                </p>
              ) : storedFileRef.current ? (
                <button onClick={() => storedFileRef.current && handleUpload(storedFileRef.current, "")} style={{
                  marginTop: 12, padding: "8px 20px", background: c.accent, color: "#fff",
                  border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>
                  Load All Sections
                </button>
              ) : (
                <button onClick={handleReset} style={{
                  marginTop: 12, padding: "8px 20px", background: c.accent, color: "#fff",
                  border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>
                  Upload Again
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function thStyle(c: Record<string, string>): React.CSSProperties {
  return {
    padding: "8px 10px", textAlign: "left", background: c.tableHeaderBg,
    borderBottom: `1px solid ${c.cardBorder}`, fontSize: 10, fontWeight: 700,
    color: c.tableHeaderFg, textTransform: "uppercase", letterSpacing: "0.04em",
  };
}

function dtdStyle(c: Record<string, string>): React.CSSProperties {
  return {
    padding: "8px 12px", borderBottom: `1px solid ${c.rowBorder}`, color: c.fg, fontSize: 12,
  };
}
