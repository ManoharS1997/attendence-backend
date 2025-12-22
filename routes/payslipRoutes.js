import puppeteer from "puppeteer";

router.get("/:id/download", async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id).populate("employee");
    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    const html = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            h1 { text-align: center; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            td, th { border: 1px solid #333; padding: 8px; }
            th { background: #f0f0f0; }
          </style>
        </head>
        <body>
          <h1>Payslip</h1>
          <p><strong>Name:</strong> ${payslip.employee?.fullName || ""}</p>
          <p><strong>Month:</strong> ${payslip.month}/${payslip.year}</p>

          <table>
            <tr><th>Description</th><th>Amount</th></tr>
            <tr><td>Basic Salary</td><td>${payslip.basicSalary || 0}</td></tr>
            <tr><td>Allowances</td><td>${payslip.allowances || 0}</td></tr>
            <tr><td>Deductions</td><td>${payslip.deductions || 0}</td></tr>
            <tr>
              <th>Net Pay</th>
              <th>${payslip.netPay}</th>
            </tr>
          </table>
        </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({ format: "A4" });

    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Payslip-${payslip.month}-${payslip.year}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });

    res.send(pdfBuffer);
  } catch (err) {
    console.error("Payslip download error:", err);
    res.status(500).json({ message: "Failed to generate payslip PDF" });
  }
});
