#!/usr/bin/env python3
"""Probe public jimfund dependencies and write a cached health observation."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

USER_AGENT = "Mozilla/5.0 (compatible; jimfund-health/1.0; +https://jimfund.com)"


def request_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None) -> Any:
    request_headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    request_headers.update(headers or {})
    request = Request(url, data=data, headers=request_headers, method="POST" if data is not None else "GET")
    with urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}")
        return json.load(response)


def observe(callable_check) -> dict[str, Any]:
    try:
        detail = callable_check()
        return {"state": "nominal", **detail}
    except HTTPError as error:
        state = "fault" if error.code in (404, 410) else "unknown"
        return {"state": state, "detail": f"HTTP {error.code}"}
    except (URLError, TimeoutError, OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        return {"state": "unknown", "detail": str(error)}


def check_track(track: dict[str, str]) -> dict[str, Any]:
    watch_url = f"https://www.youtube.com/watch?v={quote(track['id'])}"
    endpoint = "https://www.youtube.com/oembed?" + urlencode({"url": watch_url, "format": "json"})
    payload = request_json(endpoint)
    return {
        "id": track["id"],
        "title": track["title"],
        "state": "reachable",
        "observed_title": str(payload.get("title", "")),
        "note": "oEmbed reachability does not prove playback or embeddability",
    }


def check_radio(playlist_path: Path) -> dict[str, Any]:
    payload = json.loads(playlist_path.read_text(encoding="utf-8"))
    tracks = payload.get("tracks")
    if not isinstance(tracks, list) or not tracks:
        raise ValueError("playlist is empty or malformed")
    results = []
    for track in tracks:
        try:
            results.append(check_track(track))
        except HTTPError as error:
            results.append({
                "id": track.get("id", ""),
                "title": track.get("title", ""),
                "state": "fault" if error.code in (404, 410) else "unknown",
                "detail": f"HTTP {error.code}",
            })
        except (URLError, TimeoutError, OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
            results.append({
                "id": track.get("id", ""),
                "title": track.get("title", ""),
                "state": "unknown",
                "detail": str(error),
            })
    return {
        "state": "fault" if any(item["state"] == "fault" for item in results) else (
            "unknown" if any(item["state"] == "unknown" for item in results) else "nominal"
        ),
        "reachable": sum(item["state"] == "reachable" for item in results),
        "total": len(results),
        "tracks": results,
    }


def check_yahoo() -> dict[str, Any]:
    symbols: dict[str, str] = {}
    for symbol in ("SKM", "9984.T", "JPY=X"):
        endpoint = (
            "https://query2.finance.yahoo.com/v8/finance/chart/"
            f"{quote(symbol, safe='')}?range=5d&interval=1d"
        )
        payload = request_json(endpoint)
        result = payload.get("chart", {}).get("result") or []
        timestamps = result[0].get("timestamp") if result else None
        if not timestamps:
            raise RuntimeError(f"{symbol} returned no daily bars")
        symbols[symbol] = datetime.fromtimestamp(max(timestamps), UTC).date().isoformat()
    return {"symbols": symbols, "detail": "daily chart feeds responded"}


def check_hyperliquid() -> dict[str, Any]:
    payload = request_json(
        "https://api.hyperliquid.xyz/info",
        data=json.dumps({"type": "metaAndAssetCtxs", "dex": "xyz"}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    if not isinstance(payload, list) or len(payload) < 2:
        raise RuntimeError("unexpected response shape")
    universe = payload[0].get("universe", [])
    index = next((i for i, asset in enumerate(universe) if asset.get("name") == "xyz:SP500"), None)
    if index is None or index >= len(payload[1]):
        raise RuntimeError("SP500 context is missing")
    context = payload[1][index]
    price = context.get("markPx") or context.get("midPx") or context.get("oraclePx")
    if not price:
        raise RuntimeError("SP500 context has no price")
    return {"detail": "SP500 quote feed responded", "observed_price": str(price)}


def check_feed() -> dict[str, Any]:
    request = Request("https://jimfund.com/feed.xml", headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=20) as response:
        document = ElementTree.fromstring(response.read())
    items = document.findall("./channel/item")
    if not items:
        raise RuntimeError("RSS feed contains no items")
    return {"items": len(items), "detail": "RSS parsed successfully"}


def build_observation(playlist_path: Path, now: datetime | None = None) -> dict[str, Any]:
    timestamp = (now or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)
    checks = {
        "feed": observe(check_feed),
        "hyperliquid": observe(check_hyperliquid),
        "radio": check_radio(playlist_path),
        "yahoo": observe(check_yahoo),
    }
    states = [check.get("state", "unknown") for check in checks.values()]
    overall = "fault" if "fault" in states else ("unknown" if "unknown" in states else "nominal")
    return {
        "schema_version": 1,
        "observed_at": timestamp.isoformat().replace("+00:00", "Z"),
        "overall": overall,
        "checks": checks,
    }


def write_observation(payload: dict[str, Any], output_path: Path) -> None:
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--playlist", default="radio-playlist.json")
    parser.add_argument("--output", default="site-health.json")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = build_observation(Path(args.playlist))
    write_observation(payload, Path(args.output))
    print(f"Observed site health: {payload['overall']}")


if __name__ == "__main__":
    main()
