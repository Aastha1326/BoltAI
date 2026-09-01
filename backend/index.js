const express = require("express");
const cors = require("cors");
require("dotenv").config();

const {
  ChatGoogleGenerativeAI
} = require("@langchain/google-genai");

const {
  HumanMessage
} = require("@langchain/core/messages");


// ============================================================
// APP CONFIGURATION
// ============================================================

const app = express();

const port =
  process.env.PORT || 3001;

app.use(cors());

app.use(express.json());


// ============================================================
// FINNHUB CONFIGURATION
// ============================================================

const FINNHUB_API_KEY =
  process.env.FINNHUB_API_KEY;

const FINNHUB_BASE_URL =
  "https://finnhub.io/api/v1";


if (!FINNHUB_API_KEY) {

  console.warn(
    "WARNING: FINNHUB_API_KEY is not configured."
  );

}


// ============================================================
// FINNHUB REQUEST HELPER
// ============================================================

async function finnhubGet(
  endpoint,
  params = {}
) {

  if (!FINNHUB_API_KEY) {

    throw new Error(
      "FINNHUB_API_KEY is missing from environment variables."
    );

  }


  const url =
    new URL(
      `${FINNHUB_BASE_URL}${endpoint}`
    );


  Object.entries(params).forEach(
    ([key, value]) => {

      if (
        value !== undefined &&
        value !== null
      ) {

        url.searchParams.set(
          key,
          String(value)
        );

      }

    }
  );


  url.searchParams.set(
    "token",
    FINNHUB_API_KEY
  );


  const response =
    await fetch(url);


  const text =
    await response.text();


  let data = {};


  try {

    data =
      text
        ? JSON.parse(text)
        : {};

  } catch {

    data = {};

  }


  if (!response.ok) {

    throw new Error(
      data.error ||
      data.message ||
      `Finnhub HTTP ${response.status}`
    );

  }


  if (
    data &&
    typeof data === "object" &&
    data.error
  ) {

    throw new Error(
      data.error
    );

  }


  return data;

}


// ============================================================
// GEMINI MODEL
// ============================================================

const model =
  new ChatGoogleGenerativeAI({

    model:
      "gemini-2.5-flash",

    temperature:
      0.2,

    apiKey:
      process.env.apikey

  });


// ============================================================
// CURRENT DATE / TIME
// ============================================================

function getCurrentDateTime() {

  const now =
    new Date();


  return {

    date:
      now.toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "long",
          year: "numeric",
          timeZone: "Asia/Kolkata"
        }
      ),

    time:
      now.toLocaleTimeString(
        "en-IN",
        {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
          timeZone: "Asia/Kolkata"
        }
      ),

    timezone:
      "IST (Asia/Kolkata)",

    iso:
      now.toISOString()

  };

}


// ============================================================
// HOME ROUTE
// ============================================================

app.get(
  "/",
  (req, res) => {

    res.json({

      message:
        "Bolt AI Finance API is running.",

      dataProvider:
        "Finnhub",

      status:
        "online"

    });

  }
);


// ============================================================
// SYMBOL CACHE
// ============================================================

const symbolCache =
  new Map();


// ============================================================
// RESOLVE STOCK SYMBOL
// ============================================================

async function resolveSymbol(
  input
) {

  const value =
    input.trim();


  if (!value) {

    throw new Error(
      "Stock name cannot be empty."
    );

  }


  const upper =
    value.toUpperCase();


  // ----------------------------------------------------------
  // TRY AS DIRECT SYMBOL
  // ----------------------------------------------------------

  if (
    /^[A-Z][A-Z0-9.\-]{0,9}$/.test(
      upper
    )
  ) {

    try {

      const profile =
        await finnhubGet(
          "/stock/profile2",
          {
            symbol: upper
          }
        );


      if (
        profile &&
        profile.ticker
      ) {

        return {

          symbol:
            profile.ticker,

          profile

        };

      }

    } catch {

      // Continue to search.
    }

  }


  // ----------------------------------------------------------
  // SEARCH COMPANY NAME
  // ----------------------------------------------------------

  const cached =
    symbolCache.get(
      value.toLowerCase()
    );


  if (cached) {

    return cached;

  }


  const result =
    await finnhubGet(
      "/search",
      {
        q: value
      }
    );


  const results =
    Array.isArray(
      result.result
    )
      ? result.result
      : [];


  const equity =
    results.find(
      item =>
        item.type ===
        "Common Stock"
    );


  const bestMatch =
    equity ||
    results[0];


  if (
    !bestMatch ||
    !bestMatch.symbol
  ) {

    throw new Error(
      `Could not find a stock for "${input}".`
    );

  }


  const symbol =
    bestMatch.symbol;


  let profile = {};


  try {

    profile =
      await finnhubGet(
        "/stock/profile2",
        {
          symbol
        }
      );

  } catch {

    profile = {};

  }


  const resolved = {

    symbol,

    profile

  };


  symbolCache.set(
    value.toLowerCase(),
    resolved
  );


  return resolved;

}


