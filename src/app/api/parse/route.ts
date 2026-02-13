import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

const HF_API = "https://router.huggingface.co/v1/chat/completions";
const HF_TOKEN = process.env.HUGGINGFACE_API_TOKEN || "";

// ────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────

interface LectureEntry {
  day: string;
  time: string;          // e.g. "10:45 AM – 1:25 PM"
  startTime: string;     // now 12h e.g. "10:45 AM"
  endTime: string;       // now 12h e.g. "1:25 PM"
  subject: string;
  teacher: string;
  room: string;
  section: string;
}

interface TimeSlotInfo {
  col: number;
  raw: string;
  start12: string;       // 12h format
  end12: string;         // 12h format
}

// ────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_KEYWORDS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun", ...DAY_NAMES.map(d => d.toLowerCase())];

const DAY_ORDER: Record<string, number> = {
  Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6
};

function normalizeDayName(raw: string): string | null {
  const cleaned = raw.toLowerCase().trim().replace(/[^a-z]/g, "");
  for (const kw of DAY_KEYWORDS) {
    if (cleaned.includes(kw)) {
      return DAY_NAMES[DAY_KEYWORDS.indexOf(kw) % 7];
    }
  }
  return null;
}

function isLikelyTimeSlot(text: string): boolean {
  const cleaned = text.replace(/\s+/g, "").replace(/[.:-–—]/g, "");
  return /\d{3,4}-\d{3,4}/.test(cleaned) ||
         /\d{1,2}:\d{2}-\d{1,2}:\d{2}/.test(cleaned) ||
         /\d{1,2}\.\d{2}-\d{1,2}\.\d{2}/.test(cleaned);
}

function normalizeTimeSlot(raw: string): { start12: string; end12: string } | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  const patterns = [
    /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/,
    /(\d{2})(\d{2})[-–—](\d{2})(\d{2})/,
  ];

  for (const p of patterns) {
    const m = cleaned.match(p);
    if (m) {
      let h1 = parseInt(m[1], 10), m1 = parseInt(m[2], 10);
      let h2 = parseInt(m[3], 10), m2 = parseInt(m[4], 10);

      if (h1 <= 7) h1 += 12;
      if (h2 <= 7) h2 += 12;

      if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) continue;

      const start12 = to12Hour(`${h1.toString().padStart(2,"0")}:${m1.toString().padStart(2,"0")}`);
      const end12 = to12Hour(`${h2.toString().padStart(2,"0")}:${m2.toString().padStart(2,"0")}`);

      return { start12, end12 };
    }
  }
  return null;
}

function to12Hour(time24: string): string {
  if (!time24.includes(':')) return time24;
  let [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')} ${period}`;
}

// Helper to convert 12h time back to minutes for sorting/merging
function time12ToMinutes(time12: string): number {
  const [time, period] = time12.split(' ');
  let [h, m] = time.split(':').map(Number);
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function isLikelyRoom(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    lower.includes("room") ||
    lower.includes("lab") ||
    lower.includes("auditorium") ||
    lower.includes("hall") ||
    /^[A-Za-z]{1,3}\s*-?\s*\d{2,4}$/.test(lower) ||
    /^L?R?-?\d{2,4}$/.test(lower)
  );
}

function normalizeRoomName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower.includes("auditorium")) return "Auditorium";
  if (lower.includes("main hall")) return "Main Hall";

  const numMatch = raw.match(/(\d{2,4})/);
  if (numMatch) {
    if (lower.includes("lab") || lower.includes("computer")) return `Lab-${numMatch[1]}`;
    if (lower.includes("room") || lower.includes("lecture")) return `Room #${numMatch[1]}`;
  }
  return raw.trim();
}

const SECTION_PATTERN = /\b(BS[A-Z]{2,4}-\d{1,2}[A-Za-z]?)(?:Combined)?\b/gi;

function extractAllSections(text: string): string[] {
  const matches = [...text.matchAll(SECTION_PATTERN)];
  const sections = matches.map(m => m[1].toUpperCase());
  return [...new Set(sections)];
}

function isProbablyHeaderOrNote(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    !text.trim() ||
    lower.includes("time table") || lower.includes("timetable") ||
    lower.includes("schedule") || lower.includes("department") ||
    lower.includes("semester") || lower.includes("updated") ||
    lower.includes("effective from") || lower.includes("note:") ||
    lower.includes("page") || lower.includes("s.no") || lower.includes("sr.#") ||
    lower.includes("jumma prayer") || lower.includes("lunch") || lower.includes("break")
  );
}

// ────────────────────────────────────────────────
// AI DIAGNOSTIC
// ────────────────────────────────────────────────

