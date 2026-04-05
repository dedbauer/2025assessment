import express from "express";
import fs from "fs";
import pdf from "pdf-parse";

const app = express();
const PORT = process.env.PORT || 3000;

const pdfPath = "./Cambria 2025 Final Roll by SBL.pdf";
const outputPath = "cambria_2025_roll.json";

// -------------------- Helpers --------------------
function cleanNumber(val) {
  return val ? val.replace(/\$/g, "").replace(/,/g, "").trim() : "";
}

// -------------------- Parser --------------------
function parsePropertyBlock(blockText) {
  const prop = {
    parcel_id: "",
    tax_id: "",
    building_style: "",
    number_of_stories: "",
    exterior_wall_material: "",
    actual_year_built: "",
    eff_year_built: "",
    year_remodeled: "",
    number_of_kitchens: "",
    number_of_full_baths: "",
    number_of_half_baths: "",
    number_of_bedrooms: "",
    number_of_fireplaces: "",
    heat_type: "",
    fuel_type: "",
    central_air: "",
    basement_type: "",
    total_sq_ft: "",
    "1st_story_sq_ft": "",
    "2nd_story_sq_ft": "",
    "1_2_story_sq_ft": "",
    "3_4_story_sq_ft": "",
    additional_story_sq_ft: "",
    finished_attic_sq_ft: "",
    finished_basement_sq_ft: "",
    finished_rec_room_sq_ft: "",
    finished_over_garage_sq_ft: "",
    condition: "",
    land_assessed_value: "",
    total_assessed_value: "",
    equalization_rate: "",
    full_market_value: "",
    partial_construction: "",
    county_taxable: "",
    municipal_taxable: "",
    school_taxable: "",
    roll_section: "",
    property_location: "",
    property_type: "",
    neighborhood_code: "",
    swis: "",
    water_supply: "",
    utilities: "",
    sewer_type: "",
    zoning: "",
    school: "",
    grid_east: "",
    grid_north: "",
    acres: "",
    front: "",
    depth: "",
    agricultural_district: "No",
    "4_5": "1 text contrast ratio",
    year_built: null,
  };

  // Split into lines
  const lines = blockText.split("\n");

  // Tax ID
  const taxIdMatch = blockText.match(/(\d{1,2}\.\d{2}-\d-\d{1,2}\.?\d*)/);
  if (taxIdMatch) prop.tax_id = taxIdMatch[1];
  if (prop.tax_id) prop.parcel_id = prop.tax_id.replace(/\D/g, "");

  // Property location
  const addrMatch = blockText.match(/\d+\s+[A-Za-z0-9 .]+(Rd|Road|St|Street|Ave|Avenue|Ln|Lane)/i);
  if (addrMatch) prop.property_location = addrMatch[0];

  // Money / assessed values
  const moneyMatches = blockText.match(/\$?\d{1,3}(,\d{3})*/g);
  if (moneyMatches && moneyMatches.length >= 5) {
    prop.land_assessed_value = `$${cleanNumber(moneyMatches[0])}`;
    prop.total_assessed_value = `$${cleanNumber(moneyMatches[1])}`;
    prop.full_market_value = `$${cleanNumber(moneyMatches[2])}`;
    prop.county_taxable = `$${cleanNumber(moneyMatches[3])}`;
    prop.municipal_taxable = `$${cleanNumber(moneyMatches[4])}`;
    prop.school_taxable = `$${cleanNumber(moneyMatches[4])}`;
  }

  // Acres / front / depth
  const numericMatches = blockText.match(/\d+\.\d+/g);
  if (numericMatches) {
    prop.acres = numericMatches[0] || "";
    prop.front = numericMatches[1] || "";
    prop.depth = numericMatches[2] || "";
  }

  // SWIS
  const swisMatch = blockText.match(/SWIS[:\s]*(\d+)/i);
  if (swisMatch) prop.swis = swisMatch[1];

  // Roll section
  const rollMatch = blockText.match(/ROLL SECTION[:\s]*(\d+)/i);
  if (rollMatch) prop.roll_section = rollMatch[1];

  // Numeric attributes
  const numbers = blockText.match(/\b\d+\b/g);
  if (numbers && numbers.length > 0) {
    prop.number_of_stories = numbers[0] || "";
    prop.number_of_bedrooms = numbers[1] || "";
    prop.number_of_full_baths = numbers[2] || "";
    prop.number_of_half_baths = numbers[3] || "";
    prop.number_of_kitchens = numbers[4] || "";
    prop.number_of_fireplaces = numbers[5] || "";
    prop["1st_story_sq_ft"] = numbers[6] || "";
    prop["2nd_story_sq_ft"] = numbers[7] || "";
    prop.total_sq_ft = numbers[8] || "";
    prop.finished_basement_sq_ft = numbers[9] || "";
  }

  // Building style / exterior / heat / fuel / air / basement / condition
  const styleMatch = blockText.match(/(\d{2}\s*-\s*[A-Za-z \/]+)/);
  if (styleMatch) prop.building_style = styleMatch[1];

  const exteriorMatch = blockText.match(/(0[1-9]\s*-\s*[A-Za-z \/]+)/);
  if (exteriorMatch) prop.exterior_wall_material = exteriorMatch[1];

  const heatMatch = blockText.match(/(2\s*-\s*Hot air|3\s*-\s*Steam|1\s*-\s*Other)/i);
  if (heatMatch) prop.heat_type = heatMatch[1];

  const fuelMatch = blockText.match(/(9\s*-\s*Propane\/LPG|1\s*-\s*Gas|2\s*-\s*Oil)/i);
  if (fuelMatch) prop.fuel_type = fuelMatch[1];

  const airMatch = blockText.match(/(Yes|No)\s*Central Air/i);
  if (airMatch) prop.central_air = airMatch[1];

  const basementMatch = blockText.match(/(4\s*-\s*Full|2\s*-\s*Partial|0\s*-\s*None)/i);
  if (basementMatch) prop.basement_type = basementMatch[1];

  const conditionMatch = blockText.match(/(4\s*-\s*Good|3\s*-\s*Average|5\s*-\s*Excellent)/i);
  if (conditionMatch) prop.condition = conditionMatch[1];

  return prop;
}

