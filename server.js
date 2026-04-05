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

  // County Taxable Value
  const countyMatch = blockText.match(/COUNTY\s*TAXABLE\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (countyMatch) prop.county_taxable = countyMatch[1].replace(/,/g, "");

  // School Taxable Value
  const schoolMatch = blockText.match(/SCHOOL\s*TAXABLE\s*VALUE[:\s]*\$?([\d,]+)/i);
  if (schoolMatch) prop.school_taxable = schoolMatch[1].replace(/,/g, "");

  // -------------------- Land Assessed Value --------------------
  const lines = blockText.split("\n").map(l => l.trim()).filter(Boolean);

  let debugInfo = {};

  if (lines.length >= 3) {
    const thirdLine = lines[2];
    debugInfo.third_line = thirdLine;

    const schoolCodeMatch = thirdLine.match(/\b\d{6}\b/);

    if (schoolCodeMatch) {
      const afterSchoolCode = thirdLine.slice(schoolCodeMatch.index + 6);
      debugInfo.after_school_code = afterSchoolCode;

      const numberMatch = afterSchoolCode.match(/[\d,.]+/);

      if (numberMatch) {
        prop.land_assessed_value = numberMatch[0].replace(/,/g, "");
        debugInfo.extracted_land_value = prop.land_assessed_value;
      } else {
        debugInfo.land_error = "No number found after school code";
      }
    } else {
      debugInfo.land_error = "No 6-digit school code found";
    }
  } else {
    debugInfo.land_error = "Block has fewer than 3 lines";
  }

  // -------------------- FULL BLOCK DEBUG --------------------
  if (debug) {
    prop._debug = {
      full_block: blockText,
      lines: lines,
      ...debugInfo
    };
  }

  return prop;
}
// -------------------- Extraction --------------------
async function extractFullPDF(res = null, maxEntries = null, debug = false) {
  await ensurePDF();
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const lines = data.text.split("\n").map(l => l.trim());

  // -------------------- Create blocks --------------------
  const blocks = [];
  let currentBlock = [];
  let inBlock = false;

  for (let line of lines) {
    // Start of block: line has ***** plus a number
    if (/^\*{5,}\s*\d/.test(line)) {
      inBlock = true;
      currentBlock = [line];
      continue;
    }

    // End of block: line has only *****
    if (inBlock && /^\*{5,}$/.test(line)) {
      currentBlock.push(line);
      blocks.push(currentBlock.join("\n"));
      inBlock = false;
      continue;
    }

    if (inBlock) currentBlock.push(line);
  }

  const taxMap = new Map();

  for (let block of blocks) {
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
      if (res && debug) res.write(`Processed parcel: Tax ID ${taxLine}\n`);
    } else if (debug && res) {
      res.write(`DEBUG: No Tax ID found in block:\n${block.slice(0, 200)}...\n`);
    }
  }

  const extractedArray = Array.from(taxMap.values());
  fs.writeFileSync(outputPath, JSON.stringify(extractedArray, null, 2));
  return extractedArray;
}

// -------------------- Routes --------------------
app.get("/extract-download", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : null;
  const debug = req.query.debug === "true";

  try {
    if (debug) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      await extractFullPDF(res, limit, true);
      res.write("\nExtraction complete!\n");
      res.end();
    } else {
      const data = await extractFullPDF(null, limit, false);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="cambria_2025_roll.json"`);
      res.end(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

app.get("/parcel/:tax_id", (req, res) => {
  if (!fs.existsSync(outputPath)) return res.status(404).json({ error: "Run /extract first" });

  const data = JSON.parse(fs.readFileSync(outputPath));
  const parcel = data.find(p => p.tax_id === req.params.tax_id);

  if (!parcel) return res.status(404).json({ error: "Parcel not found" });

  res.json(parcel);
});

app.get("/parcels/download", (req, res) => {
  if (!fs.existsSync(outputPath)) return res.status(404).send("Run /extract first");
  res.download(outputPath, "cambria_2025_roll.json");
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));