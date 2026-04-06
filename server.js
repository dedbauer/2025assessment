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

  // FULL MARKET VALUE
  const fullMatch = blockText.match(/FULL\s*MARKET\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (fullMatch) {
    prop.full_market_value = fullMatch[1].replace(/,/g, "");
  } else if (debug) {
    console.log(`DEBUG: Missing FULL MARKET VALUE for ${taxLine}`);
  }

  // COUNTY TAXABLE
  const countyMatch = blockText.match(/COUNTY\s*TAXABLE\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (countyMatch) {
    prop.county_taxable = countyMatch[1].replace(/,/g, "");
  } else if (debug) {
    console.log(`DEBUG: Missing COUNTY TAXABLE for ${taxLine}`);
  }

  // SCHOOL TAXABLE
  const schoolMatch = blockText.match(/SCHOOL\s*TAXABLE\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (schoolMatch) {
    prop.school_taxable = schoolMatch[1].replace(/,/g, "");
  } else if (debug) {
    console.log(`DEBUG: Missing SCHOOL TAXABLE for ${taxLine}`);
  }

  // LAND VALUE (critical logic)
  const lines = blockText.split("\n").map(l => l.trim()).filter(Boolean);

  let assessmentIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toUpperCase().includes("ASSESSMENT")) {
      assessmentIndex = i;
      break;
    }
  }

  if (assessmentIndex >= 0 && assessmentIndex + 6 < lines.length) {
    const targetLine = lines[assessmentIndex + 6];
    const numbers = targetLine.match(/\$?([\d,]+)/g);

    if (numbers && numbers.length >= 2) {
      prop.land_assessed_value = numbers[1].replace(/,/g, "");
    } else if (debug) {
      console.log(`DEBUG: Land parse failed for ${taxLine}`);
      console.log(`Line: ${targetLine}`);
    }
  } else if (debug) {
    console.log(`DEBUG: Assessment block not found for ${taxLine}`);
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

    // ✅ FIXED TAX ID EXTRACTION
    const taxLine = lines.find(l =>
      /^\d{1,2}\.\d{2}-\d-\d{1,2}/.test(l)
    );

    if (!taxLine) {
      if (debug && res) {
        res.write(`DEBUG: No tax_id found in block\n`);
      }
      continue;
    }

    const propData = parsePropertyBlock(block, taxLine, debug);

    if (taxMap.has(taxLine)) {
      taxMap.set(taxLine, { ...taxMap.get(taxLine), ...propData });
    } else {
      taxMap.set(taxLine, propData);
    }

    if (debug && res) {
      res.write(`Processed: ${taxLine}\n`);
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
      res.setHeader("Content-Disposition", "attachment; filename=cambria_2025_roll.json");

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