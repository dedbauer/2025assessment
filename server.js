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

// -------------------- Split into correct blocks --------------------
function splitIntoBlocks(fullText) {
  const lines = fullText.split("\n");

  const blocks = [];
  let currentBlock = null;

  for (let line of lines) {
    if (/\*{5,}/.test(line)) {
      const match = line.match(/\d{1,3}\.\d{2}-\d-\d{1,3}(\.\d+)?/);

      if (match) {
        if (currentBlock) {
          blocks.push(currentBlock);
        }

        currentBlock = {
          tax_id: match[0],
          text: ""
        };
      }
    } else {
      if (currentBlock) {
        currentBlock.text += line + "\n";
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks;
}

// -------------------- Parser --------------------
function parsePropertyBlock(blockText, taxLine, debug = false) {
  const prop = { tax_id: taxLine };

  const cleanText = blockText.replace(/\s+/g, " ");

  function extractValue(label) {
    const inlineRegex = new RegExp(label + "[^\\d]*([\\d,]+)", "i");
    const matchInline = cleanText.match(inlineRegex);
    if (matchInline) return matchInline[1].replace(/,/g, "");

    const lines = blockText.split("\n").map(l => l.trim()).filter(Boolean);
    const idx = lines.findIndex(l => l.toUpperCase().includes(label));

    if (idx >= 0 && idx + 1 < lines.length) {
      const matchNext = lines[idx + 1].match(/([\d,]+)/);
      if (matchNext) return matchNext[1].replace(/,/g, "");
    }

    if (debug) console.log(`DEBUG: Missing ${label} for ${taxLine}`);
    return undefined;
  }

  // Core values
  prop.full_market_value = extractValue("FULL MARKET VALUE");
  prop.county_taxable = extractValue("COUNTY TAXABLE VALUE");
  prop.school_taxable = extractValue("SCHOOL TAXABLE VALUE");

  // -------------------- LAND VALUE (school code rule) --------------------
  const lines = blockText.split("\n").map(l => l.trim()).filter(Boolean);

  for (let line of lines) {
    const schoolMatch = line.match(/\b\d{6}\b/);

    if (schoolMatch) {
      const after = line.split(schoolMatch[0])[1];

      if (after) {
        const numbers = after.match(/([\d,]+)/g);

        if (numbers && numbers.length > 0) {
          prop.land_assessed_value = numbers[0].replace(/,/g, "");

          if (debug) {
            console.log(`LAND FOUND ${taxLine}: ${prop.land_assessed_value}`);
          }

          break;
        }
      }
    }
  }

  if (!prop.land_assessed_value && debug) {
    console.log(`DEBUG: Land value NOT found for ${taxLine}`);
  }

  return prop;
}

// -------------------- Extraction --------------------
async function extractFullPDF(res = null, maxEntries = null, debug = false) {
  await ensurePDF();

  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const fullText = data.text;

  const blocks = splitIntoBlocks(fullText);
  const results = [];

  for (let i = 0; i < blocks.length; i++) {
    if (maxEntries && results.length >= maxEntries) break;

    const { tax_id, text } = blocks[i];

    if (debug && res) {
      res.write(`\n----- FULL BLOCK FOR ${tax_id} -----\n`);
      res.write(text + "\n");
      res.write(`----- END BLOCK FOR ${tax_id} -----\n\n`);
    }

    const parsed = parsePropertyBlock(text, tax_id, debug);
    results.push(parsed);

    if (debug && res) {
      res.write(`Processed parcel: ${tax_id}\n`);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  return results;
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

// Download JSON
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