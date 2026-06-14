(function () {
    const root = document.querySelector("[data-polymarket-iran]");
    const valueNode = document.querySelector("[data-polymarket-iran-value]");
    const chart = document.querySelector("[data-polymarket-iran-chart]");
    const polyline = chart ? chart.querySelector("polyline") : null;
    const eventUrl = "https://gamma-api.polymarket.com/events?slug=us-x-iran-permanent-peace-deal-by";
    const historyUrl = "https://clob.polymarket.com/prices-history";
    const requestTimeout = 8000;
    const fallbackHistory = [
        { t: 1780272008, p: 0.145 },
        { t: 1780358410, p: 0.165 },
        { t: 1780444810, p: 0.135 },
        { t: 1780531206, p: 0.135 },
        { t: 1780617619, p: 0.125 },
        { t: 1780704005, p: 0.085 },
        { t: 1780790416, p: 0.075 },
        { t: 1780876806, p: 0.085 },
        { t: 1780963208, p: 0.055 },
        { t: 1781049608, p: 0.045 },
        { t: 1781136012, p: 0.039 },
        { t: 1781222408, p: 0.1365 },
        { t: 1781308808, p: 0.175 },
        { t: 1781395212, p: 0.2435 },
        { t: 1781397258, p: 0.2455 },
    ];

    if (!root || !valueNode || !chart || !polyline) {
        return;
    }

    function parseMaybeJson(value) {
        if (Array.isArray(value)) {
            return value;
        }

        if (typeof value !== "string") {
            return [];
        }

        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function usableHistory(history) {
        if (!Array.isArray(history)) {
            return [];
        }

        return history
            .map((point) => ({
                t: Number(point.t),
                p: Number(point.p),
            }))
            .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p))
            .sort((a, b) => a.t - b.t);
    }

    function draw(history) {
        const points = usableHistory(history);

        if (points.length < 2) {
            polyline.setAttribute("points", "");
            root.classList.add("is-stale");
            return;
        }

        const width = 56;
        const height = 18;
        const padding = 1.5;
        const minTime = points[0].t;
        const maxTime = points[points.length - 1].t;
        const minPrice = Math.min(...points.map((point) => point.p));
        const maxPrice = Math.max(...points.map((point) => point.p));
        const timeRange = Math.max(1, maxTime - minTime);
        const priceRange = Math.max(0.01, maxPrice - minPrice);
        const path = points.map((point) => {
            const x = padding + ((point.t - minTime) / timeRange) * (width - padding * 2);
            const y = height - padding - ((point.p - minPrice) / priceRange) * (height - padding * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });

        polyline.setAttribute("points", path.join(" "));
    }

    function render(history, isFresh) {
        const points = usableHistory(history);
        const latest = points[points.length - 1];

        if (latest) {
            valueNode.textContent = `${Math.round(latest.p * 100)}%`;
        }

        draw(points);
        root.classList.toggle("is-stale", !isFresh);
        root.title = isFresh
            ? `Polymarket: US x Iran permanent peace deal by June 15, updated ${new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
            })}`
            : "Polymarket: US x Iran permanent peace deal by June 15, recent fallback history";
    }

    function fetchJson(url) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), requestTimeout);

        return fetch(url, { signal: controller.signal })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Polymarket returned ${response.status}`);
                }

                return response.json();
            })
            .finally(() => window.clearTimeout(timeout));
    }

    function findJune15Market(events) {
        const event = Array.isArray(events) ? events[0] : null;
        const markets = event && Array.isArray(event.markets) ? event.markets : [];

        return markets.find((market) => {
            const question = String(market.question || "").toLowerCase();
            const slug = String(market.slug || "").toLowerCase();
            return question.includes("june 15, 2026") || slug.includes("june-15-2026");
        });
    }

    function yesTokenId(market) {
        const outcomes = parseMaybeJson(market.outcomes);
        const tokenIds = parseMaybeJson(market.clobTokenIds);
        const yesIndex = outcomes.findIndex((outcome) => String(outcome).toLowerCase() === "yes");

        return yesIndex >= 0 ? tokenIds[yesIndex] : tokenIds[0];
    }

    async function refresh() {
        const events = await fetchJson(eventUrl);
        const market = findJune15Market(events);

        if (!market) {
            throw new Error("June 15 market missing from Polymarket event");
        }

        const tokenId = yesTokenId(market);

        if (!tokenId) {
            throw new Error("June 15 Yes token missing from Polymarket event");
        }

        const now = Math.floor(Date.now() / 1000);
        const start = now - 14 * 24 * 60 * 60;
        const params = new URLSearchParams({
            market: tokenId,
            startTs: String(start),
            endTs: String(now),
            interval: "1d",
            fidelity: "1440",
        });
        const payload = await fetchJson(`${historyUrl}?${params.toString()}`);
        const history = usableHistory(payload.history);

        if (history.length < 2) {
            throw new Error("Polymarket history response had too few points");
        }

        render(history, true);
    }

    render(fallbackHistory, false);
    refresh().catch((error) => {
        root.classList.add("is-stale");
        root.title = error instanceof Error ? error.message : "Unable to load Polymarket history";
    });
}());
