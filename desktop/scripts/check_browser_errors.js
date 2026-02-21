import { chromium } from "playwright";
import fs from "fs";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on("console", msg => {
    if (msg.type() === "error") {
      console.log(`[Browser Error]: ${msg.text()}`);
    } else if (msg.type() === "warning") {
      console.log(`[Browser Warning]: ${msg.text()}`);
    } else {
      console.log(`[Browser Console]: ${msg.text()}`);
    }
  });

  page.on("pageerror", exception => {
    console.log(`[Uncaught Exception]: ${exception}`);
  });

  // Navigate to local dev server
  await page.goto("http://localhost:1420");
  
  // Wait to see if error occurs
  await page.waitForTimeout(3000);
  
  await browser.close();
}

main().catch(console.error);
