import axios from "axios";

export interface ParsedLecture {
  subject: string;
  teacher: string;
  sections: string[];
}

/**
 * Batch parse lecture cells using Hugging Face Instruct model
 * Collect all cells, send as one prompt, get structured JSON back.
 */
export async function parseLectureCellsAI(
  cells: string[]
): Promise<ParsedLecture[]> {
  if (!cells.length) return [];

  const prompt = `
You are a university timetable assistant. 
Given the following lecture cell texts, parse each one into JSON objects
with "subject", "teacher", and "sections" (list of section codes like BSSE-4C).
Output must be a JSON array with the same order as the input.

Input:
${JSON.stringify(cells)}

Output:
`;

  try {
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/tiiuae/falcon-7b-instruct",
      { inputs: prompt },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 60000, // 60s timeout
      }
    );

    const text = response.data?.generated_text || response.data?.[0]?.generated_text;
    if (!text) return cells.map(() => ({ subject: "Unknown", teacher: "Unknown", sections: [] }));

    // parse JSON output
    const parsed: ParsedLecture[] = JSON.parse(text);
    return parsed;

  } catch (err: unknown) {
    if (err && typeof err === "object" && "message" in err) {
      console.error("AI parse error:", (err as { message: string }).message);
    } else {
      console.error("AI parse error:", err);
    }
    // fallback
    return cells.map(() => ({ subject: "Unknown", teacher: "Unknown", sections: [] }));
  }
}
