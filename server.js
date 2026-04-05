import express from "express";
import fs from "fs";
import pdf from "pdf-parse";

const app = express();
const PORT = process.env.PORT || 3000;

const pdfPath = "./Cambria 2025 Final Roll by SBL.pdf";
const outputPath = "cambria_2025_roll.json";

// -------------------- Parser --------------------
function parsePropertyBlock(blockText, taxLine) {
  const prop = {};
  prop.tax_id = taxLine || "";

  // Full Market Value
  const fullMatch = blockText.match(/FULL\s*MARKET\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (fullMatch) prop.full_market_value = fullMatch[1].replace(/,/g, "");

  // County Taxable Value
  const countyMatch = blockText.match(/COUNTY\s*TAXABLE\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (countyMatch) prop.county_taxable = countyMatch[1].replace(/,/g, "");

  // School Taxable Value
  const schoolMatch = blockText.match(/SCHOOL\s*TAXABLE\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (schoolMatch) prop.school_taxable = schoolMatch[1].replace(/,/g, "");

  // Land Assessed Value = second number 6 lines below line containing "ASSESSMENT"
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
    const numbers = targetLine.match(/\$?([\d,]+)/g); // all numbers in the line
    if (numbers && numbers.length >= 2) {
      prop.land_assessed_value = numbers[1].replace(/,/g, "");
    }
  }

  return prop;
}
// -------------------- Extraction --------------------
async function extractFullPDF(res = null, maxEntries = null) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const fullText = data.text;

  // Split by ************ lines
  const parts = fullText.split(/[\*]{5,}/).map(p => p.trim()).filter(Boolean);

  const taxMap = new Map();

  for (let block of parts) {
    if (maxEntries && taxMap.size >= maxEntries) break;

    const taxLineMatch = block.match(/\d{1,2}\.\d{2}-\d-\d{1,2}\.?\d*/);
    const taxLine = taxLineMatch ? taxLineMatch[0] : null;

    if (taxLine) {
      const propData = parsePropertyBlock(block, taxLine);

      if (taxMap.has(taxLine)) {
        const existing = taxMap.get(taxLine);
        taxMap.set(taxLine, { ...existing, ...propData });
      } else {
        taxMap.set(taxLine, propData);
      }

      if (res) res.write(`Processed parcel: Tax ID ${taxLine}\n`);
    }
  }

  const extractedArray = Array.from(taxMap.values());
  fs.writeFileSync(outputPath, JSON.stringify(extractedArray, null, 2));
  return extractedArray;
}

// -------------------- Routes --------------------

// Extract + optional limit + download in one call
app.get("/extract-download", async (req, res) => {
  if (!fs.existsSync(pdfPath)) return res.status(404).send("PDF not found");

  const limit = req.query.limit ? parseInt(req.query.limit) : null;

  try {
    const data = await extractFullPDF(null, limit);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="cambria_2025_roll.json"`
    );
    res.end(JSON.stringify(data, null, 2));
  } catch (err) {
    res.status(500).send({ error: err.message });
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});