// ============================================================
// API CONFIGURATION
// ============================================================

const API_BASE_URL = "http://localhost:3001";


// ============================================================
// PARTICLE BACKGROUND
// ============================================================

if (typeof particlesJS !== "undefined") {

    particlesJS("particles-js", {

        particles: {

            number: {
                value: 160,
                density: {
                    enable: true,
                    value_area: 800
                }
            },

            color: {
                value: "#ffffff"
            },

            shape: {
                type: "circle",
                stroke: {
                    width: 0,
                    color: "#000000"
                }
            },

            opacity: {
                value: 1,
                random: true,
                anim: {
                    enable: true,
                    speed: 1,
                    opacity_min: 0,
                    sync: false
                }
            },

            size: {
                value: 3,
                random: true,
                anim: {
                    enable: false
                }
            },

            line_linked: {
                enable: false
            },

            move: {
                enable: true,
                speed: 1,
                direction: "none",
                random: true,
                straight: false,
                out_mode: "out",
                bounce: false
            }

        },

        interactivity: {

            detect_on: "canvas",

            events: {

                onhover: {
                    enable: true,
                    mode: "bubble"
                },

                onclick: {
                    enable: true,
                    mode: "repulse"
                },

                resize: true

            },

            modes: {

                bubble: {
                    distance: 250,
                    size: 0,
                    duration: 2,
                    opacity: 0,
                    speed: 3
                },

                repulse: {
                    distance: 400,
                    duration: 0.4
                }

            }

        },

        retina_detect: true

    });

}


// ============================================================
// STOCK ANALYSIS
// ============================================================

async function build_now() {

    const input = document.querySelector(".data");
    const loadingContainer =
        document.querySelector(".loading-container");
    const box =
        document.querySelector(".box");

    const assetName =
        input.value.trim();


    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (!assetName) {

        box.style.display = "block";

        box.innerHTML = `
            <div class="error">
                ⚠️ Please enter a company or stock name.
            </div>
        `;

        return;

    }


    // --------------------------------------------------------
    // RESET UI
    // --------------------------------------------------------

    loadingContainer.style.display = "flex";

    box.style.display = "none";

    box.innerHTML = "";


    try {

        // ----------------------------------------------------
        // CALL BACKEND
        // ----------------------------------------------------

        const response = await fetch(
            `${API_BASE_URL}/build`,
            {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    assetName: assetName
                })

            }
        );


        const result =
            await response.json();


        if (!response.ok) {

            throw new Error(
                result.error ||
                "Failed to generate analysis."
            );

        }


        // ----------------------------------------------------
        // DISPLAY RESULT
        // ----------------------------------------------------

        loadingContainer.style.display = "none";

        box.style.display = "block";


        if (result.analysis) {

            box.innerHTML =
                marked.parse(result.analysis);

        } else {

            box.innerHTML = `
                <div class="error">
                    ⚠️ No analysis returned.
                    Please try again.
                </div>
            `;

        }


        // ----------------------------------------------------
        // SCROLL TO RESULT
        // ----------------------------------------------------

        setTimeout(() => {

            box.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

        }, 300);


    } catch (error) {

        console.error(
            "Stock Analysis Error:",
            error
        );


        loadingContainer.style.display =
            "none";

        box.style.display =
            "block";

        box.innerHTML = `
            <div class="error">
                ⚠️ ${error.message ||
                "Error fetching data. Please try again."}
            </div>
        `;

    }

}


// ============================================================
// COMPARE PAGE NAVIGATION
// ============================================================

const compareStocksBtn =
    document.getElementById("compareStocksBtn");


if (compareStocksBtn) {

    compareStocksBtn.addEventListener(
        "click",
        () => {

            window.location.href =
                "compare.html";

        }
    );

}