// ============================================================
// NUMBER HELPER
// ============================================================

function firstNumber(
  ...values
) {

  for (
    const value of values
  ) {

    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {

      return value;

    }

  }


  return null;

}


// ============================================================
// PERCENTAGE HELPER
// ============================================================

function percentage(
  value
) {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(value)
    )
  ) {

    return null;

  }


  const number =
    Number(value);


  return Number(
    (
      number *
      100
    ).toFixed(2)
  );

}


// ============================================================
// HISTORICAL RETURN
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
    historical[
      historical.length - 1
    ];


  if (
    !latest ||
    latest.close === null ||
    latest.close === undefined
  ) {

    return null;

  }


  const target =
    new Date();


  target.setMonth(
    target.getMonth() -
    monthsAgo
  );


  let closest =
    historical[0];


  let closestDifference =
    Math.abs(
      new Date(
        closest.date
      ) -
      target
    );


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


    const difference =
      Math.abs(
        new Date(
          item.date
        ) -
        target
      );


    if (
      difference <
      closestDifference
    ) {

      closest =
        item;

      closestDifference =
        difference;

    }

  }


  if (
    !closest ||
    !closest.close
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
      ) *
      100
    ).toFixed(2)
  );

}


// ============================================================
// GET HISTORICAL DATA
// ============================================================

async function getHistoricalData(
  symbol
) {

  const period2 =
    Math.floor(
      Date.now() / 1000
    );


  const period1 =
    Math.floor(
      (
        Date.now() -
        (
          5 *
          365 *
          24 *
          60 *
          60 *
          1000
        )
      ) / 1000
    );


  try {

    const candles =
      await finnhubGet(
        "/stock/candle",
        {

          symbol,

          resolution:
            "D",

          from:
            period1,

          to:
            period2

        }
      );


    if (
      !candles ||
      candles.s !== "ok" ||
      !Array.isArray(
        candles.t
      )
    ) {

      return [];

    }


    const historical =
      candles.t.map(
        (timestamp, index) => ({

          date:
            new Date(
              timestamp * 1000
            ),

          close:
            candles.c[index]

        })
      );


    return historical
      .filter(
        item =>
          item.close !== null &&
          item.close !== undefined
      )
      .sort(
        (a, b) =>
          new Date(a.date) -
          new Date(b.date)
      );

  } catch (error) {

    console.warn(
      `Historical data unavailable for ${symbol}:`,
      error.message
    );


    return [];

  }

}


// ============================================================
// GET COMPLETE STOCK DATA
// ============================================================

