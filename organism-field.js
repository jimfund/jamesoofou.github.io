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

    const gridSize = 18;
    const minSpacing = 8.5;
    const cells = [];
    const links = [];
    const tips = [];
    const pulses = [];
    const occupied = new Map();
    let sources = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let maxCells = 900;
    let rootIndex = 0;
    let startTime = performance.now();
    let lastTime = startTime;
    let growthCredit = 0;
    let tipCursor = 0;
    let lastInteractionPulse = 0;
    let lastPulseTarget = null;
    let lastRadioPulse = 0;
    let radioPulseSequence = 0;
    let radioSignalSeed = hash("radio:unidentified");
    let animationFrame = 0;

    function marketDriveFor(state) {
        if (state === "open") return 1;
        if (state === "closed") return 0.54;
        return 0.34;
    }

    let marketDriveTarget = marketDriveFor(document.documentElement.dataset.marketState);
    let marketDrive = marketDriveTarget;
    let radioDriveTarget = document.documentElement.dataset.radioState === "playing" ? 1 : 0;
    let radioDrive = radioDriveTarget;

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

    function angleDifference(a, b) {
        return Math.atan2(Math.sin(a - b), Math.cos(a - b));
    }

    function mixAngles(a, b, amount) {
        return a - angleDifference(a, b) * amount;
    }

    function resize() {
        const rect = root.getBoundingClientRect();
        dpr = Math.min(2, window.devicePixelRatio || 1);
        width = Math.max(1, Math.floor(rect.width));
        height = Math.max(1, Math.floor(rect.height));
        maxCells = Math.min(1900, Math.max(760, Math.floor((width * height) / 275)));
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        collectSources();
    }

    function collectSources() {
        const rootRect = root.getBoundingClientRect();
        const rows = Array.from(root.querySelectorAll(".archive-list__entry"));

        sources = rows.map((row, index) => {
            const rect = row.getBoundingClientRect();
            const x = clamp(rect.left + rect.width * 0.68 - rootRect.left, 22, width - 22);
            const y = clamp(rect.top + rect.height * 0.5 - rootRect.top, 22, height - 22);
            return {
                element: row,
                x,
                y,
                radius: Math.max(84, Math.min(150, rect.width * 0.18)),
                strength: 1.25 - index * 0.045,
                charge: 1,
                visits: 0,
                visible: true,
            };
        });

        const substrateSeed = hash(`${width}:${height}:substrate`);
        const rng = randomFrom(substrateSeed);
        for (let index = 0; index < 16; index += 1) {
            const column = index % 4;
            const row = Math.floor(index / 4);
            sources.push({
                element: root,
                x: width * (0.16 + column * 0.23 + (rng() - 0.5) * 0.07),
                y: height * (0.18 + row * 0.21 + (rng() - 0.5) * 0.08),
                radius: 125,
                strength: 0.28,
                charge: 1,
                visits: 0,
                visible: false,
            });
        }

        if (!sources.length) {
            sources = [
                {
                    element: root,
                    x: width * 0.48,
                    y: height * 0.45,
                    radius: 140,
                    strength: 1,
                    charge: 1,
                    visits: 0,
                    visible: true,
                },
            ];
        }
    }

    function cellBucketKey(x, y) {
        return `${Math.floor(x / gridSize)}:${Math.floor(y / gridSize)}`;
    }

    function rememberCell(index) {
        const cell = cells[index];
        const key = cellBucketKey(cell.x, cell.y);
        if (!occupied.has(key)) {
            occupied.set(key, []);
        }
        occupied.get(key).push(index);
    }

    function nearbyCellIndexes(x, y, radius) {
        const indexes = [];
        const gx = Math.floor(x / gridSize);
        const gy = Math.floor(y / gridSize);
        const reach = Math.ceil(radius / gridSize);

        for (let ox = -reach; ox <= reach; ox += 1) {
            for (let oy = -reach; oy <= reach; oy += 1) {
                const bucket = occupied.get(`${gx + ox}:${gy + oy}`);
                if (bucket) {
                    indexes.push(...bucket);
                }
            }
        }

        return indexes;
    }

    function withinField(x, y) {
        return x > 8 && y > 8 && x < width - 8 && y < height - 8;
    }

    function nearestCell(x, y, radius, exclude) {
        let bestIndex = -1;
        let bestDistance = radius * radius;
        nearbyCellIndexes(x, y, radius).forEach((index) => {
            if (index === exclude) {
                return;
            }

            const cell = cells[index];
            const dx = cell.x - x;
            const dy = cell.y - y;
            const distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        });

        return bestIndex;
    }

    function tooClose(x, y, parentIndex) {
        return nearestCell(x, y, minSpacing, parentIndex) !== -1;
    }

    function linkExists(a, b) {
        return links.some((link) => {
            return (link.a === a && link.b === b) || (link.a === b && link.b === a);
        });
    }

    function addLink(a, b, elapsed, fusion) {
        if (a === b || linkExists(a, b)) {
            return;
        }

        links.push({
            a,
            b,
            born: elapsed,
            fusion,
        });
        cells[a].neighbors.push(b);
        cells[b].neighbors.push(a);
    }

    function addCell(x, y, parent, angle, depth, seed, elapsed) {
        const index = cells.length;
        cells.push({
            x,
            y,
            parent,
            angle,
            depth,
            seed,
            born: elapsed,
            visits: 0,
            neighbors: [],
        });
        rememberCell(index);

        if (parent >= 0) {
            addLink(parent, index, elapsed, false);
        }

        sources.forEach((source) => {
            const dx = source.x - x;
            const dy = source.y - y;
            if (dx * dx + dy * dy < source.radius * source.radius) {
                source.visits += 1;
                source.charge = clamp(1 / (1 + source.visits * 0.045), 0.16, 1);
            }
        });

        return index;
    }

    function addTip(cellIndex, angle, seed, vigor) {
        if (tips.length > 190) {
            return;
        }

        tips.push({
            cell: cellIndex,
            angle,
            seed,
            vigor,
            age: 0,
            failed: 0,
        });
    }

    function resetOrganism() {
        cells.length = 0;
        links.length = 0;
        tips.length = 0;
        pulses.length = 0;
        occupied.clear();
        collectSources();

        const seed = hash(`${width}:${height}:cyberred-mycelium`);
        const rootX = width - Math.max(32, width * 0.035);
        const rootY = height - Math.max(28, height * 0.055);
        const nearestSource = sources.reduce((best, source) => {
            const dx = source.x - rootX;
            const dy = source.y - rootY;
            const distance = dx * dx + dy * dy;
            return distance < best.distance ? { source, distance } : best;
        }, { source: sources[0], distance: Infinity }).source;
        const baseAngle = Math.atan2(nearestSource.y - rootY, nearestSource.x - rootX);

        startTime = performance.now();
        lastTime = startTime;
        growthCredit = 0;
        tipCursor = 0;
        lastInteractionPulse = 0;
        lastPulseTarget = null;
        lastRadioPulse = 0;
        radioPulseSequence = 0;
        rootIndex = addCell(rootX, rootY, -1, baseAngle, 0, seed, 0);

        const rng = randomFrom(seed);
        for (let index = 0; index < 9; index += 1) {
            const offset = -0.82 + index * 0.205;
            addTip(rootIndex, baseAngle + offset, seed ^ hash(`root-tip:${index}:${rng()}`), 1);
        }
    }

    function nutrientVector(cell) {
        let x = 0;
        let y = 0;
        let weight = 0;

        sources.forEach((source) => {
            const dx = source.x - cell.x;
            const dy = source.y - cell.y;
            const distanceSquared = dx * dx + dy * dy + 380;
            const distance = Math.sqrt(distanceSquared);
            const pull = (source.strength * source.charge * source.radius) / distanceSquared;
            x += (dx / distance) * pull;
            y += (dy / distance) * pull;
            weight += pull;
        });

        return {
            x,
            y,
            weight,
        };
    }

    function crowdingVector(cell) {
        let x = 0;
        let y = 0;

        nearbyCellIndexes(cell.x, cell.y, 42).forEach((index) => {
            const other = cells[index];
            if (!other || other === cell) {
                return;
            }

            const dx = cell.x - other.x;
            const dy = cell.y - other.y;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared > 0 && distanceSquared < 42 * 42) {
                const force = 1 / distanceSquared;
                x += dx * force;
                y += dy * force;
            }
        });

        return { x, y };
    }

    function chooseTip() {
        if (!tips.length) {
            return null;
        }

        tipCursor %= tips.length;
        const tip = tips[tipCursor];
        tipCursor = (tipCursor + 1) % tips.length;
        return tip;
    }

    function retireTip(tip) {
        const index = tips.indexOf(tip);
        if (index >= 0) {
            tips.splice(index, 1);
            if (tipCursor > index) {
                tipCursor -= 1;
            }
        }
    }

    function reviveTip(elapsed) {
        if (!cells.length || tips.length > 40) {
            return;
        }

        let bestSource = sources[0];
        sources.forEach((source) => {
            if (source.charge * source.strength > bestSource.charge * bestSource.strength) {
                bestSource = source;
            }
        });

        let bestCell = rootIndex;
        let bestScore = Infinity;
        cells.forEach((cell, index) => {
            if (elapsed - cell.born < 4) {
                return;
            }

            const dx = bestSource.x - cell.x;
            const dy = bestSource.y - cell.y;
            const score = dx * dx + dy * dy - cell.depth * 8;
            if (score < bestScore) {
                bestScore = score;
                bestCell = index;
            }
        });

        const cell = cells[bestCell];
        addTip(bestCell, Math.atan2(bestSource.y - cell.y, bestSource.x - cell.x), cell.seed ^ hash(`revive:${elapsed}:${tips.length}`), 0.72);
    }

    function growOne(elapsed) {
        if (cells.length >= maxCells) {
            return;
        }

        if (!tips.length) {
            reviveTip(elapsed);
        }

        const tip = chooseTip();
        if (!tip) {
            return;
        }

        const parent = cells[tip.cell];
        const rng = randomFrom(tip.seed + Math.round(tip.age * 1000) + tip.failed * 131);
        const nutrient = nutrientVector(parent);
        const crowding = crowdingVector(parent);
        const saturation = cells.length / maxCells;
        const branchChance = clamp(0.12 + nutrient.weight * 8 - saturation * 0.08, 0.06, 0.34);

        for (let attempt = 0; attempt < 12; attempt += 1) {
            const exploratoryAngle = tip.angle + (rng() - 0.5) * (0.46 + attempt * 0.13);
            let vx = Math.cos(exploratoryAngle) * 0.74 + nutrient.x * 120 + crowding.x * 210;
            let vy = Math.sin(exploratoryAngle) * 0.74 + nutrient.y * 120 + crowding.y * 210;

            if (Math.abs(vx) + Math.abs(vy) < 0.001) {
                vx = Math.cos(tip.angle);
                vy = Math.sin(tip.angle);
            }

            const desiredAngle = Math.atan2(vy, vx);
            const nextAngle = mixAngles(tip.angle, desiredAngle, 0.68);
            const distance = 7.8 + rng() * 6.2 + nutrient.weight * 62;
            const x = parent.x + Math.cos(nextAngle) * distance;
            const y = parent.y + Math.sin(nextAngle) * distance * 0.86;

            if (!withinField(x, y)) {
                continue;
            }

            const fusionTarget = nearestCell(x, y, 16, parent.parent);
            if (fusionTarget !== -1 && fusionTarget !== parent.parent && fusionTarget !== tip.cell) {
                const target = cells[fusionTarget];
                if (Math.abs(target.depth - parent.depth) > 3 || rng() > 0.58) {
                    addLink(tip.cell, fusionTarget, elapsed, true);
                    if (rng() > 0.35) {
                        tip.cell = fusionTarget;
                        tip.angle = mixAngles(tip.angle, Math.atan2(target.y - parent.y, target.x - parent.x), 0.45);
                        tip.age = Math.max(0, tip.age - 10);
                        tip.failed = 0;
                    } else {
                        retireTip(tip);
                    }
                    return;
                }
            }

            if (tooClose(x, y, tip.cell)) {
                continue;
            }

            const seed = parent.seed ^ hash(`${Math.round(x)}:${Math.round(y)}:${cells.length}`);
            const childIndex = addCell(x, y, tip.cell, nextAngle, parent.depth + 1, seed, elapsed);
            tip.cell = childIndex;
            tip.angle = nextAngle;
            tip.age += 1;
            tip.vigor *= 0.993;
            tip.failed = 0;

            if (rng() < branchChance && tips.length < 190) {
                const branchDirection = rng() > 0.5 ? 1 : -1;
                addTip(childIndex, nextAngle + branchDirection * (0.54 + rng() * 0.52), seed ^ hash(`branch:${cells.length}`), tip.vigor * 0.88);
            }

            if (rng() > 0.965 && tips.length < 190) {
                addTip(childIndex, nextAngle + (rng() > 0.5 ? 1.35 : -1.35), seed ^ hash(`wide:${cells.length}`), tip.vigor * 0.68);
            }

            if (tip.vigor < 0.18 || tip.age > 120 || rng() < saturation * 0.012) {
                retireTip(tip);
            }
            return;
        }

        tip.failed += 1;
        if (tip.failed > 4) {
            retireTip(tip);
        }
    }

    function visibleCells(elapsed) {
        return cells.filter((cell) => elapsed >= cell.born);
    }

    function drawMembrane(elapsed) {
        const visible = visibleCells(elapsed);
        if (visible.length < 12) {
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
        context.strokeStyle = "rgba(227, 56, 33, 0.04)";
        context.lineWidth = 1;
        context.stroke();
    }

    function drawNutrients(elapsed) {
        sources.forEach((source) => {
            if (!source.visible || source.visits === 0) {
                return;
            }

            const alpha = clamp((1 - source.charge) * 0.05, 0.008, 0.04);
            context.beginPath();
            context.arc(source.x, source.y, 1.5 + Math.sin(elapsed * 1.6 + source.y) * 0.25, 0, Math.PI * 2);
            context.fillStyle = `rgba(227, 56, 33, ${alpha})`;
            context.fill();
        });
    }

    function drawLinks(elapsed) {
        links.forEach((link) => {
            const age = elapsed - link.born;
            if (age < 0) {
                return;
            }

            const progress = clamp(age / 1.15, 0, 1);
            const from = cells[link.a];
            const to = cells[link.b];
            const x = from.x + (to.x - from.x) * progress;
            const y = from.y + (to.y - from.y) * progress;
            const alpha = link.fusion
                ? 0.075 + 0.06 * Math.max(0, 1 - age / 9)
                : 0.075 + 0.17 * Math.max(0, 1 - age / 42);

            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(x, y);
            context.strokeStyle = `rgba(227, 56, 33, ${alpha})`;
            context.lineWidth = link.fusion ? 0.7 : 0.82;
            context.stroke();
        });
    }

    function drawCells(elapsed, pulse) {
        const activeCells = new Set(tips.map((tip) => tip.cell));
        cells.forEach((cell, index) => {
            const age = elapsed - cell.born;
            if (age < 0) {
                return;
            }

            const isTip = activeCells.has(index);
            const progress = clamp((age + 0.2) / 0.8, 0, 1);
            const radius = (isTip ? 1.7 + Math.sin(pulse + index) * 0.26 : 0.95) * progress;
            const alpha = isTip ? 0.66 : 0.2 + 0.08 * Math.max(0, 1 - age / 30);

            context.beginPath();
            context.arc(cell.x, cell.y, radius, 0, Math.PI * 2);
            context.fillStyle = `rgba(227, 56, 33, ${alpha * progress})`;
            context.fill();
        });
    }

    function pathToRoot(startIndex) {
        const previous = new Map();
        const queue = [startIndex];
        previous.set(startIndex, -1);

        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const index = queue[cursor];
            if (index === rootIndex) {
                break;
            }

            cells[index].neighbors.forEach((neighbor) => {
                if (!previous.has(neighbor)) {
                    previous.set(neighbor, index);
                    queue.push(neighbor);
                }
            });
        }

        if (!previous.has(rootIndex)) {
            const path = [];
            let index = startIndex;
            while (index >= 0) {
                path.push(index);
                index = cells[index].parent;
            }
            return path;
        }

        const path = [];
        let index = rootIndex;
        while (index !== -1) {
            path.push(index);
            index = previous.get(index);
        }
        return path.reverse();
    }

    function visibleCellIndexNear(x, y, elapsed) {
        let bestIndex = -1;
        let bestScore = Infinity;
        let fallbackIndex = rootIndex;
        let fallbackDepth = -1;

        cells.forEach((cell, index) => {
            if (elapsed < cell.born || index === rootIndex) {
                return;
            }

            if (cell.depth > fallbackDepth) {
                fallbackDepth = cell.depth;
                fallbackIndex = index;
            }

            const dx = cell.x - x;
            const dy = cell.y - y;
            const score = dx * dx + dy * dy - cell.depth * 12;
            if (score < bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        });

        return bestIndex === -1 ? fallbackIndex : bestIndex;
    }

    function triggerPulseAt(x, y) {
        const elapsed = (performance.now() - startTime) / 1000;
        if (elapsed - lastInteractionPulse < 0.28) {
            return;
        }

        const targetIndex = visibleCellIndexNear(x, y, elapsed);
        if (targetIndex === lastPulseTarget && elapsed - lastInteractionPulse < 1.2) {
            return;
        }

        const path = pathToRoot(targetIndex);
        if (path.length > 1) {
            pulses.push({
                path,
                start: elapsed,
                duration: clamp(path.length * 0.058, 1.05, 3.7),
            });
            lastInteractionPulse = elapsed;
            lastPulseTarget = targetIndex;
        }
    }

    function elementPoint(element) {
        const rootRect = root.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return {
            x: clamp(rect.left + rect.width * 0.68 - rootRect.left, 0, width),
            y: clamp(rect.top + rect.height * 0.5 - rootRect.top, 0, height),
        };
    }

    function pulseForInteraction(target) {
        const element = target.closest && target.closest(".archive-list__entry, .market-clock__market, .market-clock__time, a");
        if (!element) {
            return;
        }

        const point = elementPoint(element);
        triggerPulseAt(point.x, point.y);
    }

    function drawPulse(signal, elapsed) {
        const progress = (elapsed - signal.start) / signal.duration;
        if (progress < 0 || progress > 1 || signal.path.length < 2) {
            return;
        }

        const travel = progress * (signal.path.length - 1);
        const segment = Math.min(signal.path.length - 2, Math.floor(travel));
        const local = travel - segment;
        const from = cells[signal.path[segment]];
        const to = cells[signal.path[segment + 1]];
        const x = from.x + (to.x - from.x) * local;
        const y = from.y + (to.y - from.y) * local;

        context.beginPath();
        const trailStart = Math.max(0, segment - 7);
        for (let index = trailStart; index <= segment; index += 1) {
            const cell = cells[signal.path[index]];
            if (index === trailStart) {
                context.moveTo(cell.x, cell.y);
            } else {
                context.lineTo(cell.x, cell.y);
            }
        }
        context.lineTo(x, y);
        context.strokeStyle = "rgba(255, 105, 84, 0.46)";
        context.lineWidth = 1.15;
        context.stroke();

        context.beginPath();
        context.arc(x, y, 2.35, 0, Math.PI * 2);
        context.fillStyle = "rgba(255, 148, 122, 0.74)";
        context.fill();

        context.beginPath();
        context.arc(x, y, 5.3, 0, Math.PI * 2);
        context.strokeStyle = "rgba(227, 56, 33, 0.22)";
        context.lineWidth = 1;
        context.stroke();
    }

    function grow(elapsed, dt) {
        const saturation = cells.length / maxCells;
        const metabolism = 0.72 + marketDrive * 0.28 + radioDrive * 0.12;
        const rate = (4.6 + 10.5 * (1 - saturation)) * metabolism;
        growthCredit += dt * rate;

        let steps = 0;
        while (growthCredit >= 1 && steps < 8 && cells.length < maxCells) {
            growOne(elapsed);
            growthCredit -= 1;
            steps += 1;
        }

        if (tips.length < 3 && cells.length < maxCells) {
            reviveTip(elapsed);
        }
    }

    function pulseFromRadio(elapsed) {
        if (radioDrive < 0.68 || !sources.length) {
            return;
        }

        const intervalSeed = hash(`${radioSignalSeed}:${radioPulseSequence}`);
        const interval = 8 + (intervalSeed % 600) / 100;
        if (elapsed - lastRadioPulse < interval) {
            return;
        }

        const visibleSources = sources.filter((source) => source.visible);
        const candidates = visibleSources.length ? visibleSources : sources;
        const source = candidates[intervalSeed % candidates.length];
        triggerPulseAt(source.x, source.y);
        lastRadioPulse = elapsed;
        radioPulseSequence += 1;
    }

    function render(now) {
        const elapsed = (now - startTime) / 1000;
        const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
        const pulse = elapsed * 3.2;
        lastTime = now;

        const easing = 1 - Math.exp(-dt * 1.4);
        marketDrive += (marketDriveTarget - marketDrive) * easing;
        radioDrive += (radioDriveTarget - radioDrive) * easing;

        grow(elapsed, dt);
        pulseFromRadio(elapsed);

        for (let index = pulses.length - 1; index >= 0; index -= 1) {
            if (elapsed - pulses[index].start > pulses[index].duration + 0.4) {
                pulses.splice(index, 1);
            }
        }

        context.clearRect(0, 0, width, height);
        context.save();
        context.globalAlpha = clamp(0.82 + marketDrive * 0.12 + radioDrive * 0.06, 0.82, 1);
        drawNutrients(elapsed);
        drawMembrane(elapsed);
        drawLinks(elapsed);
        drawCells(elapsed, pulse);
        pulses.forEach((signal) => drawPulse(signal, elapsed));
        context.restore();

        animationFrame = window.requestAnimationFrame(render);
    }

    window.addEventListener("resize", () => {
        resize();
        resetOrganism();
    });

    root.addEventListener("pointerover", (event) => {
        pulseForInteraction(event.target);
    }, { passive: true });

    root.addEventListener("focusin", (event) => {
        pulseForInteraction(event.target);
    });

    document.addEventListener("jimfund:market-state", (event) => {
        marketDriveTarget = marketDriveFor(event.detail?.unknown ? "unknown" : (event.detail?.anyOpen ? "open" : "closed"));
    });

    document.addEventListener("jimfund:radio-state", (event) => {
        const wasPlaying = radioDriveTarget > 0;
        radioDriveTarget = event.detail?.playing ? 1 : 0;
        if (event.detail?.trackId) {
            radioSignalSeed = hash(`${event.detail.trackId}:${event.detail.trackIndex ?? 0}`);
        }
        if (!wasPlaying && radioDriveTarget > 0) {
            lastRadioPulse = Math.max(0, (performance.now() - startTime) / 1000 - 5);
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            window.cancelAnimationFrame(animationFrame);
            return;
        }

        lastTime = performance.now();
        animationFrame = window.requestAnimationFrame(render);
    });

    resize();
    resetOrganism();
    animationFrame = window.requestAnimationFrame(render);
}());
