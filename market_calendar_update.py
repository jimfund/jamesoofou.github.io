#!/usr/bin/env python3
"""Generate dependency-free NYSE core and JPX cash-equity calendars."""

from __future__ import annotations

import argparse
import calendar
import json
import os
import tempfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
MINIMUM_START_YEAR = 2026
MINIMUM_END_YEAR = 2036
US_CONFIRMED_THROUGH = date(2028, 12, 31)
JP_CONFIRMED_THROUGH = date(2027, 12, 31)
SOURCE_REVIEWED_ON = date(2026, 7, 17)

US_CONFIRMED_EARLY_CLOSES = {
    2026: {
        date(2026, 11, 27): "Day after Thanksgiving",
        date(2026, 12, 24): "Christmas Eve",
    },
    2027: {
        date(2027, 11, 26): "Day after Thanksgiving",
    },
    2028: {
        date(2028, 7, 3): "Independence Day eve",
        date(2028, 11, 24): "Day after Thanksgiving",
    },
}

JAPAN_EQUINOXES = {
    2026: (date(2026, 3, 20), date(2026, 9, 23)),
    2027: (date(2027, 3, 21), date(2027, 9, 23)),
    2028: (date(2028, 3, 20), date(2028, 9, 22)),
    2029: (date(2029, 3, 20), date(2029, 9, 23)),
    2030: (date(2030, 3, 20), date(2030, 9, 23)),
    2031: (date(2031, 3, 21), date(2031, 9, 23)),
    2032: (date(2032, 3, 20), date(2032, 9, 22)),
    2033: (date(2033, 3, 20), date(2033, 9, 23)),
    2034: (date(2034, 3, 20), date(2034, 9, 23)),
    2035: (date(2035, 3, 21), date(2035, 9, 23)),
    2036: (date(2036, 3, 20), date(2036, 9, 22)),
}


def nth_weekday(year: int, month: int, weekday: int, occurrence: int) -> date:
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + 7 * (occurrence - 1))


