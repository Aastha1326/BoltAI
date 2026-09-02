const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");

const YahooFinance = require("yahoo-finance2").default;

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
  queue: {
    concurrency: 1,
    interval: 1500
  }
});

const app = express();

const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());


// ============================================================
// GEMINI MODEL
// ============================================================

const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.5-flash",
  temperature: 0.2,
  apiKey: process.env.apikey
});


// ============================================================
// CURRENT ANALYSIS DATE & TIME
// ============================================================

function getCurrentDateTime() {

  const now = new Date();

  return {

    date: now.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kolkata"
    }),

    time: now.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata"
    }),

    timezone: "IST (Asia/Kolkata)",

    iso: now.toISOString()

  };

}


// ============================================================
// HOME ROUTE
// ============================================================

app.get("/", (req, res) => {

  res.json({

    message: "Bolt AI Finance API is running."

  });

});


// ============================================================
// HELPER: FIND STOCK SYMBOL
// ============================================================

async function resolveSymbol(input) {

  const value = input.trim();

  if (!value) {
    throw new Error("Stock name cannot be empty.");
  }

  const possibleSymbol = value.toUpperCase();

  // If the user entered a ticker, verify it ONCE
  // and return the quote so it can be reused.
  const looksLikeTicker =
    /^[A-Z0-9][A-Z0-9.\-^=]{0,9}$/.test(possibleSymbol);

  if (looksLikeTicker) {

    try {

      const quote =
        await yahooFinance.quote(possibleSymbol);

      if (quote && quote.symbol) {

        return {
          symbol: quote.symbol,
          quote: quote
        };

      }

    } catch (error) {
      // Continue to Yahoo search.
    }
  }

  // Company-name search
  const searchResult =
    await yahooFinance.search(value);

  const quotes =
    searchResult.quotes || [];

  const bestMatch =
    quotes.find(
      (item) =>
        item.quoteType === "EQUITY" ||
        item.quoteType === "ETF"
    );

  if (!bestMatch || !bestMatch.symbol) {

    throw new Error(
      `Could not find a stock or ETF for "${input}".`
    );

  }

  return {
    symbol: bestMatch.symbol,
    quote: null
  };
}


// ============================================================
// HELPER: CALCULATE HISTORICAL RETURN
// ============================================================

function calculateReturn(
  historical,
  monthsAgo
) {

  if (
    !historical ||
    historical.length < 2
  ) {

    return null;

  }


  const latest =
    historical[historical.length - 1];


  if (
    !latest ||
    latest.close === null ||
    latest.close === undefined ||
    latest.close === 0
  ) {

    return null;

  }


  const targetDate =
    new Date();


  targetDate.setMonth(
    targetDate.getMonth() - monthsAgo
  );


  let closest =
    historical[0];


  for (
    const item of historical
  ) {

    if (
      !item ||
      item.close === null ||
      item.close === undefined
    ) {

      continue;

    }


    const currentDifference =
      Math.abs(
        new Date(item.date) -
        targetDate
      );


    const closestDifference =
      Math.abs(
        new Date(closest.date) -
        targetDate
      );


    if (
      currentDifference <
      closestDifference
    ) {

      closest = item;

    }

  }


  if (
    !closest ||
    closest.close === null ||
    closest.close === undefined ||
    closest.close === 0
  ) {

    return null;

  }


  return Number(

    (
      (
        (
          latest.close -
          closest.close
        ) /
        closest.close
      ) * 100
    ).toFixed(2)

  );

}


// ============================================================
// GET COMPLETE STOCK DATA FROM YAHOO FINANCE
// ============================================================

const stockDataCache = new Map();
const STOCK_CACHE_TTL = 60 * 1000; // 60 seconds

