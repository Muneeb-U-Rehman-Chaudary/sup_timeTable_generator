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
  startTime: string;     // 12h e.g. "10:45 AM"
  endTime: string;       // 12h e.g. "1:25 PM"
  subject: string;
  teacher: string;
  room: string;
  section: string;
  confidence: number;    // 0.0 to 1.0
}

interface TimeSlotInfo {
  col: number;
  raw: string;
  start12: string;
  end12: string;
}

interface ParseResult {
  entries: LectureEntry[];
  strategyName: string;
  avgConfidence: number;
}

// ────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_KEYWORDS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun", ...DAY_NAMES.map(d => d.toLowerCase())];

const DAY_ORDER: Record<string, number> = {
  Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6
};

const TIME_PATTERNS = [
  /(\d{1,2})[:.](\d{2})\s*[-–—]+\s*(\d{1,2})[:.](\d{2})/,
  /(\d{1,2})[:.](\d{2})\s*(am|pm|AM|PM)?\s*[-–—]+\s*(\d{1,2})[:.](\d{2})\s*(am|pm|AM|PM)?/,
  /(\d{2})(\d{2})\s*[-–—]+\s*(\d{2})(\d{2})/,
  /(\d{1,2})\s*[-–—]+\s*(\d{1,2})[:.](\d{2})/,
];

const SECTION_PATTERN = /\b(BS[A-Z]{2,4}-\d{1,2}[A-Za-z]?)(?:Combined)?\b/gi;
const COMBINED_SECTION_PATTERN = /BS[A-Z]{2,4}-\d+[A-Z]?\s*\/\s*BS[A-Z]{2,4}-\d+[A-Z]?/gi;

// ────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────

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

      return {
        start12: to12Hour(`${h1.toString().padStart(2,"0")}:${m1.toString().padStart(2,"0")}`),
        end12: to12Hour(`${h2.toString().padStart(2,"0")}:${m2.toString().padStart(2,"0")}`)
      };
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

function isSkippable(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    !lower ||
    lower.includes("used in") ||
    /^it\s*department$/i.test(lower) ||
    /^jumma\s*prayer$/i.test(lower) ||
    /^rooms?$/i.test(lower) ||
    /^(ground|1st|2nd|3rd|ist|!st)\s*floor$/i.test(lower) ||
    /^department/i.test(lower) ||
    /^semester/i.test(lower) ||
    /^time\s*table/i.test(lower) ||
    /^timetable/i.test(lower) ||
    /^schedule/i.test(lower) ||
    /^updated/i.test(lower) ||
    /^effective/i.test(lower) ||
    /^note:/i.test(lower) ||
    /^page\s*\d/i.test(lower) ||
    /^s\.?\s*no\.?$/i.test(lower) ||
    /^sr\.?\s*#?$/i.test(lower) ||
    /^total/i.test(lower) ||
    lower.includes("break") ||
    lower.includes("lunch") ||
    lower.includes("recess") ||
    lower.includes("prayer") ||
    lower.includes("free") ||
    lower.includes("off") ||
    /^-$/.test(lower)
  );
}

// ────────────────────────────────────────────────
 // PARSE CELL
// ────────────────────────────────────────────────

