```md
# Timetable Generator  

A web application that parses university department Excel timetables and generates clean, organized, section-wise schedules with PDF export.  

🚀 **Live Demo:**  
https://timetable-generator-chi.vercel.app/  

Built with **Next.js 15**, **React 19**, and **TypeScript**.  

---

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

---

## How It Works  

1. **Upload** — User uploads a department Excel timetable (`.xlsx` or `.xls`)  
2. **Parse** — The `/api/parse` endpoint reads the workbook using the `xlsx` library:  
   - Builds a merge map for handling merged cells  
   - Scans rows to identify day names, time header rows, and room rows  
   - Extracts lecture details (subject, teacher, section codes) from each cell  
   - Deduplicates and sorts entries by day and time  
3. **Display** — The frontend renders section-wise timetable grids, detail tables, or list views  
4. **Export** — Users can download PDFs (single section or all) generated client-side with `jspdf` + `jspdf-autotable`  

---

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

---

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

````

---

## Getting Started (Local Development)  

### Prerequisites  

- Node.js 18+ → https://nodejs.org/  
- Bun → https://bun.sh/  

### Install Dependencies  

```bash
bun install
````

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

---

## API Reference

### `POST /api/parse`

Parses an uploaded Excel timetable file.

**Request:** `multipart/form-data`

| Field     | Type   | Required | Description                                           |
| --------- | ------ | -------- | ----------------------------------------------------- |
| `file`    | File   | Yes      | Excel file (`.xlsx` or `.xls`)                        |
| `section` | String | No       | Filter results to a specific section (e.g. `BSSE-4C`) |

**Sample Response:**

```json
{
  "section": "BSSE-4C",
  "availableSections": ["BSAI-3A", "BSCS-2B", "BSSE-4C"],
  "totalEntries": 42
}
```

---

## Excel Format Requirements

The parser expects a typical university department timetable layout:

* Days in the first few columns
* Time slots in a header row
* Room names in column B
* Lecture cells containing subject, teacher, and section codes
* Merged cells are supported

---

## Author

**Muneeb u Rehman — Superior University**

* GitHub: [https://github.com/Muneeb-U-Rehman-Chaudary](https://github.com/Muneeb-U-Rehman-Chaudary)
* LinkedIn: [https://www.linkedin.com/in/muneeb-u-rehman-a0151a31a/](https://www.linkedin.com/in/muneeb-u-rehman-a0151a31a/)

---

## License

This project is open source.

---

### Reputable References Used for Formatting & Best Practices

* GitHub README Guide: [https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
* Next.js Documentation: [https://nextjs.org/docs](https://nextjs.org/docs)
* SheetJS (xlsx) Docs: [https://docs.sheetjs.com/](https://docs.sheetjs.com/)
* jsPDF Docs: [https://artskydj.github.io/jsPDF/docs/](https://artskydj.github.io/jsPDF/docs/)

```
```