async function getStockData(input) {

  // ----------------------------------------------------------
  // ANALYSIS TIMESTAMP
  // ----------------------------------------------------------

  const analysisDateTime =
    getCurrentDateTime();


  // ----------------------------------------------------------
// RESOLVE SYMBOL
// ----------------------------------------------------------

const cacheKey =
  input.trim().toLowerCase();

const cached =
  stockDataCache.get(cacheKey);

if (
  cached &&
  Date.now() - cached.timestamp < STOCK_CACHE_TTL
) {
  return cached.data;
}


// ----------------------------------------------------------
// RESOLVE SYMBOL
// ----------------------------------------------------------

const resolved =
  await resolveSymbol(input);

const symbol =
  resolved.symbol;


// ----------------------------------------------------------
// CURRENT MARKET QUOTE
// ----------------------------------------------------------

let quote =
  resolved.quote || {};

if (!quote.symbol) {

  try {

    quote =
      await yahooFinance.quote(symbol);

  } catch (error) {

    console.warn(
      `Current quote unavailable for ${symbol}:`,
      error.message
    );

  }

}

  // ----------------------------------------------------------
  // FUNDAMENTAL DATA
  // ----------------------------------------------------------

  let summary = {};


  try {

    summary =
      await yahooFinance.quoteSummary(
        symbol,
        {
          modules: [
            "price",
            "summaryDetail",
            "defaultKeyStatistics",
            "financialData",
            "assetProfile"
          ]
        }
      );

  } catch (error) {

    console.warn(
      `Fundamental data partially unavailable for ${symbol}:`,
      error.message
    );

  }


  const price =
    summary.price || {};


  const summaryDetail =
    summary.summaryDetail || {};


  const statistics =
    summary.defaultKeyStatistics || {};


  const financial =
    summary.financialData || {};


  const profile =
    summary.assetProfile || {};


  // ----------------------------------------------------------
  // HISTORICAL PRICE DATA
  // ----------------------------------------------------------

  let historical = [];


  try {

    const period2 =
      new Date();


    const period1 =
      new Date();


    period1.setFullYear(
      period1.getFullYear() - 5
    );


    const chartData =
  await yahooFinance.chart(
    symbol,
    {
      period1,
      period2,
      interval: "1d"
    }
  );

historical =
  chartData.quotes || [];

  } catch (error) {

    console.warn(
      `Historical data unavailable for ${symbol}:`,
      error.message
    );

  }


  // ----------------------------------------------------------
  // CLEAN HISTORICAL DATA
  // ----------------------------------------------------------

  historical =
    historical
      .filter(
        (item) =>
          item &&
          item.close !== null &&
          item.close !== undefined
      )
      .sort(
        (a, b) =>
          new Date(a.date) -
          new Date(b.date)
      );


  // ==========================================================
  // RETURN STRUCTURED STOCK DATA
  // ==========================================================

  const stockData= {

    // --------------------------------------------------------
    // ANALYSIS TIMESTAMP
    // --------------------------------------------------------

    analysisDate:
      analysisDateTime.date,

    analysisTime:
      analysisDateTime.time,

    analysisTimezone:
      analysisDateTime.timezone,

    analysisTimestamp:
      analysisDateTime.iso,


    // --------------------------------------------------------
    // BASIC INFORMATION
    // --------------------------------------------------------

    symbol,

    companyName:
      quote.longName ||
      quote.shortName ||
      price.longName ||
      price.shortName ||
      symbol,

    assetType:
      quote.quoteType ||
      "EQUITY",

    sector:
      profile.sector ||
      "Data unavailable",

    industry:
      profile.industry ||
      "Data unavailable",

    description:
      profile.longBusinessSummary ||
      "Data unavailable",

    currency:
      quote.currency ||
      "Unknown",


    // ========================================================
    // MARKET DATA
    // ========================================================

    marketPrice:
      quote.regularMarketPrice ??
      null,

    marketChange:
      quote.regularMarketChange ??
      null,

    marketChangePercent:
      quote.regularMarketChangePercent ??
      null,

    marketCap:
      quote.marketCap ??
      null,

    fiftyTwoWeekHigh:
      quote.fiftyTwoWeekHigh ??
      null,

    fiftyTwoWeekLow:
      quote.fiftyTwoWeekLow ??
      null,

    volume:
      quote.regularMarketVolume ??
      null,

    averageVolume:
      quote.averageDailyVolume3Month ??
      null,

    dividendYield:
      summaryDetail.dividendYield ??
      null,


    // ========================================================
    // VALUATION
    // ========================================================

    eps:
      statistics.trailingEps ??
      financial.trailingEps ??
      null,

    peRatio:
      summaryDetail.trailingPE ??
      statistics.trailingPE ??
      null,

    forwardPE:
      summaryDetail.forwardPE ??
      statistics.forwardPE ??
      null,

    priceToBook:
      statistics.priceToBook ??
      null,

    bookValue:
      statistics.bookValue ??
      null,

    priceToSales:
      statistics.priceToSalesTrailing12Months ??
      null,

    enterpriseToEBITDA:
      statistics.enterpriseToEbitda ??
      null,


    // ========================================================
    // FINANCIAL HEALTH
    // ========================================================

    debtToEquity:
      financial.debtToEquity ??
      null,

    currentRatio:
      financial.currentRatio ??
      null,

    returnOnEquity:
      financial.returnOnEquity ??
      null,

    returnOnAssets:
      financial.returnOnAssets ??
      null,

    profitMargins:
      financial.profitMargins ??
      null,

    operatingMargins:
      financial.operatingMargins ??
      null,

    grossMargins:
      financial.grossMargins ??
      null,

    revenueGrowth:
      financial.revenueGrowth ??
      null,

    earningsGrowth:
      financial.earningsGrowth ??
      null,

    freeCashFlow:
      financial.freeCashflow ??
      null,

    operatingCashFlow:
      financial.operatingCashflow ??
      null,


    // ========================================================
    // HISTORICAL PERFORMANCE
    // ========================================================

    performance: {

      oneMonth:
        calculateReturn(
          historical,
          1
        ),

      sixMonths:
        calculateReturn(
          historical,
          6
        ),

      oneYear:
        calculateReturn(
          historical,
          12
        ),

      threeYears:
        calculateReturn(
          historical,
          36
        ),

      fiveYears:
        calculateReturn(
          historical,
          60
        )

    }

  };

  stockDataCache.set(cacheKey, {
    timestamp: Date.now(),
    data: stockData
});

return stockData;

}