def last_weekday(year: int, month: int, weekday: int) -> date:
    last = date(year, month, calendar.monthrange(year, month)[1])
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def easter_sunday(year: int) -> date:
    """Anonymous Gregorian computus, valid for the generated range."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return date(year, month, day)


def observed_fixed(day: date, *, saturday_observed: bool = True) -> date | None:
    if day.weekday() == calendar.SATURDAY:
        return day - timedelta(days=1) if saturday_observed else None
    if day.weekday() == calendar.SUNDAY:
        return day + timedelta(days=1)
    return day


def us_closures(year: int) -> dict[date, str]:
    closures: dict[date, str] = {}

    def add(day: date | None, reason: str) -> None:
        if day is not None and day.year == year:
            closures[day] = reason

    add(observed_fixed(date(year, 1, 1), saturday_observed=False), "New Year's Day")
    add(nth_weekday(year, 1, calendar.MONDAY, 3), "Martin Luther King Jr. Day")
    add(nth_weekday(year, 2, calendar.MONDAY, 3), "Washington's Birthday")
    add(easter_sunday(year) - timedelta(days=2), "Good Friday")
    add(last_weekday(year, 5, calendar.MONDAY), "Memorial Day")
    add(observed_fixed(date(year, 6, 19)), "Juneteenth National Independence Day")
    add(observed_fixed(date(year, 7, 4)), "Independence Day")
    add(nth_weekday(year, 9, calendar.MONDAY, 1), "Labor Day")
    add(nth_weekday(year, 11, calendar.THURSDAY, 4), "Thanksgiving Day")
    add(observed_fixed(date(year, 12, 25)), "Christmas Day")
    return closures


def projected_us_early_closes(year: int, closures: dict[date, str]) -> dict[date, str]:
    candidates = {
        date(year, 7, 3): "Independence Day eve",
        nth_weekday(year, 11, calendar.THURSDAY, 4) + timedelta(days=1): "Day after Thanksgiving",
        date(year, 12, 24): "Christmas Eve",
    }
    return {
        day: reason
        for day, reason in candidates.items()
        if day.weekday() < calendar.SATURDAY and day not in closures
    }


def japanese_base_holidays(year: int) -> dict[date, str]:
    if year in JAPAN_EQUINOXES:
        vernal, autumnal = JAPAN_EQUINOXES[year]
    elif 1980 <= year <= 2099:
        offset = year - 1980
        vernal = date(year, 3, int(20.8431 + 0.242194 * offset - offset // 4))
        autumnal = date(year, 9, int(23.2488 + 0.242194 * offset - offset // 4))
    else:
        raise ValueError(f"No supported equinox projection for {year}")
    return {
        date(year, 1, 1): "New Year's Day",
        nth_weekday(year, 1, calendar.MONDAY, 2): "Coming of Age Day",
        date(year, 2, 11): "National Foundation Day",
        date(year, 2, 23): "Emperor's Birthday",
        vernal: "Vernal Equinox Day",
        date(year, 4, 29): "Showa Day",
        date(year, 5, 3): "Constitution Memorial Day",
        date(year, 5, 4): "Greenery Day",
        date(year, 5, 5): "Children's Day",
        nth_weekday(year, 7, calendar.MONDAY, 3): "Marine Day",
        date(year, 8, 11): "Mountain Day",
        nth_weekday(year, 9, calendar.MONDAY, 3): "Respect for the Aged Day",
        autumnal: "Autumnal Equinox Day",
        nth_weekday(year, 10, calendar.MONDAY, 2): "Sports Day",
        date(year, 11, 3): "Culture Day",
        date(year, 11, 23): "Labor Thanksgiving Day",
    }


def japanese_public_holidays(year: int) -> dict[date, str]:
    holidays = japanese_base_holidays(year)

    for holiday, reason in sorted(list(holidays.items())):
        if holiday.weekday() != calendar.SUNDAY:
            continue
        substitute = holiday + timedelta(days=1)
        while substitute in holidays:
            substitute += timedelta(days=1)
        if substitute.year == year:
            holidays[substitute] = f"Substitute holiday for {reason}"

    changed = True
    while changed:
        changed = False
        ordered = sorted(holidays)
        for previous, following in zip(ordered, ordered[1:]):
            candidate = previous + timedelta(days=1)
            if following - previous == timedelta(days=2) and candidate.weekday() < calendar.SATURDAY and candidate not in holidays:
                holidays[candidate] = "Citizen's Holiday"
                changed = True
    return holidays


def jpx_closures(year: int) -> dict[date, str]:
    closures = japanese_public_holidays(year)
    closures[date(year, 1, 2)] = "Exchange New Year closure"
    closures[date(year, 1, 3)] = "Exchange New Year closure"
    closures[date(year, 12, 31)] = "Exchange year-end closure"
    return closures


def serialize_dates(values: dict[date, Any]) -> dict[str, Any]:
    return {day.isoformat(): values[day] for day in sorted(values)}


def build_calendar(start_year: int, end_year: int, generated_at: datetime | None = None) -> dict[str, Any]:
    if start_year < MINIMUM_START_YEAR or end_year < start_year or end_year > 2099:
        raise ValueError(f"Calendar bounds must be within {MINIMUM_START_YEAR}-2099")

    all_us_closures: dict[date, str] = {}
    all_us_early: dict[date, dict[str, str]] = {}
    all_jp_closures: dict[date, str] = {}
    for year in range(start_year, end_year + 1):
        year_closures = us_closures(year)
        all_us_closures.update(year_closures)
        if year <= US_CONFIRMED_THROUGH.year:
            early = US_CONFIRMED_EARLY_CLOSES.get(year, {})
        else:
            early = projected_us_early_closes(year, year_closures)
        all_us_early.update({day: {"close": "13:00", "reason": reason} for day, reason in early.items()})
        all_jp_closures.update(jpx_closures(year))

    for day in all_us_early:
        if day in all_us_closures or day.weekday() >= calendar.SATURDAY:
            raise ValueError(f"Invalid U.S. early close on {day}")

    timestamp = (generated_at or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": timestamp.isoformat().replace("+00:00", "Z"),
        "source_reviewed_on": SOURCE_REVIEWED_ON.isoformat(),
        "valid_from": date(start_year, 1, 1).isoformat(),
        "valid_through": date(end_year, 12, 31).isoformat(),
        "markets": {
            "US": {
                "label": "US",
                "clock_label": "NY",
                "time_zone": "America/New_York",
                "session_scope": "NYSE core cash equities",
                "confirmed_through": US_CONFIRMED_THROUGH.isoformat(),
                "sessions": [{"open": "09:30", "close": "16:00"}],
                "closures": serialize_dates(all_us_closures),
                "early_closes": serialize_dates(all_us_early),
                "sources": [
                    "https://www.nyse.com/trade/hours-calendars",
                ],
            },
            "JP": {
                "label": "JP",
                "clock_label": "Tokyo",
                "time_zone": "Asia/Tokyo",
                "session_scope": "Tokyo Stock Exchange cash equities",
                "confirmed_through": JP_CONFIRMED_THROUGH.isoformat(),
                "sessions": [
                    {"open": "09:00", "close": "11:30"},
                    {"open": "12:30", "close": "15:30"},
                ],
                "closures": serialize_dates(all_jp_closures),
                "early_closes": {},
                "sources": [
                    "https://www.jpx.co.jp/english/corporate/about-jpx/calendar/",
                    "https://www.jpx.co.jp/english/equities/trading/domestic/01.html",
                    "https://www.nao.ac.jp/faq/a0301.html",
                ],
            },
        },
    }


def write_calendar(payload: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=output_path.parent, prefix=f".{output_path.name}.", delete=False
        ) as temporary:
            temporary.write(serialized)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_name = temporary.name
        os.replace(temporary_name, output_path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def parse_args() -> argparse.Namespace:
    current_year = datetime.now(UTC).year
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-year", type=int, default=MINIMUM_START_YEAR)
    parser.add_argument("--end-year", type=int, default=max(MINIMUM_END_YEAR, current_year + 10))
    parser.add_argument("--output", default="market-calendar.json")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = build_calendar(args.start_year, args.end_year)
    write_calendar(payload, Path(args.output))
    print(f"Updated {args.output} through {payload['valid_through']}")


if __name__ == "__main__":
    main()