function parseCell(
  cellText: string,
  getCellValue: (r: number, c: number) => string,
  row: number,
  col: number
): { subject: string; teacher: string; sections: string[]; confidence: number } {
  const sections = extractAllSections(cellText);
  const lines = cellText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

  let subject = "";
  let teacher = "";
  let confidence = 1.0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (isSkippable(trimmed)) continue;
    if (SECTION_PATTERN.test(trimmed)) continue;
    if (COMBINED_SECTION_PATTERN.test(trimmed)) continue;
    if (isLikelyTimeSlot(trimmed)) continue;

    if (/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Prof\.?|Engr\.?|Sir|Madam)/i.test(trimmed)) {
      if (!teacher) teacher = trimmed;
    } else if (!subject) {
      const cleaned = trimmed
        .replace(COMBINED_SECTION_PATTERN, "")
        .replace(SECTION_PATTERN, "")
        .replace(/^\s*\/\s*|\s*\/\s*$/g, "")
        .trim();
      if (cleaned.length > 1) subject = cleaned;
    }
  }

  if (!subject) {
    const left = getCellValue(row, col - 1);
    const above = getCellValue(row - 1, col);
    if (left && !isLikelyRoom(left) && !isLikelyTimeSlot(left) && !isSkippable(left)) {
      subject = left.trim();
      confidence -= 0.25;
    } else if (above && !isLikelyRoom(above) && !isLikelyTimeSlot(above) && !isSkippable(above)) {
      subject = above.trim();
      confidence -= 0.25;
    } else {
      subject = "Unknown Subject";
      confidence -= 0.5;
    }
  }

  if (!teacher) {
    const right = getCellValue(row, col + 1);
    const below = getCellValue(row + 1, col);
    if (right && /^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Prof\.?|Engr\.?|Sir|Madam)/i.test(right)) {
      teacher = right.trim();
      confidence -= 0.2;
    } else if (below && /^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Prof\.?|Engr\.?|Sir|Madam)/i.test(below)) {
      teacher = below.trim();
      confidence -= 0.2;
    } else {
      teacher = "Unknown Teacher";
      confidence -= 0.5;
    }
  }

  return { subject, teacher, sections, confidence };
}

// ────────────────────────────────────────────────
 // MERGE CONSECUTIVE CLASSES
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
      current.confidence = Math.min(current.confidence, next.confidence);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
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

  const modelsToTry = [     
    "meta-llama/Llama-3.3-70B-Instruct",           
  ];

  for (const model of modelsToTry) {
    try {
      console.log(`[AI Diagnostic] Trying model: ${model}`);

      const res = await fetch(HF_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 280,
          temperature: 0.25,
          top_p: 0.9,
        }),
      });

      console.log(`[AI Diagnostic] Response status for ${model}:`, res.status);

      if (!res.ok) {
        const errorText = await res.text().catch(() => "(could not read error body)");
        console.log(`[AI Diagnostic] Failed for ${model}: ${res.status} - ${errorText}`);
        continue; // try next model
      }

      const json = await res.json();
      const answer = json?.choices?.[0]?.message?.content?.trim() || null;

      if (answer) {
        console.log(`[AI Diagnostic] Success with ${model} – generated text length:`, answer.length);
        return answer;
      } else {
        console.log(`[AI Diagnostic] No content returned from ${model}`);
      }
    } catch (err) {
      console.error(`[AI Diagnostic] Network/parsing error with ${model}:`, err);
      // continue to next model
    }
  }

  console.warn("[AI Diagnostic] All model attempts failed – returning null");
  return null;
}

// ────────────────────────────────────────────────
 // LAYOUT STRATEGIES
// ────────────────────────────────────────────────

