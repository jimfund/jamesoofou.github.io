(function () {
    const root = document.querySelector("[data-sp500-ticker]");
    const valueNode = document.querySelector("[data-sp500-value]");
    const endpoint = "https://api.hyperliquid.xyz/info";
    const pollInterval = 60000;
    const requestTimeout = 10000;

    if (!root || !valueNode) {
        return;
    }

    const priceFormatter = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });

    let hasValue = false;
    let inFlight = null;

    function numeric(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function findSp500Context(payload) {
        if (!Array.isArray(payload) || !payload[0] || !Array.isArray(payload[0].universe) || !Array.isArray(payload[1])) {
            return null;
        }

        const assetIndex = payload[0].universe.findIndex((asset) => asset && asset.name === "xyz:SP500");
        if (assetIndex < 0) {
            return null;
        }

        return payload[1][assetIndex] || null;
    }

    function render(ctx) {
        const price = numeric(ctx.markPx) ?? numeric(ctx.midPx) ?? numeric(ctx.oraclePx);

        if (price === null) {
            throw new Error("No S&P 500 price in Hyperliquid response");
        }

        valueNode.textContent = priceFormatter.format(price);
        hasValue = true;
        root.classList.remove("is-stale");
        root.title = `S&P 500 via Hyperliquid, updated ${new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        })}`;
    }

    async function fetchSp500() {
        if (inFlight) {
            return;
        }

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), requestTimeout);
        inFlight = controller;

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: "metaAndAssetCtxs",
                    dex: "xyz",
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`Hyperliquid returned ${response.status}`);
            }

            const ctx = findSp500Context(await response.json());
            if (!ctx) {
                throw new Error("S&P 500 asset missing from Hyperliquid response");
            }

            render(ctx);
        } catch (error) {
            root.classList.add("is-stale");
            root.title = error instanceof Error ? error.message : "Unable to load S&P 500";
            if (!hasValue) {
                valueNode.textContent = "Unavailable";
            }
        } finally {
            window.clearTimeout(timeout);
            inFlight = null;
        }
    }

    fetchSp500();
    window.setInterval(fetchSp500, pollInterval);
}());
