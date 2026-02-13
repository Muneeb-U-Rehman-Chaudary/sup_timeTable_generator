export const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

export function isDayName(text: string): string | null {
  const lower = text.toLowerCase().trim().replace(/\s+/g,"");
  for (const day of DAYS) if (lower===day || lower.startsWith(day)) return day.charAt(0).toUpperCase()+day.slice(1);
  return null;
}

export function isTimeSlot(text:string):boolean {
  return /\d{1,2}[:.]\d{2}\s*[-–]+\s*\d{1,2}[:.]\d{2}/i.test(text.replace(/\s/g,""));
}

export function isRoomName(text:string):boolean {
  const lower=text.toLowerCase().trim();
  return /lecture\s*room|computer\s*lab|auditorium|^lab|^room|main\s*auditorium/i.test(lower);
}

export function extractRoomShort(text:string):string {
  const lectureRoom = text.match(/lecture\s*room\s*#?\s*(\d+)/i);
  if(lectureRoom) return `Room # ${lectureRoom[1]}`;
  const compLab = text.match(/computer\s*lab\s*#?\s*(\d+)/i);
  if(compLab) return `Lab-${compLab[1]}`;
  const lab=text.match(/lab\s*[-#]?\s*(\d+)/i);
  if(lab) return `Lab-${lab[1]}`;
  const room=text.match(/room\s*#?\s*(\d+)/i);
  if(room) return `Room # ${room[1]}`;
  if(/auditorium/i.test(text)) return "Auditorium";
  return text.trim();
}

export function isSkippable(text:string):boolean{
  const lower=text.toLowerCase().trim();
  return lower.includes("used in") || lower==="it department" || lower==="jumma prayer" || lower==="" || lower==="rooms" || /^(ground|1st|2nd|3rd|ist|!st)\s*floor$/i.test(lower);
}

export function splitTimeSlot(ts:string){const parts=ts.split(/[-–]+/);return{start:(parts[0]||"").trim(),end:(parts[1]||"").trim()};}

export function timeToMinutes(t:string):number{
  const cleaned=t.replace(/\s/g,"").replace(/\./g,":");
  const match=cleaned.match(/^(\d{1,2}):(\d{2})$/);if(!match)return 9999;
  let hours=parseInt(match[1],10);const mins=parseInt(match[2],10);
  if(hours>=1&&hours<=7) hours+=12;
  return hours*60+mins;
}

export function mergeConsecutiveClasses(entries:unknown[]):unknown[]{
  if(entries.length===0) return entries;
  const merged:any[]=[];
  let current = typeof entries[0] === "object" && entries[0] !== null ? { ...entries[0] as object } : {};
  for(let i=1;i<entries.length;i++){
    const next = entries[i];
    if (
      typeof current === "object" && current !== null &&
      typeof next === "object" && next !== null &&
      (current as any).section === (next as any).section &&
      (current as any).day === (next as any).day &&
      (current as any).subject === (next as any).subject &&
      (current as any).teacher === (next as any).teacher &&
      (current as any).room === (next as any).room &&
      (current as any).endTime === (next as any).startTime
    ) {
      (current as any).endTime = (next as any).endTime;
      (current as any).time = `${(current as any).startTime} - ${(next as any).endTime}`;
    } else {
      merged.push(current);
      current = typeof next === "object" && next !== null ? { ...next as object } : {};
    }
  }
  merged.push(current); return merged;
}

const SECTION_RE=/BS[A-Z]{2,4}-\d+[A-Z]?(?:Combined)?/gi;
const COMBINED_SECTION_RE=/BS[A-Z]{2,4}-\d+[A-Z]?\s*\/\s*BS[A-Z]{2,4}-\d+[A-Z]?/gi;

export function extractSections(cellText:string):string[]{
  const matches=cellText.match(SECTION_RE);
  if(!matches) return [];
  return [...new Set(matches.map(s=>s.toUpperCase()))];
}

export function parseCell(cellText:string){
  const sections=extractSections(cellText);
  const lines=cellText.split(/[\r\n]+/).map(l=>l.trim()).filter(Boolean);
  let subject="",teacher="";
  for(const line of lines){
    if(/^BS[A-Z]{2,4}-/i.test(line.trim())) continue;
    if(/^BS[A-Z]{2,4}-\d+\w?\s*\/\s*BS/i.test(line.trim())) continue;
    if(/^\(?\s*\d{1,2}[:.]\d{2}\s*(am|pm)/i.test(line.trim())) continue;
    if(/^(Mr\.|Ms\.|Dr\.|Muhammad\s)/i.test(line.trim())) { if(!teacher) teacher=line.trim(); }
    else if(!subject){
      const cleaned=line.replace(COMBINED_SECTION_RE,"").replace(SECTION_RE,"").replace(/^\s*\/\s*|\s*\/\s*$/g,"").trim();
      if(cleaned.length>1) subject=cleaned;
    }
  }
  return { subject: subject||"Unknown Subject", teacher: teacher||"Unknown Teacher", sections };
}
