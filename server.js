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

  const fullMatch = blockText.match(/FULL\s*MARKET\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (fullMatch) prop.full_market_value = fullMatch[1].replace(/,/g, "");
  else if (debug) console.log(`DEBUG: FULL MARKET VALUE not found for ${taxLine}`);

  const countyMatch = blockText.match(/COUNTY\s*TAXABLE\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (countyMatch) prop.county_taxable = countyMatch[1].replace(/,/g, "");
  else if (debug) console.log(`DEBUG: COUNTY TAXABLE VALUE not found for ${taxLine}`);

  const schoolMatch = blockText.match(/SCHOOL\s*TAXABLE\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (schoolMatch) prop.school_taxable = schoolMatch[1].replace(/,/g, "");
  else if (debug) console.log(`DEBUG: SCHOOL TAXABLE VALUE not found for ${taxLine}`);

  // Land Assessed Value
  const lines = blockText.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length >= 4) {
    const thirdLine = lines[3];

    const schoolCodeMatch = thirdLine.match(/\b\d{6}\b/);
    if (schoolCodeMatch) {
      const afterSchoolCode = thirdLine.slice(schoolCodeMatch.index + 6);
      const numberMatch = afterSchoolCode.match(/[\d,.]+/);
      if (numberMatch) {
        prop.land_assessed_value = numberMatch[0].replace(/,/g, "");
      }
    }
  }

  return prop;
}

// -------------------- Extraction --------------------
async function extractFullPDF(res = null, maxEntries = null, debug = false) {
  await ensurePDF();

  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const fullText = data.text;

  // Split using ***** boundaries
  const parts = fullText
    .split(/[\*]{5,}/)
    .map(p => p.trim())
    .filter(Boolean);

  const taxMap = new Map();

  for (let block of parts) {
    if (maxEntries && taxMap.size >= maxEntries) break;

    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);

    // First line = tax_id
    const taxLine = lines[0];

    if (taxLine) {
      const propData = parsePropertyBlock(block, taxLine, debug);

      if (taxMap.has(taxLine)) {
        taxMap.set(taxLine, { ...taxMap.get(taxLine), ...propData });
      } else {
        taxMap.set(taxLine, propData);
      }

      if (res && debug) {
        res.write(`Processed parcel: Tax ID ${taxLine}\n`);
      }
    } else if (debug && res) {
      res.write(`DEBUG: Missing Tax ID in block\n`);
    }
  }

  const extractedArray = Array.from(taxMap.values());
  fs.writeFileSync(outputPath, JSON.stringify(extractedArray, null, 2));

  return extractedArray;
}

// -------------------- Dataset Manager --------------------
async function getDataset({ force = false, limit = null, debug = false, res = null } = {}) {
  if (!force && fs.existsSync(outputPath)) {
    console.log("Using cached dataset...");
    return JSON.parse(fs.readFileSync(outputPath));
  }

  console.log("Rebuilding dataset...");
  return await extractFullPDF(res, limit, debug);
}

// -------------------- Routes --------------------

// Extract + download
app.get("/extract-download", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : null;
  const debug = req.query.debug === "true";
  const force = req.query.force === "true";

  try {
    if (debug) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      await getDataset({ force, limit, debug: true, res });
      res.write("\nExtraction complete!\n");
      res.end();
    } else {
      const data = await getDataset({ force, limit });

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="cambria_2025_roll.json"`);

      res.end(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// Get single parcel
app.get("/parcel/:tax_id", async (req, res) => {
  const force = req.query.force === "true";

  try {
    const data = await getDataset({ force });
    const parcel = data.find(p => p.tax_id === req.params.tax_id);

    if (!parcel) return res.status(404).json({ error: "Parcel not found" });

    res.json(parcel);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// Download dataset
app.get("/parcels/download", async (req, res) => {
  const force = req.query.force === "true";

  try {
    const data = await getDataset({ force });

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cambria_2025_roll.json"`);

    res.end(JSON.stringify(data, null, 2));
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// -------------------- Start Server --------------------
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));