// ============================================================
// GEMINI PROMPT — SINGLE STOCK
// ============================================================

function createSingleStockPrompt(stock) {

  return `

You are Bolt AI, an experienced equity research analyst.

You are analyzing ONE investment asset using VERIFIED market and financial data retrieved from Yahoo Finance.

Your role is to interpret and structure the supplied data.

You MUST NOT invent, estimate, guess, or retrieve additional financial numbers.


============================================================
SOURCE DATA
============================================================

${JSON.stringify(stock, null, 2)}


============================================================
STRICT DATA RULES
============================================================

1. Use ONLY the data provided above for numerical values.

2. Never invent or estimate missing financial figures.

3. If a value is null or unavailable, write "Data unavailable".

4. Do not use your own memory for current prices or financial ratios.

5. Historical performance does not guarantee future performance.

6. Never guarantee profit or investment returns.

7. Investment Safety Score is an analytical rating, NOT a probability of profit.

8. Clearly separate factual data from your interpretation.

9. Do not create unsupported target prices.

10. Do not claim a precise fair value unless sufficient evidence exists.

11. Do not call a stock undervalued or overvalued solely because of one ratio.

12. Consider valuation, profitability, growth, financial health and risk together.

13. The fields analysisDate, analysisTime and analysisTimezone are generated by the backend.

14. Use the supplied analysisDate as the actual Date of Analysis.

15. Use the supplied analysisTime and analysisTimezone as the actual Analysis Time.

16. NEVER invent or infer a different analysis date.

17. NEVER use an old date from your training data as the Date of Analysis.

18. The Date of Analysis is different from the date of the latest available market trading session.

19. Do not change the numerical values supplied by Yahoo Finance.


============================================================
FORMATTING RULES
============================================================

The response will be displayed on a website using Markdown.

Therefore:

- Use Markdown headings.
- Use Markdown tables for numerical information.
- Keep explanations outside the tables.
- Use bold text for important conclusions.
- Keep the report professional and easy to scan.
- Do not turn the report into one large paragraph.


============================================================
REQUIRED REPORT
============================================================


# ${stock.symbol} — ${stock.companyName}

**Date of Analysis:** ${stock.analysisDate}

**Analysis Time:** ${stock.analysisTime} ${stock.analysisTimezone}

Start with a short 2–3 sentence overview of the company and its current investment profile.


## 1. COMPANY / ASSET OVERVIEW

Create this table:

| Metric | Value |
|---|---|
| Company / Asset | |
| Ticker | |
| Asset Type | |
| Sector | |
| Industry | |
| Currency | |

Then briefly explain what the company does.


## 2. CURRENT MARKET STATUS

MUST use this table:

| Market Metric | Value |
|---|---:|
| Current Market Price (MPS) | |
| Market Cap | |
| 52-Week High | |
| 52-Week Low | |
| Current Volume | |
| Average Volume | |
| Dividend Yield | |
| Daily Change | |
| Daily Change % | |

After the table, briefly explain the current market position.

Do not claim that the price is tick-by-tick real-time.

If appropriate, refer to it as the "latest available market price."


## 3. VALUATION METRICS

MUST use this table:

| Valuation Metric | Value |
|---|---:|
| EPS | |
| P/E Ratio | |
| Forward P/E | |
| P/B Ratio | |
| Book Value / Share | |
| Price / Sales | |
| EV / EBITDA | |

Then provide:

**Valuation Assessment:** UNDERVALUED / FAIRLY VALUED / OVERVALUED / INSUFFICIENT DATA

Explain the assessment using the available valuation metrics.

Pay particular attention to:

- EPS
- P/E
- Forward P/E
- P/B
- Book Value
- Growth

Do not assume a lower P/E automatically means the stock is better.


## 4. FINANCIAL HEALTH

MUST use this table:

| Financial Metric | Value |
|---|---:|
| Debt / Equity | |
| Current Ratio | |
| ROE | |
| ROA | |
| Gross Margin | |
| Operating Margin | |
| Profit Margin | |
| Revenue Growth | |
| Earnings Growth | |
| Operating Cash Flow | |
| Free Cash Flow | |

Then provide:

**Financial Health:** STRONG / MODERATE / WEAK / INSUFFICIENT DATA

Explain the most important strengths and weaknesses.


## 5. HISTORICAL PERFORMANCE

MUST use this table:

| Period | Return |
|---|---:|
| 1 Month | |
| 6 Months | |
| 1 Year | |
| 3 Years | |
| 5 Years | |

Then explain the overall historical trend in 2–4 sentences.

Always state:

**Past performance does not guarantee future returns.**


## 6. GROWTH OUTLOOK

Use a small assessment table:

| Growth Factor | Assessment |
|---|---|
| Revenue Growth | |
| Earnings Growth | |
| Profitability | |
| Cash Flow | |
| Overall Growth Potential | HIGH / MEDIUM / LOW |

Then explain the main factors supporting or limiting growth.


## 7. RISK ANALYSIS

Use this table:

| Risk Category | Level |
|---|---|
| Valuation Risk | Low / Moderate / High |
| Debt Risk | Low / Moderate / High |
| Growth Risk | Low / Moderate / High |
| Market Risk | Low / Moderate / High |
| Business Risk | Low / Moderate / High |
| Overall Risk | LOW / MODERATE / HIGH |

Then briefly explain the most important risks.


## 8. INVESTMENT SCORECARD

Use this table:

| Category | Assessment |
|---|---|
| Valuation | |
| Financial Health | |
| Growth Potential | |
| Risk Level | |
| Short-Term View | Bullish / Neutral / Bearish |
| Long-Term View | Bullish / Neutral / Bearish |
| Recommendation | BUY / HOLD / SELL |
| Investment Safety Score | XX / 100 |
| Profit Potential | Low / Moderate / High |
| Confidence in Assessment | XX% |

The Investment Safety Score must be an analytical score based on the available evidence.

It is NOT a probability of profit.


## 9. KEY STRENGTHS & WEAKNESSES

Create this table:

| Strengths | Weaknesses |
|---|---|
| | |
| | |
| | |

Keep each point short.


## 10. FINAL CONCLUSION

Create this final summary table:

| Final Metric | Assessment |
|---|---|
| Current MPS | |
| Valuation | |
| Financial Health | |
| Growth Potential | |
| Risk Level | |
| Investment Safety Score | XX / 100 |
| Profit Potential | |
| Short-Term View | |
| Long-Term View | |
| Recommendation | |
| Confidence | XX% |

Then provide a concise **3–5 sentence Final Conclusion**.

The conclusion must explain WHY the assessment was reached.

Never guarantee profits, future returns, or a specific probability of profit.

`;
}


