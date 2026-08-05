(() => {
    "use strict";

    const params = new URLSearchParams(window.location.search);
    if (!params.has("doodle") || params.get("doodle") === "0") return;

    const posters = Array.from(document.querySelectorAll(".archive-poster[data-doodle-key]"));
    if (!posters.length) return;

    const STORAGE_PREFIX = "jimfund:doodle:v1:";
    const SVG_NS = "http://www.w3.org/2000/svg";
    const states = new Map();
    const canvases = new Map();
    let activePoster = posters[0];
    let activeStroke = null;

    document.body.classList.add("is-doodling");

    const toolbar = document.createElement("div");
    toolbar.className = "doodle-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Poster doodle controls");

    const posterLabel = document.createElement("span");
    posterLabel.className = "doodle-toolbar__poster";

    const colorLabel = document.createElement("label");
    colorLabel.className = "doodle-toolbar__field";
    colorLabel.append("Ink ");
    const colorInput = document.createElement("input");
    colorInput.className = "doodle-toolbar__color";
    colorInput.type = "color";
    colorInput.value = "#111111";
    colorInput.setAttribute("aria-label", "Ink color");
    colorLabel.append(colorInput);

    const sizeLabel = document.createElement("label");
    sizeLabel.className = "doodle-toolbar__field";
    sizeLabel.append("Size ");
    const sizeInput = document.createElement("input");
    sizeInput.className = "doodle-toolbar__size";
    sizeInput.type = "range";
    sizeInput.min = "1";
    sizeInput.max = "24";
    sizeInput.step = "0.5";
    sizeInput.value = "5";
    sizeInput.setAttribute("aria-label", "Brush size");
    sizeLabel.append(sizeInput);

    const touchLabel = document.createElement("label");
    touchLabel.className = "doodle-toolbar__field";
    const touchInput = document.createElement("input");
    touchInput.type = "checkbox";
    touchInput.checked = true;
    touchLabel.append(touchInput, " Ignore touch");

    const button = (label, action) => {
        const element = document.createElement("button");
        element.type = "button";
        element.textContent = label;
        element.addEventListener("click", action);
        return element;
    };

    const status = document.createElement("span");
    status.className = "doodle-toolbar__status";
    status.setAttribute("aria-live", "polite");
    status.textContent = "Autosaves locally";

    const safeStorage = {
        get(key) {
            try {
                return window.localStorage.getItem(key);
            } catch (_error) {
                return null;
            }
        },
        set(key, value) {
            try {
                window.localStorage.setItem(key, value);
                status.textContent = "Saved locally";
            } catch (_error) {
                status.textContent = "Local save unavailable";
            }
        },
    };

    function posterKey(poster) {
        return poster.dataset.doodleKey;
    }

    function posterTitle(poster) {
        return poster.querySelector("h2")?.textContent.trim() || posterKey(poster);
    }

    function blankState(poster) {
        const rect = poster.getBoundingClientRect();
        return { width: rect.width, height: rect.height, strokes: [] };
    }

    function loadState(poster) {
        const fallback = blankState(poster);
        const raw = safeStorage.get(STORAGE_PREFIX + posterKey(poster));
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            if (
                !Number.isFinite(parsed.width)
                || !Number.isFinite(parsed.height)
                || !Array.isArray(parsed.strokes)
            ) return fallback;
            return parsed;
        } catch (_error) {
            return fallback;
        }
    }

    function saveState(poster) {
        safeStorage.set(
            STORAGE_PREFIX + posterKey(poster),
            JSON.stringify(states.get(poster)),
        );
    }

    function pressureWidth(stroke, pressure) {
        const normalized = pressure > 0 ? pressure : 0.5;
        return stroke.size * (0.35 + normalized * 1.3);
    }

    function drawStroke(context, stroke, scaleX = 1, scaleY = 1) {
        if (!stroke.points.length) return;
        const scaleWidth = (scaleX + scaleY) / 2;
        const first = stroke.points[0];
        context.fillStyle = stroke.color;
        context.beginPath();
        context.arc(
            first.x * scaleX,
            first.y * scaleY,
            pressureWidth(stroke, first.pressure) * scaleWidth / 2,
            0,
            Math.PI * 2,
        );
        context.fill();

        context.strokeStyle = stroke.color;
        context.lineCap = "round";
        context.lineJoin = "round";
        for (let index = 1; index < stroke.points.length; index += 1) {
            const previous = stroke.points[index - 1];
            const point = stroke.points[index];
            context.lineWidth = pressureWidth(
                stroke,
                (previous.pressure + point.pressure) / 2,
            ) * scaleWidth;
            context.beginPath();
            context.moveTo(previous.x * scaleX, previous.y * scaleY);
            context.lineTo(point.x * scaleX, point.y * scaleY);
            context.stroke();
        }
    }

    function render(poster) {
        const canvas = canvases.get(poster);
        const state = states.get(poster);
        const rect = poster.getBoundingClientRect();
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
        canvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        const context = canvas.getContext("2d");
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, rect.width, rect.height);
        const scaleX = rect.width / state.width;
        const scaleY = rect.height / state.height;
        state.strokes.forEach((stroke) => drawStroke(context, stroke, scaleX, scaleY));
    }

    function setActive(poster) {
        activePoster.classList.remove("is-doodle-active");
        activePoster = poster;
        activePoster.classList.add("is-doodle-active");
        posterLabel.textContent = posterTitle(poster);
    }

    function eventPoint(event, poster) {
        const rect = poster.getBoundingClientRect();
        const state = states.get(poster);
        return {
            x: (event.clientX - rect.left) * state.width / rect.width,
            y: (event.clientY - rect.top) * state.height / rect.height,
            pressure: event.pointerType === "pen" ? event.pressure || 0.5 : 0.5,
        };
    }

    function appendPointerEvents(event, poster) {
        const events = event.getCoalescedEvents?.() || [event];
        events.forEach((sample) => activeStroke.points.push(eventPoint(sample, poster)));
        render(poster);
    }

    function startStroke(event, poster, canvas) {
        if (event.button !== 0 || (touchInput.checked && event.pointerType === "touch")) return;
        event.preventDefault();
        setActive(poster);
        canvas.setPointerCapture(event.pointerId);
        activeStroke = {
            color: colorInput.value,
            size: Number(sizeInput.value),
            points: [eventPoint(event, poster)],
        };
        states.get(poster).strokes.push(activeStroke);
        render(poster);
    }

    function moveStroke(event, poster) {
        if (!activeStroke || activePoster !== poster) return;
        event.preventDefault();
        appendPointerEvents(event, poster);
    }

    function endStroke(event, poster) {
        if (!activeStroke || activePoster !== poster) return;
        event.preventDefault();
        appendPointerEvents(event, poster);
        activeStroke = null;
        saveState(poster);
    }

    function svgNumber(value) {
        return Number(value.toFixed(2));
    }

    function makeSvg(state) {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("xmlns", SVG_NS);
        svg.setAttribute("viewBox", `0 0 ${svgNumber(state.width)} ${svgNumber(state.height)}`);
        svg.setAttribute("width", String(svgNumber(state.width)));
        svg.setAttribute("height", String(svgNumber(state.height)));
        svg.setAttribute("fill", "none");

        state.strokes.forEach((stroke) => {
            if (!stroke.points.length) return;
            const first = stroke.points[0];
            const dot = document.createElementNS(SVG_NS, "circle");
            dot.setAttribute("cx", String(svgNumber(first.x)));
            dot.setAttribute("cy", String(svgNumber(first.y)));
            dot.setAttribute("r", String(svgNumber(pressureWidth(stroke, first.pressure) / 2)));
            dot.setAttribute("fill", stroke.color);
            svg.append(dot);

            for (let index = 1; index < stroke.points.length; index += 1) {
                const previous = stroke.points[index - 1];
                const point = stroke.points[index];
                const segment = document.createElementNS(SVG_NS, "path");
                segment.setAttribute(
                    "d",
                    `M ${svgNumber(previous.x)} ${svgNumber(previous.y)} L ${svgNumber(point.x)} ${svgNumber(point.y)}`,
                );
                segment.setAttribute("stroke", stroke.color);
                segment.setAttribute(
                    "stroke-width",
                    String(svgNumber(pressureWidth(stroke, (previous.pressure + point.pressure) / 2))),
                );
                segment.setAttribute("stroke-linecap", "round");
                segment.setAttribute("stroke-linejoin", "round");
                svg.append(segment);
            }
        });

        return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`;
    }

    function filenameFor(poster) {
        return `${posterKey(poster).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.svg`;
    }

    function downloadPoster(poster) {
        const state = states.get(poster);
        if (!state.strokes.length) return false;
        const url = URL.createObjectURL(new Blob([makeSvg(state)], { type: "image/svg+xml" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filenameFor(poster);
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    }

    const undoButton = button("Undo", () => {
        const state = states.get(activePoster);
        state.strokes.pop();
        saveState(activePoster);
        render(activePoster);
    });

    const clearButton = button("Clear", () => {
        const state = states.get(activePoster);
        if (!state.strokes.length || !window.confirm(`Clear the doodle on “${posterTitle(activePoster)}”?`)) return;
        state.strokes = [];
        saveState(activePoster);
        render(activePoster);
    });

    const downloadButton = button("Download SVG", () => {
        status.textContent = downloadPoster(activePoster) ? "SVG downloaded" : "Draw something first";
    });

    const downloadAllButton = button("Download all", () => {
        const drawnPosters = posters.filter((poster) => states.get(poster).strokes.length);
        drawnPosters.forEach((poster, index) => {
            window.setTimeout(() => downloadPoster(poster), index * 150);
        });
        status.textContent = drawnPosters.length ? `Downloading ${drawnPosters.length} SVGs` : "Draw something first";
    });

    const exitButton = button("Exit", () => {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("doodle");
        window.location.assign(nextUrl);
    });

    toolbar.append(
        posterLabel,
        colorLabel,
        sizeLabel,
        touchLabel,
        undoButton,
        clearButton,
        downloadButton,
        downloadAllButton,
        exitButton,
        status,
    );
    document.body.append(toolbar);

    posters.forEach((poster) => {
        const canvas = document.createElement("canvas");
        canvas.className = "doodle-canvas";
        canvas.setAttribute("aria-label", `Drawing surface for ${posterTitle(poster)}`);
        poster.append(canvas);
        canvases.set(poster, canvas);
        states.set(poster, loadState(poster));
        canvas.addEventListener("pointerdown", (event) => startStroke(event, poster, canvas));
        canvas.addEventListener("pointermove", (event) => moveStroke(event, poster));
        canvas.addEventListener("pointerup", (event) => endStroke(event, poster));
        canvas.addEventListener("pointercancel", (event) => endStroke(event, poster));
        render(poster);
    });

    let resizeFrame = null;
    window.addEventListener("resize", () => {
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
            posters.forEach(render);
            resizeFrame = null;
        });
    });

    setActive(activePoster);
})();
