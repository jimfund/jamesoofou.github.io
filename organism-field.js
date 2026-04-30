(function () {
    const root = document.querySelector(".home-section");
    const canvas = document.querySelector("[data-organism-field]");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrowScreen = window.matchMedia("(max-width: 780px)").matches;

    if (!root || !canvas || reduceMotion || narrowScreen) {
        return;
    }

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
        return;
    }

    const spacing = 10;
    const cells = [];
    const occupied = new Map();
    let width = 0;
    let height = 0;
    let dpr = 1;
    let maxCells = 420;
    let startTime = performance.now();
    let animationFrame = 0;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function hash(value) {
        let result = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            result ^= value.charCodeAt(index);
            result = Math.imul(result, 16777619);
        }
        return result >>> 0;
    }

    function randomFrom(seed) {
        let value = seed >>> 0;
        return function () {
            value += 0x6D2B79F5;
            let next = value;
            next = Math.imul(next ^ (next >>> 15), next | 1);
            next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
            return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
        };
    }

    function resize() {
        const rect = root.getBoundingClientRect();
        dpr = Math.min(2, window.devicePixelRatio || 1);
        width = Math.max(1, Math.floor(rect.width));
        height = Math.max(1, Math.floor(rect.height));
        maxCells = Math.min(1800, Math.max(520, Math.floor((width * height) / 285)));
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function withinField(x, y) {
        return x > 10 && y > 10 && x < width - 10 && y < height - 10;
    }

    function tooClose(x, y) {
        const gx = Math.floor(x / spacing);
        const gy = Math.floor(y / spacing);

        for (let ox = -1; ox <= 1; ox += 1) {
            for (let oy = -1; oy <= 1; oy += 1) {
                const bucket = occupied.get(`${gx + ox}:${gy + oy}`);
                if (!bucket) {
                    continue;
                }

                for (const index of bucket) {
                    const cell = cells[index];
                    const dx = cell.x - x;
                    const dy = cell.y - y;
                    if (dx * dx + dy * dy < spacing * spacing) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    function rememberCell(index) {
        const cell = cells[index];
        const key = `${Math.floor(cell.x / spacing)}:${Math.floor(cell.y / spacing)}`;
        if (!occupied.has(key)) {
            occupied.set(key, []);
        }
        occupied.get(key).push(index);
    }

    function addCell(x, y, parent, angle, depth, order, seed) {
        const cell = {
            x,
            y,
            parent,
            angle,
            depth,
            seed,
            revealAt: depth * 0.34 + order * 0.085,
        };
        cells.push(cell);
        rememberCell(cells.length - 1);
        return cells.length - 1;
    }

    function tryChild(parentIndex, offset, order) {
        const parent = cells[parentIndex];
        const rng = randomFrom(parent.seed + Math.round(offset * 1000) + order * 811);

        for (let attempt = 0; attempt < 8; attempt += 1) {
            const angle = parent.angle + offset + (rng() - 0.5) * (0.74 + attempt * 0.16);
            const distance = 15 + rng() * 19 + attempt * 2;
            const x = parent.x + Math.cos(angle) * distance;
            const y = parent.y + Math.sin(angle) * distance * 0.78;

            if (!withinField(x, y) || tooClose(x, y)) {
                continue;
            }

            return addCell(
                x,
                y,
                parentIndex,
                angle,
                parent.depth + 1,
                order,
                parent.seed ^ hash(`${Math.round(x)}:${Math.round(y)}:${cells.length}`),
            );
        }

        return -1;
    }

    function buildOrganism() {
        cells.length = 0;
        occupied.clear();
        const seed = hash(`${width}:${height}:cyberred-organism`);
        const rootIndex = addCell(width * 0.5, height * 0.52, -1, 0, 0, 0, seed);
        const frontier = [];
        const rootBranches = 13;

        for (let index = 0; index < rootBranches; index += 1) {
            const angle = (index / rootBranches) * Math.PI * 2 - Math.PI;
            const child = tryChild(rootIndex, angle, index);
            if (child !== -1) {
                frontier.push(child);
            }
        }

        let order = rootBranches;
        while (frontier.length && cells.length < maxCells) {
            const parentIndex = frontier.shift();
            const parent = cells[parentIndex];
            const rng = randomFrom(parent.seed + order * 17);
            const offsets = [0];

            if (rng() > 0.22 || parent.depth % 4 === 0) {
                offsets.push(rng() > 0.5 ? 0.62 : -0.62);
            }

            if (rng() > 0.74 || parent.depth % 7 === 0) {
                offsets.push(rng() > 0.5 ? 1.08 : -1.08);
            }

            if (rng() > 0.91) {
                offsets.push(rng() > 0.5 ? 1.72 : -1.72);
            }

            offsets.forEach((offset) => {
                if (cells.length >= maxCells) {
                    return;
                }

                const child = tryChild(parentIndex, offset, order);
                order += 1;
                if (child !== -1 && cells[child].depth < 68) {
                    frontier.push(child);
                }
            });

            if (!frontier.length && cells.length < maxCells) {
                const refillStart = Math.max(0, cells.length - 220);
                for (let attempt = 0; attempt < 24 && !frontier.length; attempt += 1) {
                    const candidate = refillStart + ((order + attempt * 37) % (cells.length - refillStart));
                    if (candidate > 0) {
                        frontier.push(candidate);
                    }
                }
            }
        }

        startTime = performance.now();
    }

    function drawMembrane(elapsed) {
        const visible = cells.filter((cell) => elapsed >= cell.revealAt);
        if (visible.length < 8) {
            return;
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        visible.forEach((cell) => {
            minX = Math.min(minX, cell.x);
            minY = Math.min(minY, cell.y);
            maxX = Math.max(maxX, cell.x);
            maxY = Math.max(maxY, cell.y);
        });

        context.beginPath();
        context.ellipse(
            (minX + maxX) / 2,
            (minY + maxY) / 2,
            Math.max(18, (maxX - minX) / 2 + 18),
            Math.max(14, (maxY - minY) / 2 + 16),
            -0.08,
            0,
            Math.PI * 2,
        );
        context.strokeStyle = "rgba(227, 56, 33, 0.045)";
        context.lineWidth = 1;
        context.stroke();
    }

    function drawLink(cell, elapsed) {
        if (cell.parent < 0) {
            return;
        }

        const progress = clamp((elapsed - cell.revealAt) / 1.2, 0, 1);
        if (progress <= 0) {
            return;
        }

        const parent = cells[cell.parent];
        const x = parent.x + (cell.x - parent.x) * progress;
        const y = parent.y + (cell.y - parent.y) * progress;
        context.beginPath();
        context.moveTo(parent.x, parent.y);
        context.lineTo(x, y);
        context.strokeStyle = `rgba(227, 56, 33, ${0.07 + progress * 0.18})`;
        context.lineWidth = 0.85;
        context.stroke();
    }

    function drawCell(cell, index, elapsed, pulse) {
        const progress = clamp((elapsed - cell.revealAt + 0.32) / 0.9, 0, 1);
        if (progress <= 0) {
            return;
        }

        const isTip = elapsed >= cell.revealAt && elapsed - cell.revealAt < 2.2;
        const radius = (isTip ? 1.75 + Math.sin(pulse + index) * 0.28 : 1.05) * progress;
        const alpha = isTip ? 0.66 : 0.22;
        context.beginPath();
        context.arc(cell.x, cell.y, radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(227, 56, 33, ${alpha * progress})`;
        context.fill();
    }

    function render(now) {
        const elapsed = (now - startTime) / 1000;
        const pulse = elapsed * 3.2;

        context.clearRect(0, 0, width, height);
        drawMembrane(elapsed);
        cells.forEach((cell) => drawLink(cell, elapsed));
        cells.forEach((cell, index) => drawCell(cell, index, elapsed, pulse));

        animationFrame = window.requestAnimationFrame(render);
    }

    window.addEventListener("resize", () => {
        resize();
        buildOrganism();
    });

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            window.cancelAnimationFrame(animationFrame);
            return;
        }

        animationFrame = window.requestAnimationFrame(render);
    });

    resize();
    buildOrganism();
    animationFrame = window.requestAnimationFrame(render);
}());
