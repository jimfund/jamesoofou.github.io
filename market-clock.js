(function () {
    const clockRoot = document.querySelector("[data-market-clock]");
    const timeRoot = document.querySelector("[data-market-time]");

    if (!clockRoot || !timeRoot) {
        return;
    }

    const markets = [
        {
            label: "America",
            timeZone: "America/New_York",
            sessions: [
                { openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0 },
            ],
            closedDates: [
                "2026-01-01",
                "2026-01-19",
                "2026-02-16",
                "2026-04-03",
                "2026-05-25",
                "2026-06-19",
                "2026-07-03",
                "2026-09-07",
                "2026-11-26",
                "2026-12-25",
                "2027-01-01",
                "2027-01-18",
                "2027-02-15",
                "2027-03-26",
                "2027-05-31",
                "2027-06-18",
                "2027-07-05",
                "2027-09-06",
                "2027-11-25",
                "2027-12-24",
                "2028-01-17",
                "2028-02-21",
                "2028-04-14",
                "2028-05-29",
                "2028-06-19",
                "2028-07-04",
                "2028-09-04",
                "2028-11-23",
                "2028-12-25",
            ],
            earlyCloses: {
                "2026-07-02": { closeHour: 13, closeMinute: 0 },
                "2026-11-27": { closeHour: 13, closeMinute: 0 },
                "2026-12-24": { closeHour: 13, closeMinute: 0 },
                "2027-07-02": { closeHour: 13, closeMinute: 0 },
                "2027-11-26": { closeHour: 13, closeMinute: 0 },
                "2028-07-03": { closeHour: 13, closeMinute: 0 },
                "2028-11-24": { closeHour: 13, closeMinute: 0 },
            },
        },
        {
            label: "Japan",
            timeZone: "Asia/Tokyo",
            sessions: [
                { openHour: 9, openMinute: 0, closeHour: 11, closeMinute: 30 },
                { openHour: 12, openMinute: 30, closeHour: 15, closeMinute: 30 },
            ],
            closedDates: [
                "2026-01-01",
                "2026-01-02",
                "2026-01-03",
                "2026-01-12",
                "2026-02-11",
                "2026-02-23",
                "2026-03-20",
                "2026-04-29",
                "2026-05-03",
                "2026-05-04",
                "2026-05-05",
                "2026-05-06",
                "2026-07-20",
                "2026-08-11",
                "2026-09-21",
                "2026-09-22",
                "2026-09-23",
                "2026-10-12",
                "2026-11-03",
                "2026-11-23",
                "2026-12-31",
                "2027-01-01",
                "2027-01-02",
                "2027-01-03",
                "2027-01-11",
                "2027-02-11",
                "2027-02-23",
                "2027-03-21",
                "2027-03-22",
                "2027-04-29",
                "2027-05-03",
                "2027-05-04",
                "2027-05-05",
                "2027-07-19",
                "2027-08-11",
                "2027-09-20",
                "2027-09-23",
                "2027-10-11",
                "2027-11-03",
                "2027-11-23",
                "2027-12-31",
            ],
        },
    ];

    const weekdayFormatterCache = new Map();
    const partsFormatterCache = new Map();

    function formatter(cache, timeZone, options) {
        if (!cache.has(timeZone)) {
            cache.set(timeZone, new Intl.DateTimeFormat("en-US", {
                timeZone,
                ...options,
            }));
        }
        return cache.get(timeZone);
    }

    function zonedParts(date, timeZone) {
        const parts = formatter(partsFormatterCache, timeZone, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
        }).formatToParts(date);

        return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    }

    function weekday(date, timeZone) {
        return formatter(weekdayFormatterCache, timeZone, {
            weekday: "short",
        }).format(date);
    }

    function isWeekday(date, timeZone) {
        return !["Sat", "Sun"].includes(weekday(date, timeZone));
    }

    function dateKey(date, timeZone) {
        const parts = zonedParts(date, timeZone);
        return [
            parts.year,
            String(parts.month).padStart(2, "0"),
            String(parts.day).padStart(2, "0"),
        ].join("-");
    }

    function isMarketHoliday(market, date) {
        return (market.closedDates || []).includes(dateKey(date, market.timeZone));
    }

    function zonedTimeToDate(timeZone, year, month, day, hour, minute) {
        const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
        const actual = zonedParts(guess, timeZone);
        const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
        const actualUtc = Date.UTC(
            actual.year,
            actual.month - 1,
            actual.day,
            actual.hour,
            actual.minute,
            actual.second || 0,
        );

        return new Date(guess.getTime() + desiredUtc - actualUtc);
    }

    function addZonedDays(date, timeZone, days) {
        const parts = zonedParts(date, timeZone);
        const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
        const shiftedParts = zonedParts(shifted, timeZone);
        return zonedTimeToDate(timeZone, shiftedParts.year, shiftedParts.month, shiftedParts.day, 0, 0);
    }

    function sessionsForDate(market, date) {
        if (!isWeekday(date, market.timeZone) || isMarketHoliday(market, date)) {
            return [];
        }

        const parts = zonedParts(date, market.timeZone);
        const earlyClose = (market.earlyCloses || {})[dateKey(date, market.timeZone)];

        return market.sessions.map((session, index) => {
            const closeHour = earlyClose && index === market.sessions.length - 1
                ? earlyClose.closeHour
                : session.closeHour;
            const closeMinute = earlyClose && index === market.sessions.length - 1
                ? earlyClose.closeMinute
                : session.closeMinute;

            return {
                open: zonedTimeToDate(
                    market.timeZone,
                    parts.year,
                    parts.month,
                    parts.day,
                    session.openHour,
                    session.openMinute,
                ),
                close: zonedTimeToDate(
                    market.timeZone,
                    parts.year,
                    parts.month,
                    parts.day,
                    closeHour,
                    closeMinute,
                ),
            };
        }).filter((session) => session.open < session.close);
    }

    function nextOpen(market, now) {
        let candidate = now;

        for (let dayOffset = 0; dayOffset < 10; dayOffset += 1) {
            if (dayOffset > 0) {
                candidate = addZonedDays(now, market.timeZone, dayOffset);
            }

            const upcomingSession = sessionsForDate(market, candidate)
                .find((session) => session.open > now);

            if (upcomingSession) {
                return upcomingSession.open;
            }
        }

        return null;
    }

    function marketStatus(market, now) {
        const openSession = sessionsForDate(market, now)
            .find((session) => now >= session.open && now < session.close);

        if (openSession) {
            return {
                isOpen: true,
                text: `Open - closes in ${formatDuration(openSession.close - now)}`,
            };
        }

        const next = nextOpen(market, now);

        return {
            isOpen: false,
            text: next ? `Closed - opens in ${formatDuration(next - now)}` : "Closed",
        };
    }

    function formatDuration(milliseconds) {
        const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;

        if (days > 0) {
            return `${days}d ${hours}h`;
        }

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }

        return `${minutes}m`;
    }

    function render() {
        const now = new Date();
        timeRoot.textContent = now.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });

        const rows = clockRoot.querySelectorAll(".market-clock__market");
        markets.forEach((market, index) => {
            const row = rows[index];
            if (!row) {
                return;
            }

            const status = marketStatus(market, now);
            const statusNode = row.querySelector(".market-clock__status");
            statusNode.textContent = status.text;
            statusNode.classList.toggle("is-open", status.isOpen);
        });
    }

    render();
    window.setInterval(render, 30000);
}());
