import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

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

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function isDayName(text: string): string | null {
  const lower = text.toLowerCase().trim().replace(/\s+/g, "");
  for (const day of DAYS) {
    if (lower === day || lower.startsWith(day)) {
      return day.charAt(0).toUpperCase() + day.slice(1);
    }
  }
  return null;
}

function isTimeSlot(text: string): boolean {
  return /\d{1,2}[:.]\d{2}\s*[-–]+\s*\d{1,2}[:.]\d{2}/i.test(text.replace(/\s/g, ""));
}

function isRoomName(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return (
      /lecture\s*room/i.test(lower) ||
      /computer\s*lab/i.test(lower) ||
      /auditorium/i.test(lower) ||
      /^lab/i.test(lower) ||
      /^room/i.test(lower) ||
      /main\s*auditorium/i.test(lower)
    );
  }

  function extractRoomShort(text: string): string {
    // "Lecture Room # 05" -> "Room # 05"
    const lectureRoom = text.match(/lecture\s*room\s*#?\s*(\d+)/i);
    if (lectureRoom) return `Room # ${lectureRoom[1]}`;
    // "Computer Lab # 10" -> "Lab-10"
    const compLab = text.match(/computer\s*lab\s*#?\s*(\d+)/i);
    if (compLab) return `Lab-${compLab[1]}`;
    // "Lab # 7" or "Lab-7"
    const lab = text.match(/lab\s*[-#]?\s*(\d+)/i);
    if (lab) return `Lab-${lab[1]}`;
    // "Room # 28"
    const room = text.match(/room\s*#?\s*(\d+)/i);
    if (room) return `Room # ${room[1]}`;
    // "Main Auditorium"
    if (/auditorium/i.test(text)) return "Auditorium";
    return text.trim();
  }

function isSkippable(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    lower.includes("used in") ||
    lower === "it department" ||
    lower === "jumma prayer" ||
    lower === "" ||
    lower === "rooms" ||
    /^(ground|1st|2nd|3rd|ist|!st)\s*floor$/i.test(lower)
  );
}

function splitTimeSlot(ts: string): { start: string; end: string } {
    const parts = ts.split(/[-–]+/);
    return {
      start: (parts[0] || "").trim(),
      end: (parts[1] || "").trim(),
    };
  }

  /** Convert time string like "8:00", "08:00", "10:45" to minutes since midnight for numeric sorting.
   *  Handles 12-hour format without AM/PM: hours 1-7 are treated as PM (13:00-19:00),
   *  hours 8-12 are treated as AM/noon (08:00-12:00). Typical university schedule range. */
  function timeToMinutes(t: string): number {
    const cleaned = t.replace(/\s/g, "").replace(/\./g, ":");
    const match = cleaned.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return 9999;
    let hours = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    // University times: 1-7 are PM (13:00-19:00), 8-12 stay as-is
    if (hours >= 1 && hours <= 7) {
      hours += 12;
    }
    return hours * 60 + mins;
  }

  /** Merge consecutive identical classes (same section, day, subject, teacher, room) into one with combined time */
  function mergeConsecutiveClasses(entries: LectureEntry[]): LectureEntry[] {
    if (entries.length === 0) return entries;

    const merged: LectureEntry[] = [];
    let current = { ...entries[0] };

    for (let i = 1; i < entries.length; i++) {
      const next = entries[i];
      // Check if same section, day, subject, teacher, room and times are consecutive
      if (
        current.section === next.section &&
        current.day === next.day &&
        current.subject === next.subject &&
        current.teacher === next.teacher &&
        current.room === next.room &&
        current.endTime === next.startTime
      ) {
        // Merge: extend current's end time
        current.endTime = next.endTime;
        current.time = `${current.startTime} - ${next.endTime}`;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
    return merged;
  }

// Section pattern: BS followed by 2-4 uppercase letters, dash, digit(s), optional letter
const SECTION_RE = /BS[A-Z]{2,4}-\d+[A-Z]?(?:Combined)?/gi;
// Combined section pattern: e.g. "BSDS-3A/BSAI-3A" or "BSSE-4A/BSCS-4A"
const COMBINED_SECTION_RE = /BS[A-Z]{2,4}-\d+[A-Z]?\s*\/\s*BS[A-Z]{2,4}-\d+[A-Z]?/gi;

function extractSections(cellText: string): string[] {
    // Find ALL individual section codes (BS...-\d+[A-Z]?) in the text
    // This automatically handles combined forms like "BSSE-4C/BSAI-7A"
    // by extracting each part separately: ["BSSE-4C", "BSAI-7A"]
    const matches = cellText.match(SECTION_RE);
    if (!matches) return [];
    return [...new Set(matches.map((s) => s.toUpperCase()))];
  }

function parseCell(cellText: string): {
  subject: string;
  teacher: string;
  sections: string[];
} {
  const sections = extractSections(cellText);
  const lines = cellText
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  let subject = "";
  let teacher = "";

  for (const line of lines) {
    // Skip section codes
    if (/^BS[A-Z]{2,4}-/i.test(line.trim())) continue;
    // Skip combined section lines like "BSAI-3A/BSDS-3A"
    if (/^BS[A-Z]{2,4}-\d+\w?\s*\/\s*BS/i.test(line.trim())) continue;
    // Skip time overrides like "(08:00 am - 09:40 am)"
    if (/^\(?\s*\d{1,2}[:.]\d{2}\s*(am|pm)/i.test(line.trim())) continue;

    // Teacher lines typically start with Mr./Ms./Dr. or contain them
    if (/^(Mr\.|Ms\.|Dr\.|Muhammad\s)/i.test(line.trim())) {
      if (!teacher) teacher = line.trim();
    } else {
      // First non-section, non-teacher, non-time line is the subject
      if (!subject) {
      // Remove any inline section codes (combined and individual)
          const cleaned = line.replace(COMBINED_SECTION_RE, "").replace(SECTION_RE, "").replace(/^\s*\/\s*|\s*\/\s*$/g, "").trim();
        if (cleaned.length > 1) subject = cleaned;
      }
    }
  }

  return {
    subject: subject || "Unknown Subject",
    teacher: teacher || "Unknown Teacher",
    sections,
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const sectionFilter = (formData.get("section") as string || "").trim().toUpperCase();

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });

    const allEntries: LectureEntry[] = [];
    const allSections = new Set<string>();

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet["!ref"]) continue;

      const range = XLSX.utils.decode_range(sheet["!ref"]);
      const merges = sheet["!merges"] || [];

      // Build merge map for fast lookups
      const mergeMap = new Map<string, { r: number; c: number }>();
      for (const merge of merges) {
        for (let r = merge.s.r; r <= merge.e.r; r++) {
          for (let c = merge.s.c; c <= merge.e.c; c++) {
            if (r !== merge.s.r || c !== merge.s.c) {
              mergeMap.set(`${r},${c}`, { r: merge.s.r, c: merge.s.c });
            }
          }
        }
      }

      function getCellValue(r: number, c: number): string {
        const mergeOrigin = mergeMap.get(`${r},${c}`);
        const targetR = mergeOrigin ? mergeOrigin.r : r;
        const targetC = mergeOrigin ? mergeOrigin.c : c;
        const addr = XLSX.utils.encode_cell({ r: targetR, c: targetC });
        const cell = sheet[addr];
        return cell ? String(cell.v ?? "").trim() : "";
      }

      // Scan the sheet to find day blocks and their time headers
      // Structure per day block:
      //   - Row with day name + time slots in cols D+ (or day separator)
      //   - Row with "Rooms" + time slots repeated  
      //   - Data rows: col B = room, col C = floor, col D+ = lecture cells
      
      let currentDay = "";
      let currentTimeSlots: { col: number; label: string }[] = [];

      for (let r = range.s.r; r <= range.e.r; r++) {
        // Check all first few columns for day names
        let dayFound: string | null = null;
        for (let c = 0; c <= 2; c++) {
          const val = getCellValue(r, c);
          if (val) {
            const day = isDayName(val);
            if (day) {
              dayFound = day;
              break;
            }
          }
        }

        if (dayFound) {
          currentDay = dayFound;
        }

        // Check if this row has time slots (it's a time header row)
        const rowTimes: { col: number; label: string }[] = [];
        for (let c = 2; c <= range.e.c; c++) {
          const val = getCellValue(r, c);
          if (val && isTimeSlot(val)) {
            // Normalize the time label
            const label = val.replace(/\s+/g, " ").trim();
            if (!rowTimes.find((t) => t.col === c)) {
              rowTimes.push({ col: c, label });
            }
          }
        }

        if (rowTimes.length >= 3) {
          // This is a time header row for the current day
          currentTimeSlots = rowTimes;
          continue;
        }

        // Skip if we don't have a day or time slots yet
        if (!currentDay || currentTimeSlots.length === 0) continue;

        // Check if col B (index 1) has a room name
        const colB = getCellValue(r, 1);
        if (!colB || !isRoomName(colB)) continue;

        const room = extractRoomShort(colB);

          // Parse lecture cells at each time slot column
        for (const ts of currentTimeSlots) {
          const cellVal = getCellValue(r, ts.col);
          if (!cellVal || isSkippable(cellVal)) continue;

          const { subject, teacher, sections } = parseCell(cellVal);
          if (sections.length === 0) continue;

          const { start, end } = splitTimeSlot(ts.label);
            for (const sec of sections) {
              allSections.add(sec);
              allEntries.push({
                day: currentDay,
                time: ts.label,
                startTime: start,
                endTime: end,
                subject,
                teacher,
                room,
                section: sec,
              });
            }
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    const deduped = allEntries.filter((e) => {
      const key = `${e.section}|${e.day}|${e.time}|${e.subject}|${e.teacher}|${e.room}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort
    const dayOrder: Record<string, number> = {
      Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6,
    };
      deduped.sort((a, b) => {
        const dA = dayOrder[a.day] ?? 99;
        const dB = dayOrder[b.day] ?? 99;
        if (dA !== dB) return dA - dB;
        return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
      });

    // Filter if section specified
    const entries = sectionFilter
      ? deduped.filter((e) => e.section === sectionFilter)
      : deduped;

    // Build per-section data
    const sectionsList = [...allSections].sort();
    const sectionsToShow = sectionFilter
      ? [sectionFilter]
      : sectionsList;

    const sectionData: Record<
      string,
      {
        entries: LectureEntry[];
        grid: Record<string, Record<string, { subject: string; teacher: string; room: string }>>;
        days: string[];
        times: string[];
      }
    > = {};

      for (const sec of sectionsToShow) {
        const secEntries = entries.filter((e) => e.section === sec);
        if (secEntries.length === 0) continue;

        // Merge consecutive identical classes
        const mergedEntries = mergeConsecutiveClasses(secEntries);

        const days = [...new Set(mergedEntries.map((e) => e.day))].sort(
          (a, b) => (dayOrder[a] ?? 99) - (dayOrder[b] ?? 99)
        );
        const times = [...new Set(mergedEntries.map((e) => e.time))].sort((a, b) => {
          const aStart = a.split(/[-–]/)[0]?.trim() || "";
          const bStart = b.split(/[-–]/)[0]?.trim() || "";
          return timeToMinutes(aStart) - timeToMinutes(bStart);
        });

        const grid: Record<string, Record<string, { subject: string; teacher: string; room: string }>> = {};
        for (const t of times) {
          grid[t] = {};
          for (const d of days) {
            const match = mergedEntries.find((e) => e.day === d && e.time === t);
            if (match) {
              grid[t][d] = {
                subject: match.subject,
                teacher: match.teacher,
                room: match.room,
              };
            }
          }
        }

        sectionData[sec] = { entries: mergedEntries, grid, days, times };
      }

    return NextResponse.json({
      section: sectionFilter || "ALL",
      sectionData,
      availableSections: sectionsList,
      totalEntries: entries.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