async function getAiDiagnostic(
  sampleCells: string[],
  parsedCount: number,
  foundSections: string[]
): Promise<string | null> {
  if (!HF_TOKEN) {
    console.log("[AI Diagnostic] SKIPPED → No Hugging Face token provided");
    return null;
  }

  console.log("[AI Diagnostic] Starting API call (token length:", HF_TOKEN.length, ")");

  const prompt = `<s>[INST] You are an expert at analyzing university timetable Excel files.
Given the following sample cell contents and parsing statistics, write ONLY a short diagnostic report (max 5 bullet points):

Samples (first 20 non-empty cells):
${sampleCells.slice(0, 20).join("\n")}

Parsing result:
- Found ${parsedCount} lecture entries
- Detected ${foundSections.length} sections: ${foundSections.slice(0,8).join(", ") || "none"}${foundSections.length > 8 ? "..." : ""}

Write ONLY:
• Is this likely a valid timetable structure? (yes/no + short reason)
• Main parsing approach that seems to fit
• Any obvious issues / missed information you notice
• Confidence in correctness: High / Medium / Low
• One sentence suggestion to improve parsing if needed

Be concise. No introduction, no markdown, just bullets. [/INST]`;

  try {
    const res = await fetch(HF_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "Qwen/Qwen2.5-7B-Instruct",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 280,
        temperature: 0.25,
        top_p: 0.9,
      }),
    });

    console.log("[AI Diagnostic] Response status:", res.status);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "(could not read error body)");
      console.log("[AI Diagnostic] API failed:", res.status, errorText);
      return null;
    }

    const json = await res.json();
    const answer = json?.choices?.[0]?.message?.content?.trim() || null;

    if (answer) {
      console.log("[AI Diagnostic] Success – generated text length:", answer.length);
    } else {
      console.log("[AI Diagnostic] No content returned from model");
    }

    return answer;
  } catch (err) {
    console.error("[AI Diagnostic] Network / parsing error:", err);
    return null;
  }
}

// ────────────────────────────────────────────────
// MERGE CONSECUTIVE CLASSES (updated for 12h times)
// ────────────────────────────────────────────────

