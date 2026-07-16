#!/usr/bin/env python3
"""Fetch and normalize the jimfund SKM / SoftBank portfolio data."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
from datetime import UTC, date, datetime, time as datetime_time, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

START_DATE = date(2026, 7, 15)
INITIAL_VALUE_USD = 400_000.0
INITIAL_ALLOCATION_USD = 200_000.0
SYMBOLS = ("SKM", "9984.T", "JPY=X")
CHART_HOSTS = (
    "https://query2.finance.yahoo.com",
    "https://query1.finance.yahoo.com",
)
USER_AGENT = "Mozilla/5.0 (compatible; jimfund-portfolio/1.0; +https://jimfund.com)"


class PortfolioDataError(RuntimeError):
    """Raised when source data cannot produce a trustworthy portfolio series."""


def finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def chart_url(host: str, symbol: str, now: datetime) -> str:
    start = datetime.combine(START_DATE - timedelta(days=10), datetime_time(), tzinfo=UTC)
    end = now.astimezone(UTC) + timedelta(days=2)
    params = urlencode(
        {
            "period1": int(start.timestamp()),
            "period2": int(end.timestamp()),
            "interval": "1d",
            "events": "div,splits",
        }
    )
    return f"{host}/v8/finance/chart/{quote(symbol, safe='')}?{params}"


def fetch_chart(symbol: str, now: datetime, attempts_per_host: int = 2) -> dict[str, Any]:
    errors: list[str] = []
    for host in CHART_HOSTS:
        for attempt in range(attempts_per_host):
            request = Request(
                chart_url(host, symbol, now),
                headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            )
            try:
                with urlopen(request, timeout=20) as response:
                    if response.status != 200:
                        raise PortfolioDataError(f"HTTP {response.status}")
                    payload = json.load(response)
                if not isinstance(payload, dict):
                    raise PortfolioDataError("response was not a JSON object")
                return payload
            except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, PortfolioDataError) as error:
                errors.append(f"{host} attempt {attempt + 1}: {error}")
                if attempt + 1 < attempts_per_host:
                    time.sleep(1.5 * (attempt + 1))
    raise PortfolioDataError(f"Unable to fetch {symbol}: {'; '.join(errors)}")


def parse_chart(payload: dict[str, Any], symbol: str) -> dict[str, dict[str, float]]:
    try:
        chart = payload["chart"]
        if chart.get("error"):
            raise PortfolioDataError(f"Yahoo returned an error for {symbol}: {chart['error']}")
        result = chart["result"][0]
        timestamps = result["timestamp"]
        quote_data = result["indicators"]["quote"][0]
        closes = quote_data["close"]
        adjusted_sets = result["indicators"].get("adjclose") or []
        adjusted = adjusted_sets[0].get("adjclose", closes) if adjusted_sets else closes
        timezone_name = result["meta"]["exchangeTimezoneName"]
        timezone = ZoneInfo(timezone_name)
    except (KeyError, IndexError, TypeError, ZoneInfoNotFoundError) as error:
        raise PortfolioDataError(f"Malformed Yahoo response for {symbol}: {error}") from error

    bars: dict[str, dict[str, float]] = {}
    for timestamp, close_value, adjusted_value in zip(timestamps, closes, adjusted, strict=False):
        close = finite_number(close_value)
        adjusted_close = finite_number(adjusted_value)
        if close is None or adjusted_close is None or close <= 0 or adjusted_close <= 0:
            continue
        day = datetime.fromtimestamp(timestamp, timezone).date().isoformat()
        bars[day] = {"close": close, "adjusted_close": adjusted_close}

    if not bars:
        raise PortfolioDataError(f"Yahoo returned no usable daily bars for {symbol}")
    return bars


def valuation_cutoff(now: datetime) -> date:
    """Only admit today's bars after all three daily markets have completed."""
    utc_now = now.astimezone(UTC)
    if utc_now.time() < datetime_time(23, 0):
        return utc_now.date() - timedelta(days=1)
    return utc_now.date()


def latest_bar_on_or_before(
    bars: dict[str, dict[str, float]], day: str
) -> dict[str, float] | None:
    eligible = [bar_day for bar_day in bars if bar_day <= day]
    return bars[max(eligible)] if eligible else None


def rounded(value: float, places: int = 2) -> float:
    return round(value, places)