function parseRoomRowLayout(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  getCellValue: (r: number, c: number) => string
): ParseResult {
  const entries: LectureEntry[] = [];
  let totalConf = 0;
  let count = 0;

  let currentDay = "";
  let currentTimeSlots: TimeSlotInfo[] = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    let dayFound: string | null = null;
    for (let c = 0; c <= Math.min(3, range.e.c); c++) {
      const val = getCellValue(r, c);
      if (val) {
        const day = normalizeDayName(val);
        if (day) {
          dayFound = day;
          break;
        }
      }
    }
    if (dayFound) currentDay = dayFound;

    const rowTimes: TimeSlotInfo[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const val = getCellValue(r, c);
      if (val && isLikelyTimeSlot(val)) {
        const norm = normalizeTimeSlot(val);
        if (norm) rowTimes.push({ col: c, raw: val, start12: norm.start12, end12: norm.end12 });
      }
    }

    if (rowTimes.length >= 2) {
      currentTimeSlots = rowTimes;
      continue;
    }

    if (!currentDay || currentTimeSlots.length === 0) continue;

    let room = "";
    for (let c = 0; c <= Math.min(3, range.e.c); c++) {
      const val = getCellValue(r, c);
      if (val && isLikelyRoom(val)) {
        room = normalizeRoomName(val);
        break;
      }
    }
    if (!room) continue;

    for (const ts of currentTimeSlots) {
      const cellVal = getCellValue(r, ts.col);
      if (!cellVal || isSkippable(cellVal)) continue;

      const { subject, teacher, sections, confidence } = parseCell(cellVal, getCellValue, r, ts.col);
      if (sections.length === 0) continue;

      for (const sec of sections) {
        entries.push({
          day: currentDay,
          time: `${ts.start12} – ${ts.end12}`,
          startTime: ts.start12,
          endTime: ts.end12,
          subject,
          teacher,
          room,
          section: sec,
          confidence
        });
        totalConf += confidence;
        count++;
      }
    }
  }

  return {
    entries,
    strategyName: "room-row",
    avgConfidence: count > 0 ? totalConf / count : 0
  };
}

function parseColumnBasedDays(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  getCellValue: (r: number, c: number) => string
): ParseResult {
  const entries: LectureEntry[] = [];
  let totalConf = 0;
  let count = 0;

  let headerRow = -1;
  let headerColumns: Record<string, number> = {};

  for (let r = range.s.r; r <= Math.min(range.s.r + 15, range.e.r); r++) {
    let found = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const val = getCellValue(r, c).toLowerCase().trim();
      if (val.includes("section")) headerColumns.section = c;
      if (val.includes("course") || val.includes("subject")) headerColumns.subject = c;
      if (val.includes("teacher")) headerColumns.teacher = c;
      if (val.includes("day")) headerColumns.day = c;
      if (val.includes("time") || val.includes("slot")) headerColumns.time = c;
      if (val.includes("floor")) headerColumns.floor = c;
      if (val.includes("room")) headerColumns.room = c;
      if (Object.keys(headerColumns).length >= 4) {
        headerRow = r;
        found = 1;
        break;
      }
    }
    if (found) break;
  }

  if (headerRow === -1) return { entries: [], strategyName: "column-based", avgConfidence: 0 };

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const section = getCellValue(r, headerColumns.section || 0);
    const subject = getCellValue(r, headerColumns.subject || 0);
    const teacher = getCellValue(r, headerColumns.teacher || 0);
    const day = normalizeDayName(getCellValue(r, headerColumns.day || 0));
    const timeVal = getCellValue(r, headerColumns.time || 0);
    const floor = getCellValue(r, headerColumns.floor || 0);
    const roomNo = getCellValue(r, headerColumns.room || 0);

    if (!section || !subject || !teacher || !day || !timeVal) continue;

    const norm = normalizeTimeSlot(timeVal);
    if (!norm) continue;

    let room = `${floor ? floor + ' ' : ''}${roomNo ? 'Room ' + roomNo : 'Unknown Room'}`;
    let confidence = 1.0;
    if (!roomNo) confidence -= 0.3;

    entries.push({
      day,
      time: `${norm.start12} – ${norm.end12}`,
      startTime: norm.start12,
      endTime: norm.end12,
      subject,
      teacher,
      room,
      section,
      confidence
    });
    totalConf += confidence;
    count++;
  }

  return {
    entries,
    strategyName: "column-based",
    avgConfidence: count > 0 ? totalConf / count : 0
  };
}

