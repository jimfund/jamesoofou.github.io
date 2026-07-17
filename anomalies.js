(function () {
    "use strict";

    const archive = document.querySelector(".archive-list--home");
    if (!archive) return;

    function hash(value) {
        let result = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            result ^= value.charCodeAt(index);
            result = Math.imul(result, 16777619);
        }
        return result >>> 0;
    }

    const now = new Date();
    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth();
    const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const scheduledDay = 1 + (hash(`jimfund:${month}:day`) % daysInMonth);
    const override = new URLSearchParams(window.location.search).get("anomaly");
    const modes = ["offset", "classification", "signal"];
    const scheduledMode = modes[hash(`jimfund:${month}:mode`) % modes.length];
    const mode = modes.includes(override) ? override : scheduledMode;

    if (override === "none" || (!modes.includes(override) && now.getUTCDate() !== scheduledDay)) {
        return;
    }

    const entries = Array.from(archive.querySelectorAll(".archive-list__entry"));
    if (!entries.length) return;

    const targetIndex = hash(`jimfund:${month}:${mode}:target`) % entries.length;
    const target = entries[targetIndex];
    document.documentElement.dataset.archiveAnomaly = mode;

    if (mode === "offset") {
        target.classList.add("has-archive-offset");
        return;
    }

    if (mode === "classification") {
        const metadata = target.querySelector(".archive-list__meta");
        if (!metadata) return;
        const canonical = metadata.textContent.trim();
        const labels = ["Object", "Signal", "Forecast", "Residue", "Instrument"];
        const observed = labels[hash(`jimfund:${month}:label`) % labels.length];
        metadata.textContent = "";

        const visual = document.createElement("span");
        visual.className = "archive-anomaly__classification";
        visual.setAttribute("aria-hidden", "true");
        visual.textContent = observed;

        const truth = document.createElement("span");
        truth.className = "visually-hidden";
        truth.textContent = canonical;
        metadata.append(visual, truth);
        return;
    }

    const phrases = [
        "orphan signal / no object attached",
        "index discrepancy / tolerated",
        "carrier present below archive noise floor",
    ];
    const signal = document.createElement("li");
    signal.className = "archive-anomaly__signal";
    signal.setAttribute("aria-hidden", "true");
    signal.textContent = phrases[hash(`jimfund:${month}:phrase`) % phrases.length];
    target.insertAdjacentElement("afterend", signal);
}());
