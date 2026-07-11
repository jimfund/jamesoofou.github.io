"use strict";

const ASI_TARGET_MS = Date.UTC(2026, 7, 29, 0, 23, 48);
const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;
const MS_PER_MINUTE = 60000;
const MS_PER_SECOND = 1000;

function daysInUTCMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addUTCMonths(date, months) {
    const month = date.getUTCMonth() + months;
    const year = date.getUTCFullYear() + Math.floor(month / 12);
    const normalizedMonth = ((month % 12) + 12) % 12;
    const day = Math.min(date.getUTCDate(), daysInUTCMonth(year, normalizedMonth));

    return new Date(Date.UTC(
        year,
        normalizedMonth,
        day,
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds()
    ));
}

function pad(value) {
    return String(value).padStart(2, "0");
}

function partsUntil(target) {
    const now = new Date();
    if (now.getTime() >= target.getTime()) return [0, 0, 0, 0, 0];

    let months = (target.getUTCFullYear() - now.getUTCFullYear()) * 12
        + target.getUTCMonth() - now.getUTCMonth();
    if (addUTCMonths(now, months) > target) months -= 1;

    const cursor = addUTCMonths(now, months);
    let remaining = target.getTime() - cursor.getTime();
    const days = Math.floor(remaining / MS_PER_DAY);
    remaining -= days * MS_PER_DAY;
    const hours = Math.floor(remaining / MS_PER_HOUR);
    remaining -= hours * MS_PER_HOUR;
    const minutes = Math.floor(remaining / MS_PER_MINUTE);
    remaining -= minutes * MS_PER_MINUTE;
    const seconds = Math.floor(remaining / MS_PER_SECOND);

    return [months, days, hours, minutes, seconds];
}

function renderCountdown() {
    const element = document.querySelector("[data-asi-countdown]");
    if (!element) return;

    element.textContent = partsUntil(new Date(ASI_TARGET_MS)).map(pad).join(":");
}

renderCountdown();
window.setInterval(renderCountdown, 1000);