def build_dataset(
    market_data: dict[str, dict[str, dict[str, float]]], now: datetime
) -> dict[str, Any]:
    start_key = START_DATE.isoformat()
    cutoff_key = valuation_cutoff(now).isoformat()
    for symbol in SYMBOLS:
        if symbol not in market_data:
            raise PortfolioDataError(f"Missing market series for {symbol}")
        if start_key not in market_data[symbol]:
            raise PortfolioDataError(f"{symbol} has no closing value on {start_key}")

    candidate_days = sorted(
        {
            day
            for symbol in SYMBOLS
            for day in market_data[symbol]
            if start_key <= day <= cutoff_key
        }
    )
    if not candidate_days:
        raise PortfolioDataError("No portfolio dates are available at or before the cutoff")

    base_skm = market_data["SKM"][start_key]["adjusted_close"]
    base_softbank = market_data["9984.T"][start_key]["adjusted_close"]
    base_usd_jpy = market_data["JPY=X"][start_key]["close"]
    series: list[dict[str, Any]] = []

    for day in candidate_days:
        skm = latest_bar_on_or_before(market_data["SKM"], day)
        softbank = latest_bar_on_or_before(market_data["9984.T"], day)
        usd_jpy = latest_bar_on_or_before(market_data["JPY=X"], day)
        if skm is None or softbank is None or usd_jpy is None:
            continue

        skm_value = INITIAL_ALLOCATION_USD * skm["adjusted_close"] / base_skm
        softbank_value = (
            INITIAL_ALLOCATION_USD
            * softbank["adjusted_close"]
            / base_softbank
            * base_usd_jpy
            / usd_jpy["close"]
        )
        total_value = skm_value + softbank_value
        series.append(
            {
                "date": day,
                "value_usd": rounded(total_value),
                "profit_loss_usd": rounded(total_value - INITIAL_VALUE_USD),
                "return_pct": rounded((total_value / INITIAL_VALUE_USD - 1) * 100, 6),
                "skm": {
                    "close_usd": rounded(skm["close"], 4),
                    "value_usd": rounded(skm_value),
                    "return_pct": rounded((skm_value / INITIAL_ALLOCATION_USD - 1) * 100, 6),
                    "weight_pct": rounded(skm_value / total_value * 100, 6),
                },
                "softbank": {
                    "close_jpy": rounded(softbank["close"], 4),
                    "value_usd": rounded(softbank_value),
                    "return_pct": rounded((softbank_value / INITIAL_ALLOCATION_USD - 1) * 100, 6),
                    "weight_pct": rounded(softbank_value / total_value * 100, 6),
                },
                "usd_jpy": rounded(usd_jpy["close"], 6),
            }
        )

    if not series or series[0]["date"] != start_key:
        raise PortfolioDataError("The normalized portfolio series does not begin on its start date")
    if abs(series[0]["value_usd"] - INITIAL_VALUE_USD) > 0.01:
        raise PortfolioDataError("The initial normalized portfolio value is not $400,000")

    return {
        "schema_version": 1,
        "generated_at": now.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": {
            "name": "Yahoo Finance",
            "type": "unofficial chart feed",
            "symbols": {"sk_telecom": "SKM", "softbank": "9984.T", "usd_jpy": "JPY=X"},
        },
        "portfolio": {
            "currency": "USD",
            "start_date": start_key,
            "initial_value_usd": INITIAL_VALUE_USD,
            "initial_allocations_usd": {"SKM": INITIAL_ALLOCATION_USD, "9984.T": INITIAL_ALLOCATION_USD},
            "strategy": "buy-and-hold",
            "rebalanced": False,
            "return_method": "adjusted close with dividends reinvested",
        },
        "latest": series[-1],
        "series": series,
    }


def datasets_match(existing: dict[str, Any], new: dict[str, Any]) -> bool:
    comparable_existing = {key: value for key, value in existing.items() if key != "generated_at"}
    comparable_new = {key: value for key, value in new.items() if key != "generated_at"}
    return comparable_existing == comparable_new


def write_dataset(dataset: dict[str, Any], output_path: Path) -> bool:
    if output_path.exists():
        try:
            existing = json.loads(output_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing = None
        if isinstance(existing, dict):
            old_date = str(existing.get("latest", {}).get("date", ""))
            new_date = str(dataset.get("latest", {}).get("date", ""))
            if old_date and new_date < old_date:
                raise PortfolioDataError(f"Refusing to replace {old_date} data with older {new_date} data")
            if datasets_match(existing, dataset):
                print(f"Portfolio data is unchanged through {new_date}")
                return False

    output_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(dataset, indent=2, sort_keys=False) + "\n"
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
    print(f"Updated {output_path} through {dataset['latest']['date']}")
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="portfolio-data.json", help="JSON file to create or update")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    now = datetime.now(UTC)
    market_data = {symbol: parse_chart(fetch_chart(symbol, now), symbol) for symbol in SYMBOLS}
    write_dataset(build_dataset(market_data, now), Path(args.output))


if __name__ == "__main__":
    main()