async function getStockData(
  input
) {

  const analysisDateTime =
    getCurrentDateTime();


  // ----------------------------------------------------------
  // RESOLVE SYMBOL
  // ----------------------------------------------------------

  const resolved =
    await resolveSymbol(
      input
    );


  const symbol =
    resolved.symbol;


  const profile =
    resolved.profile || {};


  console.log(
    `Getting Finnhub data for ${symbol}`
  );


  // ----------------------------------------------------------
  // CURRENT QUOTE
  // ----------------------------------------------------------

  let quote = {};


  try {

    quote =
      await finnhubGet(
        "/quote",
        {
          symbol
        }
      );

  } catch (error) {

    console.warn(
      `Current quote unavailable for ${symbol}:`,
      error.message
    );

  }


  // ----------------------------------------------------------
  // BASIC FINANCIALS
  // ----------------------------------------------------------

  let metrics = {};


  try {

    const financialData =
      await finnhubGet(
        "/stock/metric",
        {

          symbol,

          metric:
            "all"

        }
      );


    metrics =
      financialData.metric ||
      {};

  } catch (error) {

    console.warn(
      `Financial metrics unavailable for ${symbol}:`,
      error.message
    );

  }


  // ----------------------------------------------------------
  // HISTORICAL DATA
  // ----------------------------------------------------------

  const historical =
    await getHistoricalData(
      symbol
    );


  // ----------------------------------------------------------
  // MARKET DATA
  // ----------------------------------------------------------

  const marketPrice =
    firstNumber(
      quote.c
    );


  const previousClose =
    firstNumber(
      quote.pc
    );


  const marketChange =
    marketPrice !== null &&
    previousClose !== null
      ? Number(
          (
            marketPrice -
            previousClose
          ).toFixed(4)
        )
      : null;


  const marketChangePercent =
    marketPrice !== null &&
    previousClose !== null &&
    previousClose !== 0
      ? Number(
          (
            (
              (
                marketPrice -
                previousClose
              ) /
              previousClose
            ) *
            100
          ).toFixed(2)
        )
      : null;


  // ----------------------------------------------------------
  // METRIC MAPPINGS
  // ----------------------------------------------------------

  const eps =
    firstNumber(
      metrics.epsTTM,
      metrics.epsBasicExclExtraItemsTTM,
      metrics.epsBasicExclExtraItemsAnnual
    );


  const peRatio =
    firstNumber(
      metrics.peTTM,
      metrics.peBasicTTM
    );


  const forwardPE =
    firstNumber(
      metrics.peForwardTTM
    );


  const priceToBook =
    firstNumber(
      metrics.pbQuarterly,
      metrics.pbAnnual
    );


  const bookValue =
    firstNumber(
      metrics.bookValuePerShareQuarterly,
      metrics.bookValuePerShareAnnual
    );


  const priceToSales =
    firstNumber(
      metrics.psTTM,
      metrics.psAnnual
    );


  const enterpriseToEBITDA =
    firstNumber(
      metrics.evToEbitdaTTM,
      metrics.evToEbitdaAnnual
    );


  const debtToEquity =
    firstNumber(
      metrics.totalDebtToEquityQuarterly,
      metrics.totalDebtToEquityAnnual
    );


  const currentRatio =
    firstNumber(
      metrics.currentRatioQuarterly,
      metrics.currentRatioAnnual
    );


  const returnOnEquity =
    percentage(
      firstNumber(
        metrics.roeTTM,
        metrics.roeAnnual
      )
    );


  const returnOnAssets =
    percentage(
      firstNumber(
        metrics.roaTTM,
        metrics.roaAnnual
      )
    );


  const grossMargins =
    percentage(
      firstNumber(
        metrics.grossMarginTTM,
        metrics.grossMarginAnnual
      )
    );


  const operatingMargins =
    percentage(
      firstNumber(
        metrics.operatingMarginTTM,
        metrics.operatingMarginAnnual
      )
    );


  const profitMargins =
    percentage(
      firstNumber(
        metrics.netProfitMarginTTM,
        metrics.netProfitMarginAnnual
      )
    );


  const revenueGrowth =
    percentage(
      firstNumber(
        metrics.revenueGrowthTTMYoy,
        metrics.revenueGrowth3Y
      )
    );


  const earningsGrowth =
    percentage(
      firstNumber(
        metrics.epsGrowthTTMYoy,
        metrics.epsGrowth3Y
      )
    );


  // ----------------------------------------------------------
  // DIVIDEND
  // ----------------------------------------------------------

  const dividendYield =
    percentage(
      firstNumber(
        metrics.dividendYieldIndicatedAnnual,
        metrics.dividendYieldTTM
      )
    );


  // ----------------------------------------------------------
  // MARKET CAP
  // ----------------------------------------------------------

  const marketCap =
    firstNumber(
      metrics.marketCapitalization
    );


  // Finnhub market capitalization is generally
  // expressed in millions.
  const marketCapValue =
    marketCap !== null
      ? marketCap * 1000000
      : null;


  // ----------------------------------------------------------
  // 52 WEEK DATA
  // ----------------------------------------------------------

  const fiftyTwoWeekHigh =
    firstNumber(
      metrics["52WeekHigh"],
      metrics["52WeekHigh.annual"]
    );


  const fiftyTwoWeekLow =
    firstNumber(
      metrics["52WeekLow"],
      metrics["52WeekLow.annual"]
    );


  // ----------------------------------------------------------
  // VOLUME
  // ----------------------------------------------------------

  const volume =
    firstNumber(
      quote.v
    );


  // ----------------------------------------------------------
  // CASH FLOW / FINANCIAL DATA
  // ----------------------------------------------------------

  const freeCashFlow =
    firstNumber(
      metrics.freeCashFlowTTM
    );


  const operatingCashFlow =
    firstNumber(
      metrics.operatingCashFlowTTM
    );


  // ----------------------------------------------------------
  // HISTORICAL PERFORMANCE
  // ----------------------------------------------------------

  const performance = {

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

  };


  // ----------------------------------------------------------
  // FINAL STRUCTURED OBJECT
  // ----------------------------------------------------------

  return {

    analysisDate:
      analysisDateTime.date,

    analysisTime:
      analysisDateTime.time,

    analysisTimezone:
      analysisDateTime.timezone,

    analysisTimestamp:
      analysisDateTime.iso,


    symbol,


    companyName:
      profile.name ||
      symbol,


    assetType:
      profile.exchange
        ? "EQUITY"
        : "UNKNOWN",


    sector:
      profile.finnhubIndustry ||
      "Data unavailable",


    industry:
      profile.finnhubIndustry ||
      "Data unavailable",


    description:
      profile.name
        ? `${profile.name} is a publicly traded company listed on ${profile.exchange || "a supported exchange"}.`
        : "Data unavailable",


    exchange:
      profile.exchange ||
      "Data unavailable",


    currency:
      profile.currency ||
      "USD",


    marketPrice,


    marketChange,


    marketChangePercent,


    marketCap:
      marketCapValue,


    fiftyTwoWeekHigh,


    fiftyTwoWeekLow,


    volume,


    averageVolume:
      null,


    dividendYield,


    eps,


    peRatio,


    forwardPE,


    priceToBook,


    bookValue,


    priceToSales,


    enterpriseToEBITDA,


    debtToEquity,


    currentRatio,


    returnOnEquity,


    returnOnAssets,


    profitMargins,


    operatingMargins,


    grossMargins,


    revenueGrowth,


    earningsGrowth,


    freeCashFlow,


    operatingCashFlow,


    performance

  };

}


