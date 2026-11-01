# Pepper

Notes and PDF reader for the iPad. Read a PDF or write on paper, lasso part of a page, send it to an AI with a ready prompt, paste the reply back, and the tables, flowcharts and flashcards appear beside that page.

## What works in version 0.1
- Library with notebooks, pinned, search, and a Study area (all extracts, tables, flowcharts, flashcards, scenarios and viva, exports)
- Import PDFs or make blank (ruled) notebooks; everything is stored on the device (IndexedDB)
- Tabs for several open books
- Pen, highlighter, stroke eraser, lasso, hand, undo and redo, colours and sizes. Apple Pencil draws and your finger scrolls (changeable in Settings)
- Lasso then **Send to AI**: cropped picture of your handwriting plus a prompt for table, flowchart, flashcards, image prompt, scenario or audio viva. Copy, share to another app, or open Claude, ChatGPT or Gemini
- Paste the reply back: tables, flowcharts and cards are drawn beside the page (**Show extracts**)
- Exports: Anki text file (Basic and Cloze), Markdown source file for NotebookLM or ChatGPT, full backup and restore

## Use it on the iPad
Open the site in Safari, then Share, **Add to Home Screen**. It works offline after the first load.

## Run locally
Serve the folder with any static server, for example `python3 -m http.server`, and open `http://localhost:8000`.

## Notes
- PDF rendering uses pdf.js (Apache 2.0), included in `vendor/`.
- Direct AI calls are not built yet. The app prepares the prompt and picture, you paste the reply.
