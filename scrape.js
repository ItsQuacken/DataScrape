const puppeteer = require("puppeteer");
const { google } = require("googleapis");
const cron = require("node-cron");

async function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

async function scrapeWithPuppeteerUsingXPath(url, xpaths) {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100,
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  );
  await page.goto(url, { waitUntil: "networkidle2" });
  await delay(30000);

  const scrapedData = [];
  for (let index = 0; index < xpaths.length; index++) {
    const xpath = xpaths[index];
    const data = await page.evaluate((xpathExpression) => {
      const result = document.evaluate(
        xpathExpression,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      return result ? (result.textContent || "").trim() : null;
    }, xpath);

    if (index === 2 && data.includes("+")) {
      scrapedData.push(data.replace("+", ""));
    } else if (index === 3) {
      const match = data.match(/[\d,]+\.?\d*/);
      if (match && match[0]) {
        scrapedData.push(match[0]);
      } else {
        scrapedData.push(data);
      }
    } else {
      scrapedData.push(data);
    }
  }

  await browser.close();
  return scrapedData;
}

async function appendDataToGoogleSheet(dataFromSite1, dataFromSite2) {
  const auth = new google.auth.GoogleAuth({
    keyFile: "./credentials.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });
  const spreadsheetId = "Your spreadsheet ID";

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Sheet1",
  });

  const nextRow = res.data.values ? res.data.values.length + 1 : 1;
  const updateRange = `Sheet1!A${nextRow}`;

  const currentDate = new Date().toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });

  let rowData = [currentDate, ...dataFromSite1];

  while (rowData.length < 5) {
    rowData.push("");
  }

  rowData = [...rowData, ...dataFromSite2];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: updateRange,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [rowData],
    },
  });

  console.log(`Data has been successfully updated at range ${updateRange}`);
}

async function scrapeAndAppendToGoogleSheet() {
  try {
    const [dataFromSite1, dataFromSite2] = await Promise.all([
      scrapeWithPuppeteerUsingXPath(
        "https://socialblade.com/twitter/user/sharkyfi",
        [
          '//*[@id="YouTubeUserTopInfoBlock"]/div[2]/span[2]',
          '//*[@id="socialblade-user-content"]/div[11]/div[14]/div[2]/div[1]/span',
          '//*[@id="socialblade-user-content"]/div[13]/div[2]/span',
        ]
      ),
      scrapeWithPuppeteerUsingXPath("https://sharky.fi/beta/orderbooks", [
        '//*[@id="__next"]/div[1]/div[2]/div/div[2]/div[2]/div[1]/div[2]',
        '//*[@id="__next"]/div[1]/div[2]/div/div[2]/div[3]/div[1]/div[2]/text()[1]',
        '//*[@id="__next"]/div[1]/div[2]/div/div[2]/div[4]/div[1]/div[2]/text()',
        '//*[@id="__next"]/div[1]/div[2]/div/div[2]/div[4]/div[1]/div[2]/div[2]',
        '//*[@id="__next"]/div[1]/div[2]/div/div[2]/div[5]/div[1]/div[2]/text()',
      ]),
    ]);

    console.log("Data from Twitter:", dataFromSite1);
    console.log("Data from Orderbook:", dataFromSite2);

    await appendDataToGoogleSheet(dataFromSite1, dataFromSite2);
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

cron.schedule(
  "55 23 * * *",
  () => {
    console.log("Running scheduled scrape and append to Google Sheet...");
    scrapeAndAppendToGoogleSheet();
  },
  {
    scheduled: true,
    timezone: "UTC",
  }
);