// ============================================================
// GEMINI SINGLE STOCK PROMPT
// ============================================================

function createSingleStockPrompt(
  stock
) {

  return `

You are Bolt AI, an experienced equity research analyst.

Analyze ONE investment asset using ONLY the verified data supplied below.

Do not invent financial numbers.

Do not retrieve additional financial data.

If a value is null, write "Data unavailable".

Do not guarantee profits or returns.

Historical performance does not guarantee future performance.

Investment Safety Score is an analytical rating and NOT a probability of profit.

Clearly separate factual information from interpretation.

============================================================
SOURCE DATA
============================================================

${JSON.stringify(
  stock,
  null,
  2
)}

============================================================
REQUIRED REPORT
============================================================

# ${stock.symbol} — ${stock.companyName}

**Date of Analysis:** ${stock.analysisDate}

**Analysis Time:** ${stock.analysisTime} ${stock.analysisTimezone}

Give a short 2–3 sentence overview.

## 1. COMPANY / ASSET OVERVIEW

| Metric | Value |
|---|---|
| Company / Asset | |
| Ticker | |
| Asset Type | |
| Sector | |
| Industry | |
| Currency | |

Explain what the company does.

## 2. CURRENT MARKET STATUS

| Market Metric | Value |
|---|---:|
| Current Market Price | |
| Market Cap | |
| 52-Week High | |
| 52-Week Low | |
| Current Volume | |
| Average Volume | |
| Dividend Yield | |
| Daily Change | |
| Daily Change % | |

Refer to the latest available market price. Do not call it tick-by-tick real-time.

## 3. VALUATION METRICS

| Valuation Metric | Value |
|---|---:|
| EPS | |
| P/E Ratio | |
| Forward P/E | |
| P/B Ratio | |
| Book Value / Share | |
| Price / Sales | |
| EV / EBITDA | |

**Valuation Assessment:** UNDERVALUED / FAIRLY VALUED / OVERVALUED / INSUFFICIENT DATA

Explain using multiple available metrics.

## 4. FINANCIAL HEALTH

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

**Financial Health:** STRONG / MODERATE / WEAK / INSUFFICIENT DATA

## 5. HISTORICAL PERFORMANCE

| Period | Return |
|---|---:|
| 1 Month | |
| 6 Months | |
| 1 Year | |
| 3 Years | |
| 5 Years | |

Always state:

**Past performance does not guarantee future returns.**

## 6. GROWTH OUTLOOK

| Growth Factor | Assessment |
|---|---|
| Revenue Growth | |
| Earnings Growth | |
| Profitability | |
| Cash Flow | |
| Overall Growth Potential | HIGH / MEDIUM / LOW |

## 7. RISK ANALYSIS

| Risk Category | Level |
|---|---|
| Valuation Risk | Low / Moderate / High |
| Debt Risk | Low / Moderate / High |
| Growth Risk | Low / Moderate / High |
| Market Risk | Low / Moderate / High |
| Business Risk | Low / Moderate / High |
| Overall Risk | LOW / MODERATE / HIGH |

## 8. INVESTMENT SCORECARD

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

The Safety Score is an analytical score and NOT a probability of profit.

## 9. KEY STRENGTHS & WEAKNESSES

| Strengths | Weaknesses |
|---|---|
| | |
| | |
| | |

## 10. FINAL CONCLUSION

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

Give a concise 3–5 sentence conclusion explaining WHY.

Never guarantee profits or future returns.

`;

}