// ============================================================
// SINGLE STOCK ROUTE
// ============================================================

app.post("/build", async (req, res) => {

  try {

    const assetName =
      req.body.assetName;


    if (
      !assetName ||
      !assetName.trim()
    ) {

      return res.status(400).json({

        error:
          "Please provide a stock or company name."

      });

    }


    console.log(
      `Analyzing: ${assetName}`
    );


    // --------------------------------------------------------
    // STEP 1: GET REAL DATA FROM YAHOO FINANCE
    // --------------------------------------------------------

    const stockData =
      await getStockData(assetName);


    console.log(
      `Yahoo Finance data retrieved for ${stockData.symbol}`
    );


    console.log(
      `Analysis timestamp: ${stockData.analysisDate} ${stockData.analysisTime} ${stockData.analysisTimezone}`
    );


    // --------------------------------------------------------
    // STEP 2: SEND REAL DATA TO GEMINI
    // --------------------------------------------------------

    const prompt =
      createSingleStockPrompt(
        stockData
      );


    const response =
      await model.invoke([

        new HumanMessage(prompt)

      ]);


    const analysis =
      (response.content || "").trim();


    // --------------------------------------------------------
    // STEP 3: RETURN DATA + AI ANALYSIS
    // --------------------------------------------------------

    res.json({

      stockData,

      analysis,

      analysisDate:
        stockData.analysisDate,

      analysisTime:
        stockData.analysisTime,

      analysisTimezone:
        stockData.analysisTimezone

    });


  } catch (error) {

    console.error(
      "Single Stock Analysis Error:",
      error
    );


    res.status(500).json({

      error:
        "Failed to generate financial analysis.",

      details:
        error.message

    });

  }

});


