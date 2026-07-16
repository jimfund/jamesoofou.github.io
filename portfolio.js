(function () {
    "use strict";

    const root = document.querySelector("[data-portfolio-root]");
    if (!root) {
        return;
    }

    const money = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    });
    const signedMoney = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        signDisplay: "always",
        maximumFractionDigits: 0,
    });
    const signedPercent = new Intl.NumberFormat("en-US", {
        style: "percent",
        signDisplay: "always",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    const percent = new Intl.NumberFormat("en-US", {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });
    const usdPrice = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    const yenPrice = new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    });
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
    });
    const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
    });

    function node(selector, scope) {
        return (scope || root).querySelector(selector);
    }

    function parseDate(value) {
        return new Date(`${value}T12:00:00Z`);
    }

    function formatDate(value) {
        return dateFormatter.format(parseDate(value));
    }

    function setDirection(target, value) {
        target.classList.remove("is-positive", "is-negative");
        if (value > 0.000001) {
            target.classList.add("is-positive");
        } else if (value < -0.000001) {
            target.classList.add("is-negative");
        }
    }

    function renderPosition(key, position) {
        const container = node(`[data-position="${key}"]`);
        node("[data-position-value]", container).textContent = money.format(position.value_usd);
        node("[data-position-weight]", container).textContent = percent.format(position.weight_pct / 100);
        const returnNode = node("[data-position-return]", container);
        returnNode.textContent = signedPercent.format(position.return_pct / 100);
        setDirection(returnNode, position.return_pct);
        node("[data-position-close]", container).textContent = key === "skm"
            ? usdPrice.format(position.close_usd)
            : yenPrice.format(position.close_jpy);
    }

    function svgElement(name, attributes, text) {
        const element = document.createElementNS("http://www.w3.org/2000/svg", name);
        Object.entries(attributes || {}).forEach(([key, value]) => element.setAttribute(key, String(value)));
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    }

    function drawChart(series) {
        const wrapper = node("[data-chart]");
        const svg = wrapper.querySelector("svg");
        const tooltip = node("[data-chart-tooltip]");
        const bounds = wrapper.getBoundingClientRect();
        const width = Math.max(300, Math.round(bounds.width));
        const height = Math.max(260, Math.round(bounds.height));
        const margin = { top: 18, right: 18, bottom: 34, left: width < 500 ? 68 : 82 };
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;
        const values = series.map((point) => point.value_usd);
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const basePadding = Math.max(1000, (maximum - minimum) * 0.12, maximum * 0.005);
        const yMin = minimum - basePadding;
        const yMax = maximum + basePadding;
        const xAt = (index) => margin.left + (series.length === 1 ? innerWidth / 2 : index / (series.length - 1) * innerWidth);
        const yAt = (value) => margin.top + (yMax - value) / (yMax - yMin) * innerHeight;
        const points = series.map((point, index) => `${xAt(index).toFixed(2)},${yAt(point.value_usd).toFixed(2)}`);

        Array.from(svg.children).forEach((child) => {
            if (!child.matches("title, desc")) {
                child.remove();
            }
        });
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

        const definitions = svgElement("defs");
        const gradient = svgElement("linearGradient", { id: "portfolio-area-gradient", x1: "0", y1: "0", x2: "0", y2: "1" });
        gradient.append(
            svgElement("stop", { offset: "0%", "stop-color": "#9bb8cf", "stop-opacity": "0.22" }),
            svgElement("stop", { offset: "100%", "stop-color": "#9bb8cf", "stop-opacity": "0" })
        );
        definitions.append(gradient);
        svg.append(definitions);

        [0, 0.5, 1].forEach((ratio) => {
            const y = margin.top + innerHeight * ratio;
            const value = yMax - (yMax - yMin) * ratio;
            svg.append(
                svgElement("line", { class: "chart-grid", x1: margin.left, x2: width - margin.right, y1: y, y2: y }),
                svgElement("text", { class: "chart-axis-label", x: margin.left - 10, y: y + 4, "text-anchor": "end" }, money.format(value))
            );
        });

        svg.append(
            svgElement("text", { class: "chart-axis-label", x: margin.left, y: height - 9, "text-anchor": "start" }, shortDateFormatter.format(parseDate(series[0].date))),
            svgElement("text", { class: "chart-axis-label", x: width - margin.right, y: height - 9, "text-anchor": "end" }, shortDateFormatter.format(parseDate(series[series.length - 1].date)))
        );

        const baseline = margin.top + innerHeight;
        const areaPath = series.length === 1
            ? `M ${margin.left} ${yAt(values[0])} L ${width - margin.right} ${yAt(values[0])} L ${width - margin.right} ${baseline} L ${margin.left} ${baseline} Z`
            : `M ${points.join(" L ")} L ${xAt(series.length - 1)} ${baseline} L ${xAt(0)} ${baseline} Z`;
        const linePath = series.length === 1
            ? `M ${margin.left} ${yAt(values[0])} L ${width - margin.right} ${yAt(values[0])}`
            : `M ${points.join(" L ")}`;
        svg.append(
            svgElement("path", { class: "chart-area", d: areaPath }),
            svgElement("path", { class: "chart-line", d: linePath })
        );

        const focusLine = svgElement("line", {
            class: "chart-focus-line",
            y1: margin.top,
            y2: baseline,
            visibility: "hidden",
        });
        const focusDot = svgElement("circle", { class: "chart-focus-dot", r: 4, visibility: "hidden" });
        const hitArea = svgElement("rect", {
            class: "chart-hit-area",
            x: margin.left,
            y: margin.top,
            width: innerWidth,
            height: innerHeight,
        });
        svg.append(focusLine, focusDot, hitArea);

        function hideFocus() {
            focusLine.setAttribute("visibility", "hidden");
            focusDot.setAttribute("visibility", "hidden");
            tooltip.hidden = true;
        }

        function showFocus(event) {
            const rect = svg.getBoundingClientRect();
            const chartX = (event.clientX - rect.left) / rect.width * width;
            const ratio = Math.max(0, Math.min(1, (chartX - margin.left) / innerWidth));
            const index = series.length === 1 ? 0 : Math.round(ratio * (series.length - 1));
            const point = series[index];
            const x = xAt(index);
            const y = yAt(point.value_usd);
            focusLine.setAttribute("x1", x);
            focusLine.setAttribute("x2", x);
            focusLine.setAttribute("visibility", "visible");
            focusDot.setAttribute("cx", x);
            focusDot.setAttribute("cy", y);
            focusDot.setAttribute("visibility", "visible");
            tooltip.innerHTML = `${money.format(point.value_usd)}<span>${formatDate(point.date)} · ${signedPercent.format(point.return_pct / 100)}</span>`;
            tooltip.hidden = false;
            const tooltipWidth = tooltip.offsetWidth;
            const left = Math.min(wrapper.clientWidth - tooltipWidth - 8, Math.max(8, x / width * wrapper.clientWidth - tooltipWidth / 2));
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${Math.max(8, y / height * wrapper.clientHeight - 58)}px`;
        }

        hitArea.addEventListener("pointermove", showFocus);
        hitArea.addEventListener("pointerdown", showFocus);
        hitArea.addEventListener("pointerleave", hideFocus);
        hitArea.addEventListener("pointerup", hideFocus);
        hitArea.addEventListener("pointercancel", hideFocus);
    }

    function render(data) {
        if (!data || data.schema_version !== 1 || !data.latest || !Array.isArray(data.series) || data.series.length === 0) {
            throw new Error("Portfolio dataset has an unsupported shape");
        }
        const latest = data.latest;
        node("[data-total]").textContent = money.format(latest.value_usd);
        const returnNode = node("[data-return]");
        returnNode.textContent = signedPercent.format(latest.return_pct / 100);
        setDirection(returnNode, latest.return_pct);
        const profitNode = node("[data-profit]");
        profitNode.textContent = signedMoney.format(latest.profit_loss_usd);
        setDirection(profitNode, latest.profit_loss_usd);
        node("[data-date]").textContent = formatDate(latest.date);
        node("[data-chart-window]").textContent = `${data.series.length} daily ${data.series.length === 1 ? "close" : "closes"}`;
        renderPosition("skm", latest.skm);
        renderPosition("softbank", latest.softbank);
        node("[data-allocation-skm]").style.width = `${latest.skm.weight_pct}%`;
        node("[data-allocation-softbank]").style.width = `${latest.softbank.weight_pct}%`;
        node("[data-fx]").textContent = Number(latest.usd_jpy).toFixed(3);

        const generatedAt = new Date(data.generated_at);
        const ageHours = (Date.now() - generatedAt.getTime()) / 3600000;
        const status = node("[data-status]");
        status.textContent = `Cached through ${formatDate(latest.date)} · refreshed ${generatedAt.toLocaleString("en-US", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC",
            timeZoneName: "short",
        })}`;
        status.classList.toggle("is-stale", ageHours > 120);
        if (ageHours > 120) {
            status.textContent = `Stale cache · ${status.textContent}`;
        }

        drawChart(data.series);
        let resizeTimer;
        window.addEventListener("resize", function () {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => drawChart(data.series), 120);
        });
        root.setAttribute("aria-busy", "false");
    }

    fetch("portfolio-data.json", { cache: "no-store" })
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Portfolio data returned ${response.status}`);
            }
            return response.json();
        })
        .then(render)
        .catch((error) => {
            root.setAttribute("aria-busy", "false");
            node("[data-status]").textContent = "Data unavailable";
            node("[data-status]").classList.add("is-stale");
            node("[data-error]").hidden = false;
            root.title = error instanceof Error ? error.message : "Unable to load portfolio data";
        });
}());
