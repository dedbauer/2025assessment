import express from "express";
import fs from "fs";
import pdf from "pdf-parse";

const app = express();
const PORT = process.env.PORT || 3000;

const pdfPath = "./Cambria 2025 Final Roll by SBL.pdf";
const outputPath = "cambria_2025_roll.json";

// Clean numbers and dollar amounts
function cleanNumber(val) {
  return val ? val.replace(/\$/g, "").replace(/,/g, "").trim() : "";
}

// Parse a single property block (same as before)
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
    agricultural_district: "",
    "4_5": "",
    year_built: null,
  };

  const lines = blockText.split("\n");

  const taxIdMatch = blockText.match(/(\d{1,2}\.\d{2}-\d-\d{1,2}\.?\d*)/);
  if (taxIdMatch) prop.tax_id = taxIdMatch[1];

  const parcelMatch = blockText.match(/Parcel\s*ID[: ]*(\d+)/i);
  if (parcelMatch) prop.parcel_id = parcelMatch[1];
  else if (prop.tax_id) prop.parcel_id = prop.tax_id.replace(/\D/g, "");

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(prop.tax_id)) {
      if (i + 1 < lines.length) prop.property_location = lines[i + 1].trim();
      break;
    }
  }

  const moneyFields = [
    "land_assessed_value",
    "total_assessed_value",
    "full_market_value",
    "county_taxable",
    "municipal_taxable",
    "school_taxable",
  ];
  moneyFields.forEach((field) => {
    const regex = new RegExp(`${field.replace(/_/g, " ").toUpperCase()}[:\\s$]*([\\d,]+)`, "i");
    const match = blockText.match(regex);
    if (match) prop[field] = `$${cleanNumber(match[1])}`;
  });

  const acresMatch = blockText.match(/ACRES[:\s]*([\d\.]+)/i);
  if (acresMatch) prop.acres = acresMatch[1];

  const frontMatch = blockText.match(/FRONT[:\s]*([\d\.]+)/i);
  const depthMatch = blockText.match(/DEPTH[:\s]*([\d\.]+)/i);
  if (frontMatch) prop.front = frontMatch[1];
  if (depthMatch) prop.depth = depthMatch[1];

  const gridEastMatch = blockText.match(/EASTING[:\s]*(\d+)/i);
  const gridNorthMatch = blockText.match(/NORTHING[:\s]*(\d+)/i);
  if (gridEastMatch) prop.grid_east = gridEastMatch[1];
  if (gridNorthMatch) prop.grid_north = gridNorthMatch[1];

  const swisMatch = blockText.match(/SWIS[:\s]*(\d+)/i);
  if (swisMatch) prop.swis = swisMatch[1];

  const rollMatch = blockText.match(/ROLL SECTION[:\s]*(\d+)/i);
  if (rollMatch) prop.roll_section = rollMatch[1];

  const typeMatch = blockText.match(/PROPERTY TYPE[:\s]*([A-Z0-9\- ]+)/i);
  if (typeMatch) prop.property_type = typeMatch[1].trim();

  const schoolMatch = blockText.match(/SCHOOL[:\s]*([A-Za-z0-9 ]+)/i);
  if (schoolMatch) prop.school = schoolMatch[1].trim();

  const zoningMatch = blockText.match(/ZONING[:\s]*([A-Za-z0-9\/ ]+)/i);
  if (zoningMatch) prop.zoning = zoningMatch[1].trim();

  const neighborhoodMatch = blockText.match(/NEIGHBORHOOD CODE[:\s]*([A-Za-z0-9 .]+)/i);
  if (neighborhoodMatch) prop.neighborhood_code = neighborhoodMatch[1].trim();

  const partialMatch = blockText.match(/PARTIAL CONSTRUCTION[:\s]*(Yes|No)/i);
  if (partialMatch) prop.partial_construction = partialMatch[1];

  const waterMatch = blockText.match(/WATER SUPPLY[:\s]*([0-9A-Za-z -]+)/i);
  if (waterMatch) prop.water_supply = waterMatch[1].trim();

  const utilitiesMatch = blockText.match(/UTILITIES[:\s]*([0-9A-Za-z -]+)/i);
  if (utilitiesMatch) prop.utilities = utilitiesMatch[1].trim();

  const sewerMatch = blockText.match(/SEWER TYPE[:\s]*([0-9A-Za-z -]+)/i);
  if (sewerMatch) prop.sewer_type = sewerMatch[1].trim();

  prop["4_5"] = "1 text contrast ratio";

  return prop;
}

// --- Extract full PDF (with resume)
async function extractFullPDF() {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const fullText = data.text;

  const blocks = fullText.split(/\*{5,}/).map(b => b.trim()).filter(Boolean);

  let existingProperties = [];
  if (fs.existsSync(outputPath)) {
    existingProperties = JSON.parse(fs.readFileSync(outputPath));
  }
  const processedTaxIds = new Set(existingProperties.map(p => p.tax_id));

  for (const block of blocks) {
    const taxIdMatch = block.match(/(\d{1,2}\.\d{2}-\d-\d{1,2}\.?\d*)/);
    const taxId = taxIdMatch ? taxIdMatch[1] : null;

    if (taxId && !processedTaxIds.has(taxId)) {
      const propData = parsePropertyBlock(block);
      existingProperties.push(propData);
      processedTaxIds.add(taxId);

      // Save incrementally
      fs.writeFileSync(outputPath, JSON.stringify(existingProperties, null, 2));
      console.log(`Processed parcel: ${propData.parcel_id} | Tax ID: ${propData.tax_id}`);
    }
  }
  return existingProperties;
}

// --- Endpoint to extract PDF (resume enabled)
app.get("/extract", async (req, res) => {
  try {
    const allProperties = await extractFullPDF();
    res.json({ message: "Extraction complete", total_parcels: allProperties.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Endpoint to get a parcel by tax_id
app.get("/parcel/:tax_id", (req, res) => {
  const taxId = req.params.tax_id;
  if (!fs.existsSync(outputPath)) {
    return res.status(404).json({ error: "Data not found. Run /extract first." });
  }

  const allProperties = JSON.parse(fs.readFileSync(outputPath));
  const parcel = allProperties.find(p => p.tax_id === taxId);

  if (!parcel) {
    return res.status(404).json({ error: `Parcel with tax_id ${taxId} not found.` });
  }

  res.json(parcel);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));