// ============================================================
// SINGLE STOCK ROUTE
// ============================================================

app.post(
  "/build",
  async (req, res) => {

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


      // ------------------------------------------------------
      // GET FINNHUB DATA
      // ------------------------------------------------------

      const stockData =
        await getStockData(
          assetName
        );


      console.log(
        `Finnhub data retrieved for ${stockData.symbol}`
      );


      // ------------------------------------------------------
      // GEMINI
      // ------------------------------------------------------

      const prompt =
        createSingleStockPrompt(
          stockData
        );


      const response =
        await model.invoke([

          new HumanMessage(
            prompt
          )

        ]);


      const analysis =
        (
          response.content ||
          ""
        ).trim();


      // ------------------------------------------------------
      // RESPONSE
      // ------------------------------------------------------

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

  }
);


// ============================================================
// GEMINI COMPARISON PROMPT
// ============================================================

function createComparisonPrompt(
  stockOne,
  stockTwo
) {

  return `

You are Bolt AI, an experienced equity research analyst.

Compare TWO stocks using ONLY the supplied data.

Never invent missing financial figures.

If a value is null, write "Data unavailable".

Do not guarantee profits.

Historical performance does not guarantee future returns.

The Investment Safety Score is NOT a probability of profit.

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
REQUIRED OUTPUT
============================================================

# ${stockOne.symbol} vs ${stockTwo.symbol}

**Date of Analysis:** ${stockOne.analysisDate}

**Analysis Time:** ${stockOne.analysisTime} ${stockOne.analysisTimezone}

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

Explain the valuation comparison.

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

Explain which has stronger financial health.

## 5. HISTORICAL PERFORMANCE

| Period | ${stockOne.symbol} | ${stockTwo.symbol} | Stronger |
|---|---:|---:|---|
| 1 Month | | | |
| 6 Months | | | |
| 1 Year | | | |
| 3 Years | | | |
| 5 Years | | | |

Historical performance does not guarantee future performance.

## 6. RISK COMPARISON

Compare:

- Valuation Risk
- Debt Risk
- Growth Risk
- Market Risk
- Business Risk

Use LOW / MODERATE / HIGH.

## 7. INVESTMENT SCORECARD

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

## 8. CATEGORY WINNERS

| Category | Winner |
|---|---|
| Valuation | |
| Financial Health | |
| Profitability | |
| Growth | |
| Historical Performance | |
| Risk | |
| Overall | |

## 9. FINAL VERDICT

# 🏆 BETTER OVERALL INVESTMENT

Clearly choose either:

${stockOne.symbol}

OR

${stockTwo.symbol}

Give 3–5 concise reasons.

## 10. FINAL CONCLUSION

State which stock currently has the stronger overall investment profile based on the supplied valuation, financial health, growth, historical performance and risk data.

Also explain why the other stock could still suit a different investor.

Never guarantee profits or future returns.

`;

}


// ============================================================
// COMPARISON ROUTE
// ============================================================

app.post(
  "/compare",
  async (req, res) => {

    try {

      const {
        stockOne,
        stockTwo
      } = req.body;


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
        stockOne
          .trim()
          .toLowerCase() ===
        stockTwo
          .trim()
          .toLowerCase()
      ) {

        return res.status(400).json({

          error:
            "Please provide two different stocks."

        });

      }


      console.log(
        `Comparing ${stockOne} vs ${stockTwo}`
      );


      // ------------------------------------------------------
      // GET BOTH STOCKS
      // ------------------------------------------------------

      const [
        dataOne,
        dataTwo
      ] = await Promise.all([

        getStockData(
          stockOne
        ),

        getStockData(
          stockTwo
        )

      ]);


      console.log(
        `Finnhub data retrieved for ${dataOne.symbol} and ${dataTwo.symbol}`
      );


      // ------------------------------------------------------
      // GEMINI
      // ------------------------------------------------------

      const prompt =
        createComparisonPrompt(
          dataOne,
          dataTwo
        );


      const response =
        await model.invoke([

          new HumanMessage(
            prompt
          )

        ]);


      const analysis =
        (
          response.content ||
          ""
        ).trim();


      // ------------------------------------------------------
      // RESPONSE
      // ------------------------------------------------------

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

  }
);


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