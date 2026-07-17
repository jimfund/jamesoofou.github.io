(function () {
    "use strict";

    const clockRoot = document.querySelector("[data-market-clock]");
    const timeRoot = document.querySelector("[data-market-time]");
    const compactClock = window.matchMedia("(max-width: 780px)");

    if (!clockRoot || !timeRoot) {
        return;
    }

    const weekdayFormatterCache = new Map();
    const partsFormatterCache = new Map();
    const timeFormatterCache = new Map();
    let calendarData = null;
    let markets = [];

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

    function marketTime(date, timeZone) {
        return formatter(timeFormatterCache, timeZone, {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
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

    function parseClockTime(value) {
        const match = /^(\d{2}):(\d{2})$/.exec(value || "");
        if (!match) {
            throw new Error(`Invalid market session time: ${value}`);
        }
        return { hour: Number(match[1]), minute: Number(match[2]) };
    }

    function normalizeMarket(key, source) {
        if (!source || !Array.isArray(source.sessions) || source.sessions.length === 0) {
            throw new Error(`Market calendar is missing ${key} sessions`);
        }
        return {
            key,
            label: source.label || key,
            clockLabel: source.clock_label || key,
            timeZone: source.time_zone,
            sessionScope: source.session_scope || "cash equities",
            confirmedThrough: source.confirmed_through,
            sessions: source.sessions.map((session) => ({
                open: parseClockTime(session.open),
                close: parseClockTime(session.close),
            })),
            closures: source.closures || {},
            earlyCloses: source.early_closes || {},
        };
    }

    function scheduleConfidence(market, date) {
        const key = dateKey(date, market.timeZone);
        if (!calendarData || key < calendarData.valid_from || key > calendarData.valid_through) {
            return "unknown";
        }
        return key <= market.confirmedThrough ? "confirmed" : "projected";
    }

    function isMarketHoliday(market, date) {
        return Object.prototype.hasOwnProperty.call(market.closures, dateKey(date, market.timeZone));
    }

    function closedDayReason(market, date) {
        const key = dateKey(date, market.timeZone);
        if (scheduleConfidence(market, date) === "unknown") {
            return "Schedule unknown";
        }
        if (isMarketHoliday(market, date)) {
            return market.closures[key] || "Holiday";
        }
        if (!isWeekday(date, market.timeZone)) {
            return "Weekend";
        }
        return "";
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
        if (scheduleConfidence(market, date) === "unknown" || !isWeekday(date, market.timeZone) || isMarketHoliday(market, date)) {
            return [];
        }

        const parts = zonedParts(date, market.timeZone);
        const special = market.earlyCloses[dateKey(date, market.timeZone)];
        const specialClose = special ? parseClockTime(special.close) : null;
        const specialCloseDate = specialClose
            ? zonedTimeToDate(market.timeZone, parts.year, parts.month, parts.day, specialClose.hour, specialClose.minute)
            : null;

        return market.sessions.map((session) => {
            const open = zonedTimeToDate(
                market.timeZone, parts.year, parts.month, parts.day, session.open.hour, session.open.minute,
            );
            const normalClose = zonedTimeToDate(
                market.timeZone, parts.year, parts.month, parts.day, session.close.hour, session.close.minute,
            );
            const close = specialCloseDate && specialCloseDate < normalClose ? specialCloseDate : normalClose;
            return {
                open,
                close,
                isEarlyClose: Boolean(specialCloseDate && close.getTime() === specialCloseDate.getTime()),
                earlyCloseReason: special ? special.reason : "",
            };
        }).filter((session) => session.open < session.close);
    }

    function nextOpen(market, now) {
        for (let dayOffset = 0; dayOffset < 32; dayOffset += 1) {
            const candidate = dayOffset === 0 ? now : addZonedDays(now, market.timeZone, dayOffset);
            if (scheduleConfidence(market, candidate) === "unknown") {
                return null;
            }
            const upcoming = sessionsForDate(market, candidate).find((session) => session.open > now);
            if (upcoming) {
                return upcoming.open;
            }
        }
        return null;
    }

    function formatDuration(milliseconds) {
        const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    function formatCompactDuration(milliseconds) {
        const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        if (days > 0) return `${days}d`;
        if (hours > 0) return `${hours}h`;
        return `${minutes}m`;
    }

    function marketStatus(market, now) {
        const confidence = scheduleConfidence(market, now);
        if (confidence === "unknown") {
            return {
                isOpen: false,
                phase: "unknown",
                confidence,
                text: "Schedule unknown",
                compactText: "Unknown",
                eventTime: null,
            };
        }

        const todaySessions = sessionsForDate(market, now);
        const openSession = todaySessions.find((session) => now >= session.open && now < session.close);
        const qualifier = confidence === "projected" ? "?" : "";
        if (openSession) {
            const closeText = openSession.isEarlyClose ? "early close" : "close";
            return {
                isOpen: true,
                phase: "open",
                confidence,
                text: `Open${qualifier} - ${closeText} in ${formatDuration(openSession.close - now)}`,
                compactText: `Open${qualifier} ${formatCompactDuration(openSession.close - now)}`,
                eventTime: openSession.close,
            };
        }

        const next = nextOpen(market, now);
        const reason = closedDayReason(market, now);
        const isBreak = todaySessions.some((session) => session.close <= now)
            && todaySessions.some((session) => session.open > now);
        if (isBreak && next) {
            return {
                isOpen: false,
                phase: "break",
                confidence,
                text: `Break${qualifier} - reopen in ${formatDuration(next - now)}`,
                compactText: `Break${qualifier} ${formatCompactDuration(next - now)}`,
                eventTime: next,
            };
        }

        const holiday = isMarketHoliday(market, now);
        const prefix = holiday ? "Holiday" : (reason || "Closed");
        return {
            isOpen: false,
            phase: holiday ? "holiday" : "closed",
            confidence,
            text: next
                ? `${prefix}${qualifier} - open in ${formatDuration(next - now)}`
                : `${prefix}${qualifier}`,
            compactText: next
                ? `${holiday ? "Holiday" : "Closed"}${qualifier} ${formatCompactDuration(next - now)}`
                : `${prefix}${qualifier}`,
            eventTime: next,
        };
    }

    function dispatchMarketState(statuses) {
        const openCount = statuses.filter((status) => status.isOpen).length;
        const unknown = statuses.some((status) => status.confidence === "unknown");
        document.documentElement.dataset.marketState = unknown ? "unknown" : (openCount > 0 ? "open" : "closed");
        document.dispatchEvent(new CustomEvent("jimfund:market-state", {
            detail: {
                anyOpen: openCount > 0,
                openCount,
                markets: statuses,
                unknown,
            },
        }));
    }

    function render() {
        const now = new Date();
        timeRoot.textContent = now.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        });

        const rows = clockRoot.querySelectorAll(".market-clock__market");
        const statuses = markets.map((market, index) => {
            const status = marketStatus(market, now);
            const row = rows[index];
            if (!row) return status;
            const statusNode = row.querySelector(".market-clock__status");
            const localNode = row.querySelector("[data-market-local]");
            if (localNode) {
                localNode.textContent = `${marketTime(now, market.timeZone)} ${market.clockLabel}`;
            }
            statusNode.textContent = compactClock.matches ? status.compactText : status.text;
            statusNode.classList.toggle("is-open", status.isOpen);
            row.classList.toggle("is-open", status.isOpen);
            row.classList.toggle("is-holiday", status.phase === "holiday");
            row.classList.toggle("is-projected", status.confidence === "projected");
            const confidenceNote = status.confidence === "projected"
                ? `; projected schedule beyond ${market.confirmedThrough}`
                : "";
            row.title = status.eventTime
                ? `${market.sessionScope}: ${status.text}; next event ${marketTime(status.eventTime, market.timeZone)} ${market.clockLabel}${confidenceNote}`
                : `${market.sessionScope}: ${status.text}${confidenceNote}`;
            return status;
        });
        dispatchMarketState(statuses);
    }

    function renderUnavailable(error) {
        timeRoot.textContent = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        });
        clockRoot.querySelectorAll(".market-clock__market").forEach((row) => {
            row.classList.remove("is-open", "is-holiday", "is-projected");
            row.querySelector(".market-clock__status").textContent = "Calendar unavailable";
            row.title = error instanceof Error ? error.message : "Unable to load market calendar";
        });
        document.documentElement.dataset.marketState = "unknown";
        document.dispatchEvent(new CustomEvent("jimfund:market-state", {
            detail: { anyOpen: false, openCount: 0, markets: [], unknown: true },
        }));
    }

    async function initialize() {
        try {
            const response = await fetch("market-calendar.json", { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`Market calendar returned ${response.status}`);
            }
            calendarData = await response.json();
            if (!calendarData || calendarData.schema_version !== 1 || !calendarData.markets) {
                throw new Error("Market calendar has an unsupported shape");
            }
            markets = ["US", "JP"].map((key) => normalizeMarket(key, calendarData.markets[key]));
            render();
            const millisecondsUntilNextMinute = 60000 - (Date.now() % 60000);
            window.setTimeout(() => {
                render();
                window.setInterval(render, 60000);
            }, millisecondsUntilNextMinute);
            compactClock.addEventListener("change", render);
        } catch (error) {
            renderUnavailable(error);
        }
    }

    initialize();
}());
