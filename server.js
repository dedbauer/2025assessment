import express from "express";
import fs from "fs";
import pdf from "pdf-parse";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

const pdfPath = "./Cambria 2025 Final Roll by SBL.pdf";
const outputPath = "cambria_2025_roll.json";

// -------------------- Ensure PDF exists --------------------
async function ensurePDF() {
  if (!fs.existsSync(pdfPath)) {
    console.log("Downloading PDF...");
    const url = "https://media.cmsmax.com/lv20xzze8ydi4trylfuou/Cambria%202025%20Final%20Roll%20by%20SBL.pdf";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to download PDF");
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(pdfPath, Buffer.from(buffer));
    console.log("PDF downloaded.");
  }
}

// -------------------- Parser --------------------
function parsePropertyBlock(blockText, taxLine, debug = false) {
  const prop = { tax_id: taxLine };

  // Normalize spacing for inline parsing
  const cleanText = blockText.replace(/\s+/g, " ");

  function extractValue(label) {
    // Try inline (same line)
    const regexInline = new RegExp(label + "[^\\d]*([\\d,]+)", "i");
    const matchInline = cleanText.match(regexInline);
    if (matchInline) return matchInline[1].replace(/,/g, "");

    // Fallback: next line
    const lines = blockText.split("\n").map(l => l.trim()).filter(Boolean);
    const idx = lines.findIndex(l => l.toUpperCase().includes(label));

    if (idx >= 0 && idx + 1 < lines.length) {
      const matchNext = lines[idx + 1].match(/([\d,]+)/);
      if (matchNext) return matchNext[1].replace(/,/g, "");
    }

    if (debug) console.log(`DEBUG: Missing ${label} for ${taxLine}`);
    return undefined;
  }

  prop.full_market_value = extractValue("FULL MARKET VALUE");
  prop.county_taxable = extractValue("COUNTY TAXABLE VALUE");
  prop.school_taxable = extractValue("SCHOOL TAXABLE VALUE");

  // LAND VALUE (6 lines below ASSESSMENT)
  const lines = blockText.split("\n").map(l => l.trim()).filter(Boolean);
  const assessmentIndex = lines.findIndex(l =>
    l.toUpperCase().includes("ASSESSMENT")
  );

  if (assessmentIndex >= 0 && assessmentIndex + 3 < lines.length) {
    const targetLine = lines[assessmentIndex + 3];
    const numbers = targetLine.match(/([\d,]+)/g);

    if (numbers && numbers.length >= 2) {
      prop.land_assessed_value = numbers[1].replace(/,/g, "");
    } else if (debug) {
      console.log(`DEBUG LAND FAIL ${taxLine}: ${targetLine}`);
    }
  } else if (debug) {
    console.log(`DEBUG: No ASSESSMENT block for ${taxLine}`);
  }

  return prop;
}

// -------------------- Extraction --------------------
async function extractFullPDF(res = null, maxEntries = null, debug = false) {
  await ensurePDF();

  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const fullText = data.text;

  const parts = fullText
    .split(/[\*]{5,}/)
    .map(p => p.trim())
    .filter(Boolean);

  const taxMap = new Map();

  for (let block of parts) {
    if (maxEntries && taxMap.size >= maxEntries) break;

    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);

    // Find tax_id anywhere in block
    let taxLine = lines.find(l =>
      /^\d{1,2}\.\d{2}-\d-\d{1,2}/.test(l)
    );

    if (!taxLine) {
      if (debug && res) {
        res.write("DEBUG: No tax_id found\n");
        res.write(block + "\n\n");
      }
      continue;
    }

    // Clean tax_id
    const match = taxLine.match(/^\d{1,2}\.\d{2}-\d-\d{1,2}(\.\d+)?/);
    if (match) taxLine = match[0];

    // 🚫 Skip junk blocks
    if (lines.length < 3) {
      if (debug && res) res.write(`SKIPPED (too small): ${taxLine}\n`);
      continue;
    }

    if (taxMap.has(taxLine) && lines.length < 5) {
      if (debug && res) res.write(`SKIPPED duplicate junk: ${taxLine}\n`);
      continue;
    }

    // Debug full block
    if (debug && res) {
      res.write(`\n----- FULL BLOCK FOR ${taxLine} -----\n`);
      res.write(block + "\n");
      res.write(`----- END BLOCK FOR ${taxLine} -----\n\n`);
    }

    const propData = parsePropertyBlock(block, taxLine, debug);

    if (taxMap.has(taxLine)) {
      taxMap.set(taxLine, { ...taxMap.get(taxLine), ...propData });
    } else {
      taxMap.set(taxLine, propData);
    }

    if (debug && res) {
      res.write(`Processed parcel: ${taxLine}\n`);
    }
  }

  const result = Array.from(taxMap.values());
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  return result;
}

// -------------------- Routes --------------------

// Extract + Download OR Debug
app.get("/extract-download", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : null;
  const debug = req.query.debug === "true";

  try {
    if (debug) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      await extractFullPDF(res, limit, true);
      res.write("\nDONE\n");
      res.end();
    } else {
      const data = await extractFullPDF(null, limit, false);

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=cambria_2025_roll.json"
      );

      res.end(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Get single parcel
app.get("/parcel/:tax_id", (req, res) => {
  if (!fs.existsSync(outputPath)) {
    return res.status(404).json({ error: "Run extraction first" });
  }

  const data = JSON.parse(fs.readFileSync(outputPath));
  const parcel = data.find(p => p.tax_id === req.params.tax_id);

  if (!parcel) return res.status(404).json({ error: "Not found" });

  res.json(parcel);
});

// Download existing JSON
app.get("/parcels/download", (req, res) => {
  if (!fs.existsSync(outputPath)) {
    return res.status(404).send("Run extraction first");
  }

  res.download(outputPath);
});

// -------------------- Start Server --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});