function parsePerSheetSections(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  getCellValue: (r: number, c: number) => string,
  sheetName: string
): ParseResult {
  const entries: LectureEntry[] = [];
  let totalConf = 0;
  let count = 0;

  const sheetSections = extractAllSections(sheetName);
  if (sheetSections.length === 0) return { entries: [], strategyName: "per-sheet", avgConfidence: 0 };

  let headerRow = -1;
  let dayColumns: { col: number; day: string }[] = [];

  for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
    const cols: { col: number; day: string }[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const val = getCellValue(r, c);
      if (val) {
        const day = normalizeDayName(val);
        if (day) cols.push({ col: c, day });
      }
    }
    if (cols.length >= 3) {
      headerRow = r;
      dayColumns = cols;
      break;
    }
  }

  if (headerRow === -1 || dayColumns.length < 3) return { entries: [], strategyName: "per-sheet", avgConfidence: 0 };

  let timeCol = -1;
  for (let c = range.s.c; c < (dayColumns[0]?.col ?? range.e.c); c++) {
    let timeCount = 0;
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const val = getCellValue(r, c);
      if (val && isLikelyTimeSlot(val)) timeCount++;
    }
    if (timeCount >= 2) {
      timeCol = c;
      break;
    }
  }

  if (timeCol === -1) return { entries: [], strategyName: "per-sheet", avgConfidence: 0 };

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const timeVal = getCellValue(r, timeCol);
    if (!timeVal || !isLikelyTimeSlot(timeVal)) continue;

    const norm = normalizeTimeSlot(timeVal);
    if (!norm) continue;

    for (const dc of dayColumns) {
      const cellVal = getCellValue(r, dc.col);
      if (!cellVal || isSkippable(cellVal)) continue;

      const { subject, teacher, sections: cellSections, confidence } = parseCell(cellVal, getCellValue, r, dc.col);
      const finalSections = cellSections.length > 0 ? cellSections : sheetSections;
      if (finalSections.length === 0) continue;

      const room = normalizeRoomName(cellVal) || "Unknown Room";
      let roomConfidence = room !== "Unknown Room" ? 1.0 : 0.5;

      for (const sec of finalSections) {
        entries.push({
          day: dc.day,
          time: `${norm.start12} – ${norm.end12}`,
          startTime: norm.start12,
          endTime: norm.end12,
          subject,
          teacher,
          room,
          section: sec,
          confidence: confidence * roomConfidence
        });
        totalConf += confidence * roomConfidence;
        count++;
      }
    }
  }

  return {
    entries,
    strategyName: "per-sheet",
    avgConfidence: count > 0 ? totalConf / count : 0
  };
}

