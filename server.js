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