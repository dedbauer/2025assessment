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
    console.log("PDF not found locally. Downloading...");
    const url = "https://media.cmsmax.com/lv20xzze8ydi4trylfuou/Cambria%202025%20Final%20Roll%20by%20SBL.pdf";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to download PDF");
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(pdfPath, Buffer.from(buffer));
    console.log("PDF downloaded successfully.");
  } else {
    console.log("PDF already exists.");
  }
}

// -------------------- Parser --------------------
function parsePropertyBlock(blockText, taxLine, debug = false) {
  const prop = {};
  prop.tax_id = taxLine || "";

  // Full Market Value
  const fullMatch = blockText.match(/FULL\s*MARKET\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (fullMatch) prop.full_market_value = fullMatch[1].replace(/,/g, "");
  else if (debug) console.log(`DEBUG: FULL MARKET VALUE not found for ${taxLine}`);

  // County Taxable Value
  const countyMatch = blockText.match(/COUNTY\s*TAXABLE\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (countyMatch) prop.county_taxable = countyMatch[1].replace(/,/g, "");
  else if (debug) console.log(`DEBUG: COUNTY TAXABLE VALUE not found for ${taxLine}`);

  // School Taxable Value
  const schoolMatch = blockText.match(/SCHOOL\s*TAXABLE\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (schoolMatch) prop.school_taxable = schoolMatch[1].replace(/,/g, "");
  else if (debug) console.log(`DEBUG: SCHOOL TAXABLE VALUE not found for ${taxLine}`);

  // Land Assessed Value = second number 6 lines below "ASSESSMENT"
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
      console.log(`DEBUG: Could not parse Land Assessed Value line for ${taxLine}: "${targetLine}"`);
    }
  } else if (debug) {
    console.log(`DEBUG: Assessment line not found or too short for ${taxLine}`);
  }

  if (debug) console.log(`DEBUG: Parsed property ${taxLine}`, prop);
  return prop;
}

// -------------------- Extraction --------------------
async function extractFullPDF(res = null, maxEntries = null, debug = false) {
  await ensurePDF();
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const fullText = data.text;

  const parts = fullText.split(/[\*]{5,}/).map(p => p.trim()).filter(Boolean);
  const taxMap = new Map();

  for (let block of parts) {
    if (maxEntries && taxMap.size >= maxEntries) break;

    const taxLineMatch = block.match(/\d{1,2}\.\d{2}-\d-\d{1,2}\.?\d*/);
    const taxLine = taxLineMatch ? taxLineMatch[0] : null;

    if (taxLine) {
      const propData = parsePropertyBlock(block, taxLine, debug);
      if (taxMap.has(taxLine)) {
        taxMap.set(taxLine, { ...taxMap.get(taxLine), ...propData });
      } else {
        taxMap.set(taxLine, propData);
      }
      if (res) res.write(`Processed parcel: Tax ID ${taxLine}\n`);
    } else if (debug && res) {
      res.write(`DEBUG: No Tax ID found in block:\n${block.slice(0, 200)}...\n`);
    }
  }

  const extractedArray = Array.from(taxMap.values());
  fs.writeFileSync(outputPath, JSON.stringify(extractedArray, null, 2));
  return extractedArray;
}

// -------------------- Routes --------------------

// Extract + optional limit + download + debug
app.get("/extract-download", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : null;
  const debug = req.query.debug === "true";

  if (debug) res.setHeader("Content-Type", "text/plain; charset=utf-8");
  else res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const data = await extractFullPDF(res, limit, debug);

    if (!debug) {
      res.setHeader("Content-Disposition", `attachment; filename="cambria_2025_roll.json"`);
      res.end(JSON.stringify(data, null, 2));
    } else {
      res.write("\nExtraction complete!\n");
      res.end();
    }
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// Single parcel by tax_id
app.get("/parcel/:tax_id", (req, res) => {
  if (!fs.existsSync(outputPath)) return res.status(404).json({ error: "Run /extract first" });

  const data = JSON.parse(fs.readFileSync(outputPath));
  const parcel = data.find(p => p.tax_id === req.params.tax_id);

  if (!parcel) return res.status(404).json({ error: "Parcel not found" });

  res.json(parcel);
});

// Download JSON (already extracted)
app.get("/parcels/download", (req, res) => {
  if (!fs.existsSync(outputPath)) return res.status(404).send("Run /extract first");
  res.download(outputPath, "cambria_2025_roll.json");
});

// -------------------- Start Server --------------------
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));