function parseBruteForce(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  getCellValue: (r: number, c: number) => string
): ParseResult {
  const entries: LectureEntry[] = [];
  let totalConf = 0;
  let count = 0;

  const dayCells: { r: number; c: number; day: string }[] = [];
  const timeCells: { r: number; c: number; start12: string; end12: string }[] = [];
  const roomCells: { r: number; c: number; room: string }[] = [];
  const dataCells: { r: number; c: number; text: string }[] = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const val = getCellValue(r, c);
      if (!val || isSkippable(val)) continue;

      const day = normalizeDayName(val);
      if (day) {
        dayCells.push({ r, c, day });
        continue;
      }

      if (isLikelyTimeSlot(val)) {
        const norm = normalizeTimeSlot(val);
        if (norm) timeCells.push({ r, c, start12: norm.start12, end12: norm.end12 });
        continue;
      }

      if (isLikelyRoom(val)) {
        roomCells.push({ r, c, room: normalizeRoomName(val) });
        continue;
      }

      const sections = extractAllSections(val);
      if (sections.length > 0) {
        dataCells.push({ r, c, text: val });
      }
    }
  }

  for (const dc of dataCells) {
    const { subject, teacher, sections, confidence: cellConfidence } = parseCell(dc.text, getCellValue, dc.r, dc.c);
    if (sections.length === 0) continue;

    let bestDay = "";
    let bestDayDist = Infinity;
    for (const d of dayCells) {
      const dist = Math.abs(d.r - dc.r) * 10 + Math.abs(d.c - dc.c);
      if (d.r <= dc.r && dist < bestDayDist) {
        bestDay = d.day;
        bestDayDist = dist;
      }
    }

    let bestStart12 = "";
    let bestEnd12 = "";
    let bestTimeDist = Infinity;
    for (const t of timeCells) {
      const dist = Math.abs(t.r - dc.r) * 5 + Math.abs(t.c - dc.c);
      if (dist < bestTimeDist) {
        bestStart12 = t.start12;
        bestEnd12 = t.end12;
        bestTimeDist = dist;
      }
    }

    let bestRoom = "";
    let roomConfidence = 1.0;
    let bestRoomDist = Infinity;
    for (const rm of roomCells) {
      const dist = Math.abs(rm.r - dc.r) * 10 + Math.abs(rm.c - dc.c);
      if (dist < bestRoomDist) {
        bestRoom = rm.room;
        bestRoomDist = dist;
      }
    }
    if (!bestRoom) roomConfidence -= 0.5;

    if (!bestDay || !bestStart12) continue;

    for (const sec of sections) {
      const confidence = cellConfidence * roomConfidence;
      entries.push({
        day: bestDay,
        time: `${bestStart12} – ${bestEnd12}`,
        startTime: bestStart12,
        endTime: bestEnd12,
        subject,
        teacher,
        room: bestRoom || "Unknown Room",
        section: sec,
        confidence
      });
      totalConf += confidence;
      count++;
    }
  }

  return {
    entries,
    strategyName: "brute-force",
    avgConfidence: count > 0 ? totalConf / count : 0
  };
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

    const allStrategyResults: ParseResult[] = [];
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

      allStrategyResults.push(parseRoomRowLayout(sheet, range, getMergedCellValue));
      allStrategyResults.push(parseColumnBasedDays(sheet, range, getMergedCellValue));
      allStrategyResults.push(parsePerSheetSections(sheet, range, getMergedCellValue, sheetName));
      allStrategyResults.push(parseBruteForce(sheet, range, getMergedCellValue));
    }

    let bestResult: ParseResult = { entries: [], strategyName: "none", avgConfidence: 0 };
    for (const result of allStrategyResults) {
      if (result.entries.length > bestResult.entries.length ||
          (result.entries.length === bestResult.entries.length && result.avgConfidence > bestResult.avgConfidence)) {
        bestResult = result;
      }
    }

    console.log(`[Parsing] Best strategy: ${bestResult.strategyName} | Entries: ${bestResult.entries.length} | Avg Confidence: ${(bestResult.avgConfidence * 100).toFixed(1)}%`);

    const entries = bestResult.entries;

    const seen = new Set<string>();
    const unique = entries.filter(e => {
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

    const allSections = new Set<string>(unique.map(e => e.section));
    const sectionsList = [...allSections].sort();
    const sectionsToShow = sectionFilter ? [sectionFilter] : sectionsList;

    const sectionData: Record<string, any> = {};

    for (const sec of sectionsToShow) {
      let secEntries = filtered.filter(e => e.section === sec);
      if (secEntries.length === 0) continue;

      secEntries = mergeConsecutiveClasses(secEntries);

      const days = [...new Set(secEntries.map(e => e.day))].sort((a,b) => DAY_ORDER[a] - DAY_ORDER[b]);
      const times = [...new Set(secEntries.map(e => e.time))].sort((a,b) => {
        const ta = a.split(" – ")[0].trim();
        const tb = b.split(" – ")[0].trim();
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
              room: match.room,
              confidence: match.confidence
            };
          }
        }
      }

      sectionData[sec] = { entries: secEntries, grid, days, times };
    }

    const aiAnalysis = await getAiDiagnostic(sampleCells, filtered.length, sectionsList);

    return NextResponse.json({
      success: true,
      section: sectionFilter || "ALL",
      sectionData,
      availableSections: sectionsList,
      totalEntries: filtered.length,
      bestStrategy: bestResult.strategyName,
      avgConfidence: (bestResult.avgConfidence * 100).toFixed(1) + "%",
      aiAnalysis,
    });
  } catch (err: any) {
    console.error("[Timetable Parser] Error:", err);
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}