// ============================================================
// GEMINI PROMPT — STOCK COMPARISON
// ============================================================

function createComparisonPrompt(
  stockOne,
  stockTwo
) {

  return `

You are Bolt AI, an experienced equity research analyst.

You are comparing TWO stocks.

The financial data below was retrieved from Yahoo Finance.

Your job is to interpret the supplied numbers and determine which company currently has the stronger overall investment profile.

DO NOT retrieve or invent additional financial figures.


============================================================
STOCK 1
============================================================

${JSON.stringify(
  stockOne,
  null,
  2
)}


============================================================
STOCK 2
============================================================

${JSON.stringify(
  stockTwo,
  null,
  2
)}


============================================================
STRICT RULES
============================================================

1. Use ONLY the supplied data.

2. Never invent missing numbers.

3. If a value is null, write "Data unavailable".

4. Do not use memory for current financial figures.

5. Historical performance does not guarantee future returns.

6. Do not guarantee profits.

7. Do not claim a percentage probability of profit.

8. Investment Safety Score is an analytical score, NOT a probability.

9. Do not automatically declare a company better because it has a lower P/E.

10. Consider valuation together with growth, profitability, financial health and risk.

11. If a metric cannot fairly be compared, explain why.

12. Do not invent company news or catalysts.

13. The winner should be based on the total evidence, not one metric.

14. analysisDate, analysisTime and analysisTimezone are generated by the backend.

15. Use the supplied timestamp as the Date of Analysis.

16. Never invent or replace the analysis date with an older date.

17. The analysis date is not necessarily the same as the latest trading-session date.

18. Do not change numerical values supplied by Yahoo Finance.


============================================================
COMPARISON FRAMEWORK
============================================================

Evaluate both companies across:

1. Valuation
2. Financial Health
3. Profitability
4. Growth
5. Historical Performance
6. Risk
7. Overall Investment Profile


============================================================
REQUIRED OUTPUT
============================================================

# ${stockOne.symbol} vs ${stockTwo.symbol}

**Date of Analysis:** ${stockOne.analysisDate}

**Analysis Time:** ${stockOne.analysisTime} ${stockOne.analysisTimezone}

Start with a one-sentence overview of the comparison.


## 1. COMPANY OVERVIEW

| Metric | ${stockOne.symbol} | ${stockTwo.symbol} |
|---|---|---|
| Company | | |
| Sector | | |
| Industry | | |
| Asset Type | | |


## 2. MARKET METRICS

| Metric | ${stockOne.symbol} | ${stockTwo.symbol} | Better |
|---|---:|---:|---|
| Market Price | | | |
| Market Cap | | | |
| 52-Week High | | | |
| 52-Week Low | | | |
| Volume | | | |
| Dividend Yield | | | |

Do not automatically label a metric "better" unless the comparison has meaningful investment relevance.


## 3. VALUATION COMPARISON

| Metric | ${stockOne.symbol} | ${stockTwo.symbol} | More Attractive |
|---|---:|---:|---|
| EPS | | | |
| P/E | | | |
| Forward P/E | | | |
| P/B | | | |
| Book Value | | | |
| Price/Sales | | | |
| EV/EBITDA | | | |

Then determine:

**${stockOne.symbol} Valuation:** Undervalued / Fairly Valued / Overvalued / Insufficient Data

**${stockTwo.symbol} Valuation:** Undervalued / Fairly Valued / Overvalued / Insufficient Data

Explain the reasoning.


## 4. FINANCIAL HEALTH

| Metric | ${stockOne.symbol} | ${stockTwo.symbol} | Stronger |
|---|---:|---:|---|
| Debt-to-Equity | | | |
| Current Ratio | | | |
| ROE | | | |
| ROA | | | |
| Gross Margin | | | |
| Operating Margin | | | |
| Profit Margin | | | |
| Revenue Growth | | | |
| Earnings Growth | | | |
| Free Cash Flow | | | |

Then explain which company has stronger financial health and why.


## 5. HISTORICAL PERFORMANCE

| Period | ${stockOne.symbol} | ${stockTwo.symbol} | Stronger |
|---|---:|---:|---|
| 1 Month | | | |
| 6 Months | | | |
| 1 Year | | | |
| 3 Years | | | |
| 5 Years | | | |

Remember:

Historical performance does not guarantee future performance.


## 6. RISK COMPARISON

Compare:

- Valuation Risk
- Debt Risk
- Growth Risk
- Profitability Risk
- Market Risk
- Business Risk

Classify each:

LOW / MODERATE / HIGH


## 7. INVESTMENT SCORECARD

Give each company:

### ${stockOne.symbol}

**Valuation:**  
**Financial Health:**  
**Growth Potential:**  
**Risk Level:**  
**Short-Term View:** Bullish / Neutral / Bearish  
**Long-Term View:** Bullish / Neutral / Bearish  
**Investment Safety Score:** XX/100


### ${stockTwo.symbol}

**Valuation:**  
**Financial Health:**  
**Growth Potential:**  
**Risk Level:**  
**Short-Term View:** Bullish / Neutral / Bearish  
**Long-Term View:** Bullish / Neutral / Bearish  
**Investment Safety Score:** XX/100


The Safety Score is an analytical rating based on the supplied evidence.

It is NOT a probability of profit.


## 8. CATEGORY WINNERS

Provide:

| Category | Winner |
|---|---|
| Valuation | |
| Financial Health | |
| Profitability | |
| Growth | |
| Historical Performance | |
| Risk | |
| Overall | |


Explain any category where the result is close or ambiguous.


## 9. FINAL VERDICT

# 🏆 BETTER OVERALL INVESTMENT

Clearly choose:

${stockOne.symbol}

OR

${stockTwo.symbol}


Then provide:

**Safety Score**

${stockOne.symbol}: XX/100  
${stockTwo.symbol}: XX/100


**Risk**

${stockOne.symbol}:  
${stockTwo.symbol}:


**Growth**

${stockOne.symbol}:  
${stockTwo.symbol}:


**Valuation**

${stockOne.symbol}:  
${stockTwo.symbol}:


Then explain in 3–5 concise points why the winner has the stronger overall profile.


## 10. FINAL CONCLUSION

End with:

**Final Conclusion:**

[Winner] currently appears to have the stronger overall investment profile based on the available valuation, financial health, profitability, growth, historical performance and risk data.

Then explain why the other stock could still be attractive for a different investor.

Do not guarantee profits or future returns.

`;
}


