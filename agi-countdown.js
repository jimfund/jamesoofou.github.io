"use strict";

const ASI_TARGET_MS = Date.UTC(2026, 8, 15, 6, 2, 0);
const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;
const MS_PER_MINUTE = 60000;
const MS_PER_SECOND = 1000;

function daysInUTCMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addUTCMonths(date, months) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + months;
    const targetYear = year + Math.floor(month / 12);
    const targetMonth = ((month % 12) + 12) % 12;
    const day = Math.min(date.getUTCDate(), daysInUTCMonth(targetYear, targetMonth));

    return new Date(Date.UTC(
        targetYear,
        targetMonth,
        day,
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds()
    ));
}

function calendarCountdown(now, target) {
    if (now >= target) {
        return { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    let years = target.getUTCFullYear() - now.getUTCFullYear();
    if (addUTCMonths(now, years * 12) > target) years -= 1;

    let cursor = addUTCMonths(now, years * 12);
    let months = (target.getUTCFullYear() - cursor.getUTCFullYear()) * 12
        + target.getUTCMonth() - cursor.getUTCMonth();
    if (addUTCMonths(cursor, months) > target) months -= 1;

    cursor = addUTCMonths(cursor, months);
    let remaining = target.getTime() - cursor.getTime();

    const days = Math.floor(remaining / MS_PER_DAY);
    remaining -= days * MS_PER_DAY;
    const hours = Math.floor(remaining / MS_PER_HOUR);
    remaining -= hours * MS_PER_HOUR;
    const minutes = Math.floor(remaining / MS_PER_MINUTE);
    remaining -= minutes * MS_PER_MINUTE;
    const seconds = Math.floor(remaining / MS_PER_SECOND);

    return { years, months, days, hours, minutes, seconds };
}

function pad(value) {
    return String(value).padStart(2, "0");
}

function renderCountdown() {
    const root = document.querySelector("[data-agi-countdown]");
    if (!root) return;

    const parts = calendarCountdown(new Date(), new Date(ASI_TARGET_MS));
    const selectors = {
        years: "[data-agi-years]",
        months: "[data-agi-months]",
        days: "[data-agi-days]",
        hours: "[data-agi-hours]",
        minutes: "[data-agi-minutes]",
        seconds: "[data-agi-seconds]",
    };

    for (const [key, selector] of Object.entries(selectors)) {
        const element = root.querySelector(selector);
        if (element) element.textContent = pad(parts[key]);
    }
}

renderCountdown();
window.setInterval(renderCountdown, 1000);
