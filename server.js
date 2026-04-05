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

  // Land Assessed Value: 3rd line of block, first number after 6-digit school code
  const lines = blockText.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    const thirdLine = lines[2];
    if (debug) console.log(`DEBUG: 3rd line for ${taxLine}: "${thirdLine}"`);

    // Match a 6-digit number first
    const schoolCodeMatch = thirdLine.match(/\b\d{6}\b/);
    if (schoolCodeMatch) {
      const afterSchoolCode = thirdLine.slice(schoolCodeMatch.index + 6);
      // Find first numeric field after the school code
      const numberMatch = afterSchoolCode.match(/\d[\d,]*/);
      if (numberMatch) {
        prop.land_assessed_value = numberMatch[0].replace(/,/g, "");
        if (debug) console.log(`DEBUG: Land Assessed Value for ${taxLine}: ${prop.land_assessed_value}`);
      } else if (debug) {
        console.log(`DEBUG: No number found after school code for ${taxLine}`);
      }
    } else if (debug) {
      console.log(`DEBUG: No 6-digit school code found on 3rd line for ${taxLine}`);
    }
  } else if (debug) {
    console.log(`DEBUG: Block too short to find 3rd line for ${taxLine}`);
  }

  return prop;
}