function mergeConsecutiveClasses(entries: LectureEntry[]): LectureEntry[] {
  if (entries.length <= 1) return entries;

  const merged: LectureEntry[] = [];
  let current = { ...entries[0] };

  for (let i = 1; i < entries.length; i++) {
    const next = entries[i];

    const sameClass =
      current.section === next.section &&
      current.day === next.day &&
      current.subject === next.subject &&
      current.teacher === next.teacher &&
      current.room === next.room;

    const consecutive = time12ToMinutes(current.endTime) === time12ToMinutes(next.startTime);

    if (sameClass && consecutive) {
      current.endTime = next.endTime;
      current.time = `${current.startTime} – ${next.endTime}`;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}

// ────────────────────────────────────────────────
// MAIN ENDPOINT
// ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const sectionFilter = (formData.get("section") as string ?? "").trim().toUpperCase();

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

    const allEntries: LectureEntry[] = [];
    const allSections = new Set<string>();
    const sampleCells: string[] = [];

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (firstSheet?.["!ref"]) {
      const rng = XLSX.utils.decode_range(firstSheet["!ref"]);
      let count = 0;
      outer: for (let r = rng.s.r; r <= rng.e.r; r++) {
        for (let c = rng.s.c; c <= rng.e.c; c++) {
          const val = firstSheet[XLSX.utils.encode_cell({ r, c })]?.v;
          if (val && typeof val === "string" && val.trim()) {
            sampleCells.push(val.trim());
            if (++count >= 35) break outer;
          }
        }
      }
    }

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.["!ref"]) continue;

      const range = XLSX.utils.decode_range(sheet["!ref"]);
      const merges = sheet["!merges"] ?? [];

      const mergeMap = new Map<string, { r: number; c: number }>();
      for (const m of merges) {
        for (let r = m.s.r; r <= m.e.r; r++) {
          for (let c = m.s.c; c <= m.e.c; c++) {
            if (r !== m.s.r || c !== m.s.c) {
              mergeMap.set(`${r},${c}`, { r: m.s.r, c: m.s.c });
            }
          }
        }
      }

      function getMergedCellValue(r: number, c: number): string {
        const origin = mergeMap.get(`${r},${c}`);
        const tr = origin ? origin.r : r;
        const tc = origin ? origin.c : c;
        const addr = XLSX.utils.encode_cell({ r: tr, c: tc });
        const val = sheet[addr]?.v;
        return val != null ? String(val).trim() : "";
      }

      let currentDay = "";
      let currentTimeSlots: TimeSlotInfo[] = [];

      for (let row = range.s.r; row <= range.e.r; row++) {
        for (let col = 0; col <= Math.min(4, range.e.c); col++) {
          const val = getMergedCellValue(row, col);
          if (!val) continue;
          const day = normalizeDayName(val);
          if (day) {
            currentDay = day;
            break;
          }
        }

        const rowTimes: TimeSlotInfo[] = [];
        for (let col = 2; col <= range.e.c; col++) {
          const val = getMergedCellValue(row, col);
          if (!val || !isLikelyTimeSlot(val)) continue;
          const norm = normalizeTimeSlot(val);
          if (norm) {
            rowTimes.push({
              col,
              raw: val,
              start12: norm.start12,
              end12: norm.end12
            });
          }
        }

        if (rowTimes.length >= 3) {
          currentTimeSlots = rowTimes;
          continue;
        }

        if (!currentDay || currentTimeSlots.length === 0) continue;

        let room = "";
        for (let col = 0; col <= Math.min(3, range.e.c); col++) {
          const val = getMergedCellValue(row, col);
          if (isLikelyRoom(val)) {
            room = normalizeRoomName(val);
            break;
          }
        }
        if (!room) continue;

        for (const ts of currentTimeSlots) {
          const content = getMergedCellValue(row, ts.col);
          if (!content || isProbablyHeaderOrNote(content)) continue;

          const sections = extractAllSections(content);
          if (sections.length === 0) continue;

          let subject = "Unknown Subject";
          let teacher = "Unknown Teacher";

          const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            if (extractAllSections(line).length > 0) continue;
            if (isLikelyTimeSlot(line)) continue;
            if (/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Prof\.?|Engr\.?|Sir|Madam)/i.test(line)) {
              teacher = line;
              continue;
            }
            if (subject === "Unknown Subject") {
              subject = line.replace(SECTION_PATTERN, "").trim() || subject;
            }
          }

          for (const sec of sections) {
            allSections.add(sec);
            allEntries.push({
              day: currentDay,
              time: `${ts.start12} – ${ts.end12}`,
              startTime: ts.start12,
              endTime: ts.end12,
              subject,
              teacher,
              room,
              section: sec
            });
          }
        }
      }
    }

    // ── Post-processing ──────────────────────────────────────

    const seen = new Set<string>();
    const unique = allEntries.filter(e => {
      const key = `${e.section}|${e.day}|${e.startTime}|${e.subject}|${e.teacher}|${e.room}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    unique.sort((a, b) => {
      const d = DAY_ORDER[a.day] - DAY_ORDER[b.day];
      if (d !== 0) return d;
      return time12ToMinutes(a.startTime) - time12ToMinutes(b.startTime);
    });

    const filtered = sectionFilter
      ? unique.filter(e => e.section === sectionFilter)
      : unique;

    const sectionsList = [...allSections].sort();
    const sectionsToShow = sectionFilter ? [sectionFilter] : sectionsList;

    const sectionData: Record<string, any> = {};

    for (const sec of sectionsToShow) {
      let secEntries = filtered.filter(e => e.section === sec);
      if (secEntries.length === 0) continue;

      secEntries = mergeConsecutiveClasses(secEntries);

      const days = [...new Set(secEntries.map(e => e.day))].sort((a,b) => DAY_ORDER[a] - DAY_ORDER[b]);

      const times = [...new Set(secEntries.map(e => e.time))].sort((a,b) => {
        const ta = a.split("–")[0].trim();
        const tb = b.split("–")[0].trim();
        return time12ToMinutes(ta) - time12ToMinutes(tb);
      });

      const grid: Record<string, Record<string, any>> = {};
      for (const t of times) {
        grid[t] = {};
        for (const d of days) {
          const match = secEntries.find(e => e.day === d && e.time === t);
          if (match) {
            grid[t][d] = {
              subject: match.subject,
              teacher: match.teacher,
              room: match.room
            };
          }
        }
      }

      sectionData[sec] = { entries: secEntries, grid, days, times };
    }

    const aiSuggestions = await getAiDiagnostic(sampleCells, filtered.length, sectionsList);

    return NextResponse.json({
      success: true,
      section: sectionFilter || "ALL",
      sectionData,
      availableSections: sectionsList,
      totalEntries: filtered.length,
      aiDiagnostic: aiSuggestions || undefined,
    });

  } catch (err: any) {
    console.error("[Timetable Parser] Error:", err);
    return NextResponse.json(
      { error: "Failed to parse timetable", details: err.message },
      { status: 500 }
    );
  }
}