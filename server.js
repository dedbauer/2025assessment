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
  const fullMatch = blockText.match(/FULL MARKET VALUE[:\s]*\$?([\d,]+)/i);
  if (fullMatch) prop.full_market_value = fullMatch[1].replace(/,/g, "");

  // County Taxable Value
  const countyMatch = blockText.match(/COUNTY TAXABLE VALUE[:\s]*\$?([\d,]+)/i);
  if (countyMatch) prop.county_taxable = countyMatch[1].replace(/,/g, "");

  // School Taxable Value
  const schoolMatch = blockText.match(/SCHOOL TAXABLE VALUE[:\s]*\$?([\d,]+)/i);
  if (schoolMatch) prop.school_taxable = schoolMatch[1].replace(/,/g, "");

  // Land Value = first number in second column
  const lines = blockText.split("\n").map(l => l.trim()).filter(Boolean);
  for (let line of lines) {
    const cols = line.split(/\s+/);
    if (cols.length >= 2 && /^\$?\d/.test(cols[1])) {
      prop.land_assessed_value = cols[1].replace(/,/g, "");
      break;
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

  const extracted = [];

  for (let block of parts) {
    // Stop immediately if we reached the limit
    if (maxEntries && extracted.length >= maxEntries) break;

    // Tax ID = first line that looks like NN.NN-N-N.NN
    const taxLineMatch = block.match(/\d{1,2}\.\d{2}-\d-\d{1,2}\.?\d*/);
    const taxLine = taxLineMatch ? taxLineMatch[0] : null;

    if (taxLine) {
      const propData = parsePropertyBlock(block, taxLine);
      extracted.push(propData);

      if (res) res.write(`Processed parcel: Tax ID ${taxLine}\n`);
    }
  }

  // Save JSON
  fs.writeFileSync(outputPath, JSON.stringify(extracted, null, 2));

  return extracted;
}

// -------------------- Routes --------------------

// Extract + stream logs with optional limit
app.get("/extract", async (req, res) => {
  if (!fs.existsSync(pdfPath)) return res.status(404).send("PDF not found");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  const limit = req.query.limit ? parseInt(req.query.limit) : null;

  try {
    await extractFullPDF(res, limit);
    res.write(`\nExtraction complete!${limit ? ` (${limit} parcels)` : ""}\n`);
    res.end();
  } catch (err) {
    res.write(`Error: ${err.message}\n`);
    res.end();
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

// Download JSON
app.get("/parcels/download", (req, res) => {
  if (!fs.existsSync(outputPath)) return res.status(404).send("Run /extract first");
  res.download(outputPath, "cambria_2025_roll.json");
});

// -------------------- Start Server --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});