// -------------------- Extraction --------------------
async function extractFullPDF(res = null) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const fullText = data.text;

  const blocks = fullText.split(/\*{5,}/).map(b => b.trim()).filter(Boolean);

  let existingProperties = [];
  if (fs.existsSync(outputPath)) {
    existingProperties = JSON.parse(fs.readFileSync(outputPath));
    if (res) res.write(`Resuming from ${existingProperties.length} parcels...\n`);
  }

  const processedTaxIds = new Set(existingProperties.map(p => p.tax_id));

  for (const block of blocks) {
    const taxIdMatch = block.match(/(\d{1,2}\.\d{2}-\d-\d{1,2}\.?\d*)/);
    const taxId = taxIdMatch ? taxIdMatch[1] : null;

    if (taxId && !processedTaxIds.has(taxId)) {
      const propData = parsePropertyBlock(block);
      existingProperties.push(propData);
      processedTaxIds.add(taxId);

      fs.writeFileSync(outputPath, JSON.stringify(existingProperties, null, 2));

      if (res) res.write(`Processed parcel: ${propData.parcel_id} | Tax ID: ${propData.tax_id}\n`);
    }
  }

  return existingProperties;
}

// -------------------- Routes --------------------

// Extract + stream logs
app.get("/extract", async (req, res) => {
  if (!fs.existsSync(pdfPath)) return res.status(404).send("PDF not found");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  try {
    await extractFullPDF(res);
    res.write("\nExtraction complete!\n");
    res.end();
  } catch (err) {
    res.write(`Error: ${err.message}\n`);
    res.end();
  }
});

// Extract + download with logs
app.get("/extract-download", async (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  try {
    await extractFullPDF(res);
    res.write("\nExtraction complete! Preparing download...\n");

    // Stream file as attachment
    const fileStream = fs.createReadStream(outputPath);
    fileStream.on("end", () => res.end());
    fileStream.pipe(res, { end: false });
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

// All parcels (paginated)
app.get("/parcels", (req, res) => {
  if (!fs.existsSync(outputPath)) return res.status(404).json({ error: "Run /extract first" });

  const data = JSON.parse(fs.readFileSync(outputPath));
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const start = (page - 1) * limit;
  const end = start + limit;

  res.json({
    total: data.length,
    page,
    limit,
    data: data.slice(start, end),
  });
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