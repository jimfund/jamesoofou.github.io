(function () {
    "use strict";

    const root = document.querySelector("[data-alphabet-earnings-countdown]");
    if (!root) return;

    const reportNode = root.querySelector("[data-earnings-report-countdown]");
    const callNode = root.querySelector("[data-earnings-call-countdown]");
    if (!reportNode || !callNode) return;

    const reportTarget = Date.parse(reportNode.dateTime);
    const callTarget = Date.parse(callNode.dateTime);
    const callExpectedEnd = callTarget + 60 * 60 * 1000;
    if (!Number.isFinite(reportTarget) || !Number.isFinite(callTarget)) return;

    function formatRemaining(milliseconds) {
        const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return [hours, minutes, seconds]
            .map((part) => String(part).padStart(2, "0"))
            .join(":");
    }

    function render() {
        const now = Date.now();
        if (now >= callExpectedEnd) {
            root.hidden = true;
            return;
        }

        root.hidden = false;
        reportNode.textContent = now >= reportTarget
            ? "Expected now"
            : formatRemaining(reportTarget - now);
        callNode.textContent = now >= callTarget
            ? "Live now"
            : formatRemaining(callTarget - now);
    }

    render();
    window.setInterval(render, 1000);
}());
