app.get("/extract", async (req, res) => {
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).send("PDF not found");
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    const fullText = data.text;
    const blocks = fullText.split(/\*{5,}/).map(b => b.trim()).filter(Boolean);

    let existingProperties = [];
    if (fs.existsSync(outputPath)) {
      existingProperties = JSON.parse(fs.readFileSync(outputPath));
      res.write(`Resuming from ${existingProperties.length} parcels...\n`);
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

        // Stream log to browser
        res.write(`Processed parcel: ${propData.parcel_id} | Tax ID: ${propData.tax_id}\n`);
      }
    }

    res.write(`\nExtraction complete! Total parcels: ${existingProperties.length}\n`);
    res.end();

  } catch (err) {
    console.error(err);
    res.write(`Error: ${err.message}\n`);
    res.end();
  }
});