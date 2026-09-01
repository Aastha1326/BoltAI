const API_BASE_URL = "https://boltai-backend-krf1.onrender.com";

const stockOneInput = document.getElementById("stockOne");
const stockTwoInput = document.getElementById("stockTwo");
const compareBtn = document.getElementById("compareBtn");
const errorMessage = document.getElementById("errorMessage");
const loading = document.getElementById("loading");
const comparisonResult = document.getElementById("comparisonResult");
const resultTitle = document.getElementById("resultTitle");
const resultContent = document.getElementById("resultContent");
const backBtn = document.getElementById("backBtn");


// ============================================================
// BACK BUTTON
// ============================================================

backBtn.addEventListener("click", () => {
    window.location.href = "index.html";
});


// ============================================================
// COMPARE STOCKS
// ============================================================

compareBtn.addEventListener("click", async () => {

    const stockOne = stockOneInput.value.trim();
    const stockTwo = stockTwoInput.value.trim();

    errorMessage.textContent = "";
    comparisonResult.style.display = "none";


    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (!stockOne || !stockTwo) {
        errorMessage.textContent =
            "Please enter both stocks.";
        return;
    }

    if (
        stockOne.toUpperCase() ===
        stockTwo.toUpperCase()
    ) {
        errorMessage.textContent =
            "Please enter two different stocks.";
        return;
    }


    // --------------------------------------------------------
    // LOADING
    // --------------------------------------------------------

    compareBtn.disabled = true;
    compareBtn.textContent = "Comparing...";
    loading.style.display = "block";


    try {

        const response = await fetch(
            `${API_BASE_URL}/compare`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    stockOne: stockOne,
                    stockTwo: stockTwo
                })
            }
        );


        const data = await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Unable to compare stocks."
            );

        }


        // ----------------------------------------------------
        // RESULT
        // ----------------------------------------------------

        resultTitle.textContent =
            `${stockOne.toUpperCase()} vs ${stockTwo.toUpperCase()}`;


        resultContent.innerHTML = `
            <div class="ai-comparison">
                ${formatAnalysis(data.analysis)}
            </div>
        `;


        comparisonResult.style.display = "block";


        comparisonResult.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });


    } catch (error) {

        console.error(
            "Comparison Error:",
            error
        );

        errorMessage.textContent =
            error.message ||
            "Something went wrong.";

    } finally {

        compareBtn.disabled = false;

        compareBtn.textContent =
            "Compare Stocks ➜";

        loading.style.display =
            "none";
    }

});


// ============================================================
// FORMAT GEMINI RESPONSE
// ============================================================

function formatAnalysis(text) {

    if (!text) {
        return "<p>No comparison result available.</p>";
    }

    return marked.parse(text);
}
