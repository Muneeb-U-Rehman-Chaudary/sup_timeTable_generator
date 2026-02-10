# Timetable Generator

A web application that parses university department Excel timetables and generates clean, organized, section-wise schedules with PDF export.

Built with **Next.js 15**, **React 19**, and **TypeScript**.

## Features

- **Excel Parsing** — Upload `.xlsx` / `.xls` department timetable files and get structured data instantly
- **Multi-Section Support** — Automatically detects all sections (e.g. BSCS-3A, BSSE-4C, BSAI-2B) from the spreadsheet
- **Grid View** — Weekly timetable grid showing time slots vs. days
- **Detail View** — Tabular view with Sr No., Day, Start/End Time, Location, Subject, Teacher
- **List View** — Compact list of all lectures
- **Section Search** — Quickly filter and switch between sections
- **PDF Export** — Download individual section timetables or all sections as a single PDF
- **Drag & Drop Upload** — Drop your Excel file directly onto the page
- **Local Storage Persistence** — Parsed data is cached so you don't have to re-upload
- **Responsive Design** — Works on desktop and mobile

## How It Works

1. **Upload** — User uploads a department Excel timetable (`.xlsx` or `.xls`)
2. **Parse** — The `/api/parse` endpoint reads the workbook using the `xlsx` library:
   - Builds a merge map for handling merged cells
   - Scans rows to identify day names, time header rows, and room rows
   - Extracts lecture details (subject, teacher, section codes) from each cell
   - Deduplicates and sorts entries by day and time
3. **Display** — The frontend renders section-wise timetable grids, detail tables, or list views
4. **Export** — Users can download PDFs (single section or all) generated client-side with `jspdf` + `jspdf-autotable`

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Framework  | Next.js 15 (App Router, Turbopack) |
| Language   | TypeScript                          |
| Runtime    | React 19                            |
| Styling    | Tailwind CSS 4 + inline styles      |
| Excel      | SheetJS (`xlsx`)                    |
| PDF        | jsPDF + jspdf-autotable             |
| Package Mgr| Bun                                 |

## Project Structure

```
src/
├── app/
│   ├── page.tsx           # Main UI — landing page + results view
│   ├── layout.tsx         # Root layout with Geist font
│   ├── globals.css        # Global styles, animations, responsive rules
│   └── api/
│       └── parse/
│           └── route.ts   # POST endpoint — Excel parsing logic
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ or [Bun](https://bun.sh/)

### Install Dependencies

```bash
bun install
```

### Run Development Server

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
bun run build
bun run start
```

## API Reference

### `POST /api/parse`

Parses an uploaded Excel timetable file.

**Request:** `multipart/form-data`

| Field    | Type   | Required | Description                                      |
|----------|--------|----------|--------------------------------------------------|
| `file`   | File   | Yes      | Excel file (`.xlsx` or `.xls`)                   |
| `section`| String | No       | Filter results to a specific section (e.g. `BSSE-4C`) |

**Response:** `application/json`

```json
{
  "section": "BSSE-4C",
  "sectionData": {
    "BSSE-4C": {
      "entries": [
        {
          "day": "Monday",
          "time": "08:00 - 09:30",
          "startTime": "08:00",
          "endTime": "09:30",
          "subject": "Data Structures",
          "teacher": "Mr. Ahmed Khan",
          "room": "Room # 05",
          "section": "BSSE-4C"
        }
      ],
      "grid": { "08:00 - 09:30": { "Monday": { "subject": "...", "teacher": "...", "room": "..." } } },
      "days": ["Monday", "Tuesday", "Wednesday"],
      "times": ["08:00 - 09:30", "09:30 - 11:00"]
    }
  },
  "availableSections": ["BSAI-3A", "BSCS-2B", "BSSE-4C"],
  "totalEntries": 42
}
```

## Excel Format Requirements

The parser expects a typical university department timetable layout:

- **Days** in the first few columns (Monday, Tuesday, etc.)
- **Time slots** in a header row (e.g. `08:00-09:30`, `09:30-11:00`)
- **Room names** in column B (e.g. "Lecture Room # 05", "Computer Lab # 10")
- **Lecture cells** containing subject name, teacher name, and section code(s) on separate lines
- Merged cells are supported and resolved automatically

## Author

**Muneeb u Rehman** — Superior University

- [GitHub](https://github.com/muneeb-u-rehman)
- [LinkedIn](https://www.linkedin.com/in/muneeb-u-rehman-a0151a31a)

## License

This project is open source.