// ============================================================
// STOCK COMPARISON ROUTE
// ============================================================

app.post("/compare", async (req, res) => {

  try {

    const {
      stockOne,
      stockTwo
    } = req.body;


    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (
      !stockOne ||
      !stockTwo ||
      !stockOne.trim() ||
      !stockTwo.trim()
    ) {

      return res.status(400).json({

        error:
          "Please provide two stocks."

      });

    }


    if (
      stockOne.trim().toLowerCase() ===
      stockTwo.trim().toLowerCase()
    ) {

      return res.status(400).json({

        error:
          "Please provide two different stocks."

      });

    }


    console.log(
      `Comparing ${stockOne} vs ${stockTwo}`
    );


    // --------------------------------------------------------
    // STEP 1: GET REAL DATA FOR BOTH STOCKS
    // --------------------------------------------------------

    const dataOne = await getStockData(stockOne);
    const dataTwo = await getStockData(stockTwo);


    console.log(
      `Yahoo Finance data retrieved for ${dataOne.symbol} and ${dataTwo.symbol}`
    );


    console.log(
      `Comparison timestamp: ${dataOne.analysisDate} ${dataOne.analysisTime} ${dataOne.analysisTimezone}`
    );


    // --------------------------------------------------------
    // STEP 2: SEND REAL DATA TO GEMINI
    // --------------------------------------------------------

    const prompt =
      createComparisonPrompt(
        dataOne,
        dataTwo
      );


    const response =
      await model.invoke([

        new HumanMessage(prompt)

      ]);


    const analysis =
      (response.content || "").trim();


    // --------------------------------------------------------
    // STEP 3: RETURN RAW DATA + AI ANALYSIS
    // --------------------------------------------------------

    res.json({

      stockOne:
        dataOne,

      stockTwo:
        dataTwo,

      analysis,

      analysisDate:
        dataOne.analysisDate,

      analysisTime:
        dataOne.analysisTime,

      analysisTimezone:
        dataOne.analysisTimezone

    });


  } catch (error) {

    console.error(
      "Comparison Error:",
      error
    );


    res.status(500).json({

      error:
        "Failed to compare the stocks.",

      details:
        error.message

    });

  }

});


// ============================================================
// START SERVER
// ============================================================

app.listen(
  port,
  "0.0.0.0",
  () => {

    console.log(
      `Bolt AI Finance API listening on port ${port}`
    );

  }
);