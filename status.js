(function () {
    "use strict";

    const root = document.querySelector("[data-machinery]");
    if (!root) return;

    const states = new Map();
    const dateTime = new Intl.DateTimeFormat("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
        hour12: false,
    });

    function row(key) {
        return root.querySelector(`[data-check="${key}"]`);
    }

    function setCheck(key, state, value, detail) {
        const target = row(key);
        if (!target) return;
        states.set(key, state);
        target.dataset.state = state;
        target.querySelector("[data-check-value]").textContent = value;
        target.querySelector("[data-check-detail]").textContent = detail;
        renderOverall();
    }

    function renderOverall() {
        const observed = Array.from(states.values());
        const overall = observed.includes("fault") ? "Fault observed"
            : observed.includes("degraded") ? "Degraded"
                : observed.includes("unknown") ? "Partly unknown"
                    : observed.length === 7 && observed.every((state) => state === "nominal") ? "Nominal"
                        : "Observation pending";
        root.querySelector("[data-overall]").textContent = overall;
    }

    async function fetchJson(path) {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) throw new Error(`${path} returned ${response.status}`);
        return response.json();
    }

    function displayDate(value) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? "invalid time" : dateTime.format(parsed);
    }

    async function observeArchive() {
        try {
            const manifest = await fetchJson("site-manifest.json");
            if (manifest.schema_version !== 1 || !manifest.content || !Number.isInteger(manifest.content.article_count)) {
                throw new Error("manifest shape is unsupported");
            }
            setCheck(
                "archive", "nominal", `${manifest.content.article_count} objects`,
                `Built ${displayDate(manifest.built_at)}; ${manifest.content.series_count} series.`,
            );
            return manifest;
        } catch (error) {
            setCheck("archive", "fault", "Unreadable", error.message);
            return null;
        }
    }

    async function observeFeed(manifest) {
        try {
            const response = await fetch("feed.xml", { cache: "no-store" });
            if (!response.ok) throw new Error(`feed.xml returned ${response.status}`);
            const documentNode = new DOMParser().parseFromString(await response.text(), "application/xml");
            if (documentNode.querySelector("parsererror")) throw new Error("RSS is malformed");
            const count = documentNode.querySelectorAll("channel > item").length;
            const expected = manifest?.feed?.expected_items;
            if (Number.isInteger(expected) && count !== expected) {
                setCheck("feed", "degraded", `${count}/${expected} items`, "RSS parsed, but manifest and feed counts disagree.");
            } else {
                setCheck("feed", "nominal", `${count} items`, "Syndication signal is structurally valid.");
            }
        } catch (error) {
            setCheck("feed", "fault", "Malformed", error.message);
        }
    }

    async function observePortfolio() {
        try {
            const data = await fetchJson("portfolio-data.json");
            const latest = data.latest;
            if (data.schema_version !== 1 || !latest || !Array.isArray(data.series) || data.series.length === 0) {
                throw new Error("portfolio cache shape is unsupported");
            }
            const componentTotal = Number(latest.skm?.value_usd) + Number(latest.softbank?.value_usd);
            if (!Number.isFinite(componentTotal) || Math.abs(componentTotal - Number(latest.value_usd)) > 0.02) {
                throw new Error("position values do not reconcile with total value");
            }
            const ageDays = (Date.now() - Date.parse(`${latest.date}T23:59:59Z`)) / 86400000;
            const state = ageDays > 5 ? "degraded" : "nominal";
            setCheck(
                "portfolio", state, `Priced through ${latest.date}`,
                `Dataset assembled ${displayDate(data.generated_at)}; ${data.series.length} closes.`,
            );
        } catch (error) {
            setCheck("portfolio", "fault", "Invalid cache", error.message);
        }
    }

    async function observeUpdater() {
        try {
            const data = await fetchJson("https://api.github.com/repos/jimfund/jamesoofou.github.io/actions/workflows/update-portfolio.yml/runs?per_page=1");
            const run = data.workflow_runs?.[0];
            if (!run) throw new Error("no public workflow run was returned");
            const ageHours = (Date.now() - Date.parse(run.updated_at)) / 3600000;
            const state = run.conclusion === "failure" ? "fault" : (ageHours > 96 || run.status !== "completed" ? "degraded" : "nominal");
            setCheck("updater", state, run.conclusion || run.status, `Last observed ${displayDate(run.updated_at)}.`);
        } catch (error) {
            setCheck("updater", "unknown", "Unobserved", `Public Actions API unavailable: ${error.message}`);
        }
    }

    async function observeCalendar() {
        try {
            const data = await fetchJson("market-calendar.json");
            if (data.schema_version !== 1 || !data.valid_through || !data.markets?.US || !data.markets?.JP) {
                throw new Error("calendar shape is unsupported");
            }
            const daysLeft = (Date.parse(`${data.valid_through}T23:59:59Z`) - Date.now()) / 86400000;
            const state = daysLeft < 0 ? "fault" : (daysLeft < 180 ? "degraded" : "nominal");
            setCheck(
                "calendar", state, `Through ${data.valid_through}`,
                `Official confidence: US ${data.markets.US.confirmed_through}; JP ${data.markets.JP.confirmed_through}.`,
            );
        } catch (error) {
            setCheck("calendar", "fault", "Unavailable", error.message);
        }
    }

    async function observeHealth() {
        try {
            const [health, playlist] = await Promise.all([
                fetchJson("site-health.json"),
                fetchJson("radio-playlist.json"),
            ]);
            if (health.schema_version !== 1 || !health.checks) throw new Error("health observation shape is unsupported");
            document.querySelector("[data-observed-at]").textContent = `Observed ${displayDate(health.observed_at)}`;
            const observationAgeHours = (Date.now() - Date.parse(health.observed_at)) / 3600000;
            const stale = !Number.isFinite(observationAgeHours) || observationAgeHours > 216;
            const quoteChecks = [health.checks.yahoo, health.checks.hyperliquid];
            const quoteState = quoteChecks.some((check) => check?.state === "fault") ? "fault"
                : quoteChecks.some((check) => check?.state !== "nominal") ? "unknown"
                    : stale ? "degraded" : "nominal";
            setCheck(
                "quotes", quoteState,
                quoteState === "nominal" ? "Feeds responded" : (stale ? "Observation stale" : "Partly unknown"),
                `Cached observation from ${displayDate(health.observed_at)}; failure does not imply a closed market.`,
            );

            const tracks = playlist.tracks || [];
            const radio = health.checks.radio || {};
            const radioState = radio.state === "fault" ? "fault"
                : radio.state === "unknown" ? "unknown"
                    : stale ? "degraded" : "nominal";
            const faults = (radio.tracks || []).filter((track) => track.state === "fault").map((track) => track.title);
            setCheck(
                "radio", radioState, `${radio.reachable ?? 0}/${tracks.length} reachable`,
                faults.length ? `Unreachable: ${faults.join(", ")}.` : "Reachability observed; embeddability is verified only during playback.",
            );
        } catch (error) {
            setCheck("quotes", "unknown", "Unobserved", error.message);
            setCheck("radio", "unknown", "Unobserved", error.message);
        }
    }

    async function observe() {
        root.setAttribute("aria-busy", "true");
        states.clear();
        const manifest = await observeArchive();
        await Promise.all([
            observeFeed(manifest),
            observePortfolio(),
            observeUpdater(),
            observeCalendar(),
            observeHealth(),
        ]);
        root.setAttribute("aria-busy", "false");
    }

    document.querySelector("[data-reobserve]").addEventListener("click", observe);
    observe();
}());
