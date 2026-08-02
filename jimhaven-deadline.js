(function () {
    "use strict";

    const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
    const JIMHAVEN_YEAR = 2026;
    const JIMHAVEN_MONTH_INDEX = 7;
    const root = document.querySelector("[data-jimhaven-deadline]");
    const track = document.querySelector(".jimhaven-progress__track");

    if (!root || !track) {
        return;
    }

    const label = root.querySelector("[data-jimhaven-deadline-label]");
    const value = root.querySelector("[data-jimhaven-deadline-value]");

    if (!label || !value) {
        return;
    }

    function firstUnfilledDay() {
        const index = Array.from(track.children).findIndex(
            (mark) => !mark.classList.contains("is-filled"),
        );
        return index < 0 ? null : index + 1;
    }

    function deadlineForDay(day) {
        return Date.UTC(JIMHAVEN_YEAR, JIMHAVEN_MONTH_INDEX, day + 1) - VIETNAM_UTC_OFFSET_MS;
    }

    function formatDuration(milliseconds) {
        const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const clock = [hours, minutes, seconds]
            .map((part) => String(part).padStart(2, "0"))
            .join(":");
        return days > 0 ? `${days}D ${clock}` : clock;
    }

    function render() {
        const nextDay = firstUnfilledDay();
        if (nextDay === null) {
            label.textContent = "jimhaven";
            value.textContent = "Complete";
            value.removeAttribute("datetime");
            root.classList.remove("is-overdue");
            root.classList.add("is-complete");
            root.setAttribute("aria-label", "Jimhaven complete: 31 posts published");
            return;
        }

        const deadline = deadlineForDay(nextDay);
        const remaining = deadline - Date.now();
        const overdue = remaining < 0;
        const dayLabel = String(nextDay).padStart(2, "0");

        label.textContent = overdue ? `D${dayLabel} overdue` : `Next post · D${dayLabel}`;
        value.textContent = formatDuration(Math.abs(remaining));
        value.dateTime = new Date(deadline).toISOString();
        root.classList.toggle("is-overdue", overdue);
        root.classList.remove("is-complete");
        root.setAttribute(
            "aria-label",
            overdue
                ? `Jimhaven day ${nextDay} post overdue by ${value.textContent}`
                : `${value.textContent} until the jimhaven day ${nextDay} post deadline`,
        );
    }

    render();
    window.setInterval(render, 1000);
}());
