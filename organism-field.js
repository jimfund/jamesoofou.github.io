(function () {
    "use strict";

    // Direction-number parameters for the first Sobol dimensions. The organism
    // only consumes the first four, but keeping the generator general makes the
    // low-discrepancy contract testable without entangling it with the canvas.
    const SOBOL_PARAMETERS = [
        { degree: 1, coefficient: 0, initial: [1] },
        { degree: 2, coefficient: 1, initial: [1, 3] },
        { degree: 3, coefficient: 1, initial: [1, 3, 1] },
        { degree: 3, coefficient: 2, initial: [1, 1, 1] },
        { degree: 4, coefficient: 1, initial: [1, 3, 5, 13] },
        { degree: 4, coefficient: 4, initial: [1, 1, 5, 5] },
        { degree: 5, coefficient: 2, initial: [1, 3, 3, 9, 7] },
    ];
    const sobolDirectionCache = [];

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function hash(value) {
        let result = 2166136261;
        const text = String(value);
        for (let index = 0; index < text.length; index += 1) {
            result ^= text.charCodeAt(index);
            result = Math.imul(result, 16777619);
        }
        return result >>> 0;
    }

    function sobolDirections(dimension) {
        if (sobolDirectionCache[dimension]) {
            return sobolDirectionCache[dimension];
        }

        const directions = new Uint32Array(32);
        if (dimension === 0) {
            for (let bit = 1; bit <= 32; bit += 1) {
                directions[bit - 1] = (2 ** (32 - bit)) >>> 0;
            }
        } else {
            const parameters = SOBOL_PARAMETERS[dimension - 1];
            if (!parameters) {
                throw new RangeError(`Sobol dimension ${dimension + 1} is unavailable`);
            }

            const { degree, coefficient, initial } = parameters;
            for (let bit = 1; bit <= degree; bit += 1) {
                directions[bit - 1] = (initial[bit - 1] * (2 ** (32 - bit))) >>> 0;
            }
            for (let bit = degree + 1; bit <= 32; bit += 1) {
                let value = directions[bit - degree - 1]
                    ^ (directions[bit - degree - 1] >>> degree);
                for (let offset = 1; offset < degree; offset += 1) {
                    if ((coefficient >>> (degree - 1 - offset)) & 1) {
                        value ^= directions[bit - offset - 1];
                    }
                }
                directions[bit - 1] = value >>> 0;
            }
        }

        sobolDirectionCache[dimension] = directions;
        return directions;
    }

    function sobolPoint(sampleIndex, dimensions = 2) {
        if (!Number.isInteger(sampleIndex) || sampleIndex < 0 || sampleIndex > 0xFFFFFFFF) {
            throw new RangeError("Sobol sample index must be a 32-bit unsigned integer");
        }
        if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > SOBOL_PARAMETERS.length + 1) {
            throw new RangeError("Unsupported Sobol dimensionality");
        }

        const point = [];
        const grayCode = ((sampleIndex >>> 0) ^ (sampleIndex >>> 1)) >>> 0;
        for (let dimension = 0; dimension < dimensions; dimension += 1) {
            const directions = sobolDirections(dimension);
            let bits = grayCode;
            let value = 0;
            let bit = 0;
            while (bits && bit < 32) {
                if (bits & 1) {
                    value = (value ^ directions[bit]) >>> 0;
                }
                bits >>>= 1;
                bit += 1;
            }
            point.push((value >>> 0) / 4294967296);
        }
        return point;
    }

    function edgeEndpoint(edge) {
        if (typeof edge === "string" || typeof edge === "number") {
            return String(edge);
        }
        return edge && String(edge.id ?? edge.target ?? edge.to ?? "");
    }

    function normalizeArchiveGraph(rawGraph) {
        const inputNodes = Array.isArray(rawGraph) ? rawGraph : rawGraph?.nodes;
        if (!Array.isArray(inputNodes) || inputNodes.length < 2) {
            return null;
        }

        const nodes = [];
        const idToIndex = new Map();
        inputNodes.forEach((node) => {
            const id = String(node?.id ?? "");
            if (!id || idToIndex.has(id)) return;
            idToIndex.set(id, nodes.length);
            nodes.push({ id, edges: node?.edges });
        });
        if (nodes.length < 2) return null;

        const weights = nodes.map(() => new Map());
        function connect(sourceId, targetId, rawWeight) {
            const source = idToIndex.get(String(sourceId));
            const target = idToIndex.get(String(targetId));
            if (source === undefined || target === undefined || source === target) return;
            const numeric = Number(rawWeight);
            const weight = clamp(Number.isFinite(numeric) ? numeric : 1, 0.02, 4);
            weights[source].set(target, Math.max(weights[source].get(target) || 0, weight));
            weights[target].set(source, Math.max(weights[target].get(source) || 0, weight));
        }

        nodes.forEach((node) => {
            if (!Array.isArray(node.edges)) return;
            node.edges.forEach((edge) => {
                connect(
                    node.id,
                    edgeEndpoint(edge),
                    edge && typeof edge === "object" ? (edge.weight ?? edge.similarity) : 1,
                );
            });
        });
        if (Array.isArray(rawGraph?.edges)) {
            rawGraph.edges.forEach((edge) => {
                connect(edge?.source ?? edge?.from, edge?.target ?? edge?.to, edge?.similarity ?? edge?.weight);
            });
        }

        const adjacency = weights.map((neighbors) => Array.from(neighbors, ([index, weight]) => ({ index, weight })));
        if (!adjacency.some((neighbors) => neighbors.length)) return null;
        return { nodes: nodes.map(({ id }) => ({ id })), adjacency, idToIndex };
    }

    function isNormalizedArchiveGraph(graph) {
        if (
            !graph
            || !Array.isArray(graph.nodes)
            || !Array.isArray(graph.adjacency)
            || !(graph.idToIndex instanceof Map)
            || graph.nodes.length < 2
            || graph.adjacency.length !== graph.nodes.length
        ) {
            return false;
        }
        return graph.nodes.every((node, index) => {
            return node
                && typeof node.id === "string"
                && graph.idToIndex.get(node.id) === index
                && Array.isArray(graph.adjacency[index])
                && graph.adjacency[index].every((edge) => {
                    return edge
                        && Number.isInteger(edge.index)
                        && edge.index >= 0
                        && edge.index < graph.nodes.length
                        && edge.index !== index
                        && Number.isFinite(edge.weight)
                        && edge.weight > 0;
                });
        });
    }

    function createSemanticField(rawGraph) {
        const graph = isNormalizedArchiveGraph(rawGraph) ? rawGraph : normalizeArchiveGraph(rawGraph);
        if (!graph) return null;
        const size = graph.nodes.length;
        const sprottCouplings = graph.adjacency.map((neighbors, source) => {
            const total = neighbors.reduce((sum, edge) => sum + edge.weight, 0) || 1;
            return neighbors.map((edge) => {
                // Directed signs make the otherwise symmetric semantic graph
                // suitable for the bounded graph-Sprott equation used by DYMAG.
                const direction = hash(`${graph.nodes[source].id}>${graph.nodes[edge.index].id}`) & 1 ? 1 : -1;
                return { index: edge.index, weight: direction * 1.85 * edge.weight / total };
            });
        });
        return {
            graph,
            heat: new Float32Array(size),
            wave: new Float32Array(size),
            waveVelocity: new Float32Array(size),
            sprott: new Float32Array(size),
            nextHeat: new Float32Array(size),
            nextWave: new Float32Array(size),
            nextVelocity: new Float32Array(size),
            nextSprott: new Float32Array(size),
            sprottCouplings,
            sprottTime: 0,
        };
    }

    function normalizedGraphLaplacian(values, adjacency, index) {
        const neighbors = adjacency[index];
        if (!neighbors.length) return 0;
        let weighted = 0;
        let total = 0;
        neighbors.forEach((edge) => {
            weighted += edge.weight * values[edge.index];
            total += edge.weight;
        });
        return weighted / total - values[index];
    }

    function injectSemanticSignal(field, node, mode, amount = 1) {
        if (!field) return false;
        const index = typeof node === "number" ? node : field.graph.idToIndex.get(String(node));
        if (!Number.isInteger(index) || index < 0 || index >= field.graph.nodes.length) return false;
        const strength = clamp(Number(amount) || 0, -1.5, 1.5);
        if (mode === "wave") {
            field.waveVelocity[index] = clamp(field.waveVelocity[index] + strength * 1.45, -2.4, 2.4);
        } else if (mode === "sprott") {
            field.sprott[index] = clamp(field.sprott[index] + strength, -2, 2);
            field.sprottTime = Math.max(field.sprottTime, 7.5);
        } else {
            field.heat[index] = clamp(field.heat[index] + Math.abs(strength), 0, 1.5);
        }
        return true;
    }

    function stepSemanticField(field, rawDt) {
        if (!field) return;
        let remaining = clamp(Number(rawDt) || 0, 0, 0.2);
        const { adjacency } = field.graph;
        while (remaining > 0) {
            const dt = Math.min(0.025, remaining);
            for (let index = 0; index < adjacency.length; index += 1) {
                const heatLap = normalizedGraphLaplacian(field.heat, adjacency, index);
                field.nextHeat[index] = clamp(
                    field.heat[index] + dt * (1.4 * heatLap - 0.26 * field.heat[index]),
                    0,
                    1.5,
                );

                const waveLap = normalizedGraphLaplacian(field.wave, adjacency, index);
                const velocity = field.waveVelocity[index]
                    + dt * (5.2 * waveLap - 0.82 * field.waveVelocity[index] - 0.12 * field.wave[index]);
                field.nextVelocity[index] = clamp(velocity, -2.4, 2.4);
                field.nextWave[index] = clamp(field.wave[index] + dt * velocity, -1.5, 1.5);

                let coupled = 0;
                field.sprottCouplings[index].forEach((edge) => {
                    coupled += edge.weight * field.sprott[edge.index];
                });
                // Bounded graph-Sprott dynamics: du_k/dt = -b*u_k +
                // tanh(sum c_kj*u_j). It only runs after a rare explicit pulse.
                const drive = field.sprottTime > 0 ? Math.tanh(coupled) : 0;
                const damping = field.sprottTime > 0 ? 0.25 : 1.15;
                field.nextSprott[index] = clamp(
                    field.sprott[index] + dt * (-damping * field.sprott[index] + drive),
                    -4,
                    4,
                );
            }
            [field.heat, field.nextHeat] = [field.nextHeat, field.heat];
            [field.wave, field.nextWave] = [field.nextWave, field.wave];
            [field.waveVelocity, field.nextVelocity] = [field.nextVelocity, field.waveVelocity];
            [field.sprott, field.nextSprott] = [field.nextSprott, field.sprott];
            field.sprottTime = Math.max(0, field.sprottTime - dt);
            remaining -= dt;
        }
    }

    function median(values) {
        if (!values.length) return 52;
        const ordered = values.slice().sort((a, b) => a - b);
        const middle = Math.floor(ordered.length / 2);
        return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
    }

    function createReactionField(fieldWidth, fieldHeight, sourceRows = []) {
        const rowY = sourceRows.map((row) => Number(row.y)).filter(Number.isFinite).sort((a, b) => a - b);
        const gaps = rowY.slice(1).map((value, index) => value - rowY[index]).filter((gap) => gap > 8);
        // The unstable mode of the coefficients below has a wavelength near
        // 10.2 grid cells, so this makes one pattern wavelength track the
        // archive's measured row pitch. A size-derived floor caps total work.
        const spacing = Math.max(
            clamp(median(gaps) / 10.2, 4.8, 10),
            Math.sqrt((fieldWidth * fieldHeight) / 32000),
        );
        const columns = Math.max(8, Math.ceil(fieldWidth / spacing));
        const rows = Math.max(8, Math.ceil(fieldHeight / spacing));
        const size = columns * rows;
        const u = new Float32Array(size);
        const v = new Float32Array(size);

        const seeds = rowY.length ? rowY : [fieldHeight * 0.28, fieldHeight * 0.55, fieldHeight * 0.78];
        seeds.forEach((y, rowIndex) => {
            for (let seedIndex = 0; seedIndex < 5; seedIndex += 1) {
                const sample = sobolPoint(1 + rowIndex * 5 + seedIndex, 2);
                const xCell = clamp(Math.floor((0.08 + sample[0] * 0.84) * columns), 1, columns - 2);
                const yCell = clamp(Math.round(y / fieldHeight * (rows - 1) + (sample[1] - 0.5) * 1.5), 1, rows - 2);
                for (let oy = -1; oy <= 1; oy += 1) {
                    for (let ox = -1; ox <= 1; ox += 1) {
                        const index = (yCell + oy) * columns + xCell + ox;
                        const falloff = ox === 0 && oy === 0 ? 1 : 0.62;
                        const sign = (rowIndex + seedIndex) % 2 ? -1 : 1;
                        u[index] += sign * 0.1 * falloff;
                        v[index] -= sign * 0.065 * falloff;
                    }
                }
            }
        });

        return {
            width: fieldWidth,
            height: fieldHeight,
            spacing,
            columns,
            rows,
            u,
            v,
            nextU: new Float32Array(size),
            nextV: new Float32Array(size),
            accumulator: 0,
        };
    }

    function fieldLaplacian(values, columns, rows, x, y) {
        const left = x > 0 ? x - 1 : x;
        const right = x + 1 < columns ? x + 1 : x;
        const up = y > 0 ? y - 1 : 0;
        const down = y + 1 < rows ? y + 1 : rows - 1;
        const center = values[y * columns + x];
        return (
            values[y * columns + left]
            + values[y * columns + right]
            + values[up * columns + x]
            + values[down * columns + x]
            - 4 * center
        );
    }

    function stepReactionField(field, rawDt, marketActivity = 0) {
        if (!field) return;
        // Eighty fixed substeps per wall-second at h=.075 preserve the former
        // model-time rate while reducing lattice traversals by one third. The
        // largest diffusion mode remains inside explicit Euler's stable range.
        field.accumulator = Math.min(16, field.accumulator + clamp(Number(rawDt) || 0, 0, 0.25) * 80);
        const activity = clamp(Number(marketActivity) || 0, 0, 1);
        let steps = Math.min(8, Math.floor(field.accumulator + 1e-9));
        field.accumulator -= steps;
        while (steps > 0) {
            const timeStep = 0.075 * (0.72 + activity * 0.28);
            for (let y = 0; y < field.rows; y += 1) {
                for (let x = 0; x < field.columns; x += 1) {
                    const index = y * field.columns + x;
                    const u = field.u[index];
                    const v = field.v[index];
                    const lapU = fieldLaplacian(field.u, field.columns, field.rows, x, y);
                    const lapV = fieldLaplacian(field.v, field.columns, field.rows, x, y);
                    const magnitude = u * u + v * v;
                    const saturation = 0.1 * magnitude;
                    // Stable local Jacobian plus a non-diagonal diffusion
                    // matrix. Market activity changes the field's clock, not
                    // its dispersion relation or its two-species semantics.
                    const du = 0.2 * u - 0.4 * v
                        + 0.1776 * lapU + 0.01 * lapV
                        - saturation * u;
                    const dv = 0.4 * u - 0.6 * v
                        + 1.776 * lapV
                        - saturation * v;
                    field.nextU[index] = clamp(
                        u + timeStep * du,
                        -1.2,
                        1.2,
                    );
                    field.nextV[index] = clamp(
                        v + timeStep * dv,
                        -1.2,
                        1.2,
                    );
                }
            }
            [field.u, field.nextU] = [field.nextU, field.u];
            [field.v, field.nextV] = [field.nextV, field.v];
            steps -= 1;
        }
    }

    function sampleReactionField(field, x, y) {
        if (!field) return { value: 0, dx: 0, dy: 0 };
        const gx = clamp(x / Math.max(1, field.width) * (field.columns - 1), 0, field.columns - 1);
        const gy = clamp(y / Math.max(1, field.height) * (field.rows - 1), 0, field.rows - 1);
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const right = Math.min(field.columns - 1, ix + 1);
        const down = Math.min(field.rows - 1, iy + 1);
        const index = iy * field.columns + ix;
        const rightIndex = iy * field.columns + right;
        const downIndex = down * field.columns + ix;
        const magnitude = (sampleIndex) => Math.hypot(field.u[sampleIndex], field.v[sampleIndex]);
        const value = magnitude(index);
        return {
            value,
            dx: magnitude(rightIndex) - value,
            dy: magnitude(downIndex) - value,
        };
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            sobolPoint,
            normalizeArchiveGraph,
            createSemanticField,
            injectSemanticSignal,
            stepSemanticField,
            createReactionField,
            stepReactionField,
            sampleReactionField,
        };
    }

    if (typeof document === "undefined" || typeof window === "undefined") {
        return;
    }

    const root = document.querySelector(".home-section");
    const canvas = document.querySelector("[data-organism-field]");
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const narrowScreenQuery = window.matchMedia("(max-width: 780px)");

    if (!root || !canvas) {
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
    let semanticField = null;
    let reactionField = null;
    let reactionTextureCanvas = null;
    let reactionTextureContext = null;
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
    let marketSignalSequence = 0;
    let animationFrame = 0;
    let resizeTimer = 0;
    let rootResizeObserver = null;
    let running = false;
    let initialized = false;
    let pendingResize = false;
    let lastRenderTime = 0;
    let reactionClock = 0;

    const renderIntervalMilliseconds = 1000 / 20;
    const reactionIntervalSeconds = 1 / 12;

    function marketDriveFor(state) {
        if (state === "open") return 1;
        if (state === "closed") return 0.54;
        return 0.34;
    }

    let marketDriveTarget = marketDriveFor(document.documentElement.dataset.marketState);
    let marketDrive = marketDriveTarget;
    let radioDriveTarget = document.documentElement.dataset.radioState === "playing" ? 1 : 0;
    let radioDrive = radioDriveTarget;

    function loadSemanticField() {
        const payload = document.querySelector("script[data-semantic-graph], script[data-archive-graph]");
        if (!payload) return null;
        try {
            return createSemanticField(JSON.parse(payload.textContent || ""));
        } catch (_error) {
            return null;
        }
    }

    semanticField = loadSemanticField();

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

    function resizeReactionTexture() {
        if (!reactionTextureCanvas && typeof document.createElement === "function") {
            reactionTextureCanvas = document.createElement("canvas");
            reactionTextureContext = reactionTextureCanvas.getContext("2d", { alpha: true });
        }
        if (!reactionTextureCanvas || !reactionTextureContext) return;
        reactionTextureCanvas.width = width;
        reactionTextureCanvas.height = height;
    }

    function resize() {
        const rect = root.getBoundingClientRect();
        const nextDpr = Math.min(2, window.devicePixelRatio || 1);
        const nextWidth = Math.max(1, Math.floor(rect.width));
        const nextHeight = Math.max(1, Math.floor(rect.height));
        if (nextWidth === width && nextHeight === height && nextDpr === dpr) {
            return false;
        }
        dpr = nextDpr;
        width = nextWidth;
        height = nextHeight;
        maxCells = Math.min(1900, Math.max(760, Math.floor((width * height) / 275)));
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        resizeReactionTexture();
        return true;
    }

    function collectSources() {
        const rootRect = root.getBoundingClientRect();
        const rows = Array.from(root.querySelectorAll("[data-semantic-node], [data-archive-node], .archive-list__entry"))
            .filter((row, index, all) => all.indexOf(row) === index);

        sources = rows.map((row, index) => {
            const rect = row.getBoundingClientRect();
            const x = clamp(rect.left + rect.width * 0.68 - rootRect.left, 22, width - 22);
            const y = clamp(rect.top + rect.height * 0.5 - rootRect.top, 22, height - 22);
            const semanticId = row.dataset?.semanticNode
                || row.dataset?.archiveNode
                || row.getAttribute?.("data-semantic-node")
                || row.getAttribute?.("data-archive-node")
                || "";
            return {
                element: row,
                x,
                y,
                radius: Math.max(84, Math.min(150, rect.width * 0.18)),
                strength: Math.max(0.25, 1.25 - index * 0.045),
                charge: 1,
                visits: 0,
                visible: true,
                semanticId,
                semanticIndex: semanticField?.graph.idToIndex.get(semanticId),
            };
        });

        const substrateSeed = hash(`${width}:${height}:substrate`);
        const shiftX = substrateSeed;
        const shiftY = hash(`${substrateSeed}:y`);
        for (let index = 0; index < 16; index += 1) {
            const point = sobolPoint(index + 1, 4);
            const sx = ((Math.floor(point[0] * 4294967296) ^ shiftX) >>> 0) / 4294967296;
            const sy = ((Math.floor(point[1] * 4294967296) ^ shiftY) >>> 0) / 4294967296;
            sources.push({
                element: root,
                x: width * (0.08 + sx * 0.84),
                y: height * (0.08 + sy * 0.84),
                radius: 108 + point[2] * 34,
                strength: 0.23 + point[3] * 0.1,
                charge: 1,
                visits: 0,
                visible: false,
                semanticId: "",
                semanticIndex: undefined,
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
                    semanticId: "",
                    semanticIndex: undefined,
                },
            ];
        }

        reactionField = createReactionField(width, height, sources.filter((source) => source.visible));
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
        reactionClock = 0;
        refreshReactionTexture();

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

    function semanticEnergyAt(index) {
        if (!semanticField || !Number.isInteger(index)) return 0;
        return clamp(
            semanticField.heat[index] * 0.62
            + Math.abs(semanticField.wave[index]) * 0.78
            + Math.abs(semanticField.sprott[index]) * 0.34,
            0,
            1.5,
        );
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
            const signal = semanticEnergyAt(source.semanticIndex);
            const pull = (source.strength * source.charge * source.radius * (1 + signal * 0.72)) / distanceSquared;
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
        const reaction = sampleReactionField(reactionField, parent.x, parent.y);
        const saturation = cells.length / maxCells;
        const branchChance = clamp(0.12 + nutrient.weight * 8 + reaction.value * 0.055 - saturation * 0.08, 0.06, 0.35);

        for (let attempt = 0; attempt < 12; attempt += 1) {
            const exploratoryAngle = tip.angle + (rng() - 0.5) * (0.46 + attempt * 0.13);
            let vx = Math.cos(exploratoryAngle) * 0.74
                + nutrient.x * 120
                + crowding.x * 210
                + reaction.dx * 4.8;
            let vy = Math.sin(exploratoryAngle) * 0.74
                + nutrient.y * 120
                + crowding.y * 210
                + reaction.dy * 4.8;

            if (Math.abs(vx) + Math.abs(vy) < 0.001) {
                vx = Math.cos(tip.angle);
                vy = Math.sin(tip.angle);
            }

            const desiredAngle = Math.atan2(vy, vx);
            const nextAngle = mixAngles(tip.angle, desiredAngle, 0.68);
            const distance = 7.8 + rng() * 6.2 + nutrient.weight * 62 + reaction.value * 1.6;
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

    function paintReactionTexture(targetContext) {
        if (!reactionField) return;
        const cellWidth = width / reactionField.columns;
        const cellHeight = height / reactionField.rows;
        const stride = reactionField.columns * reactionField.rows > 12000 ? 2 : 1;
        const buckets = [
            { min: 0.001, max: 0.006, alpha: 0.004 },
            { min: 0.006, max: 0.012, alpha: 0.009 },
            { min: 0.012, max: Infinity, alpha: 0.016 },
        ];
        buckets.forEach((bucket) => {
            let hasPoints = false;
            targetContext.beginPath();
            for (let y = 0; y < reactionField.rows; y += stride) {
                for (let x = 0; x < reactionField.columns; x += stride) {
                    const index = y * reactionField.columns + x;
                    const value = Math.hypot(reactionField.u[index], reactionField.v[index]);
                    const alpha = clamp((value - 0.012) * 0.085, 0, 0.018);
                    if (alpha <= bucket.min || alpha > bucket.max) continue;
                    const centerX = (x + 0.5) * cellWidth;
                    const centerY = (y + 0.5) * cellHeight;
                    const radius = 0.45 + value * 1.15;
                    targetContext.moveTo(centerX + radius, centerY);
                    targetContext.arc(centerX, centerY, radius, 0, Math.PI * 2);
                    hasPoints = true;
                }
            }
            if (hasPoints) {
                targetContext.fillStyle = `rgba(227, 56, 33, ${bucket.alpha})`;
                targetContext.fill();
            }
        });
    }

    function refreshReactionTexture() {
        if (!reactionTextureContext || !reactionTextureCanvas) return;
        reactionTextureContext.clearRect(0, 0, reactionTextureCanvas.width, reactionTextureCanvas.height);
        paintReactionTexture(reactionTextureContext);
    }

    function drawReactionTexture() {
        if (reactionTextureCanvas && reactionTextureContext) {
            context.drawImage(reactionTextureCanvas, 0, 0, width, height);
            return;
        }
        paintReactionTexture(context);
    }

    function drawSemanticGraph() {
        if (!semanticField) return;
        const positions = new Map();
        sources.forEach((source) => {
            if (source.visible && Number.isInteger(source.semanticIndex)) {
                positions.set(source.semanticIndex, source);
            }
        });

        semanticField.graph.adjacency.forEach((neighbors, sourceIndex) => {
            const from = positions.get(sourceIndex);
            if (!from) return;
            neighbors.forEach((edge) => {
                if (edge.index <= sourceIndex) return;
                const to = positions.get(edge.index);
                if (!to) return;
                const energy = (semanticEnergyAt(sourceIndex) + semanticEnergyAt(edge.index)) * 0.5;
                if (energy < 0.006) return;
                const bend = ((hash(`${sourceIndex}:${edge.index}`) % 3) - 1) * 12;
                context.beginPath();
                context.moveTo(from.x, from.y);
                context.quadraticCurveTo((from.x + to.x) * 0.5 + bend, (from.y + to.y) * 0.5, to.x, to.y);
                context.strokeStyle = `rgba(255, 105, 84, ${clamp(energy * 0.055, 0.006, 0.07)})`;
                context.lineWidth = 0.55 + clamp(edge.weight, 0, 1) * 0.18;
                context.stroke();
            });
        });
    }

    function drawNutrients(elapsed) {
        sources.forEach((source) => {
            const signal = semanticEnergyAt(source.semanticIndex);
            if (!source.visible || (source.visits === 0 && signal < 0.005)) {
                return;
            }

            const alpha = clamp((1 - source.charge) * 0.05 + signal * 0.075, 0.008, 0.1);
            context.beginPath();
            context.arc(source.x, source.y, 1.5 + signal * 1.3 + Math.sin(elapsed * 1.6 + source.y) * 0.25, 0, Math.PI * 2);
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
            const reaction = sampleReactionField(reactionField, cell.x, cell.y);
            const radius = (isTip ? 1.7 + Math.sin(pulse + index) * 0.26 : 0.95)
                * (1 + reaction.value * 0.16)
                * progress;
            const alpha = (isTip ? 0.66 : 0.2 + 0.08 * Math.max(0, 1 - age / 30))
                * (0.96 + reaction.value * 0.12);

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

    function nearestSemanticIndex(x, y) {
        let best;
        let bestDistance = Infinity;
        sources.forEach((source) => {
            if (!Number.isInteger(source.semanticIndex)) return;
            const dx = source.x - x;
            const dy = source.y - y;
            const distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
                best = source.semanticIndex;
                bestDistance = distance;
            }
        });
        return best;
    }

    function triggerPulseAt(x, y, semanticMode = "heat", requestedSemanticNode) {
        const elapsed = (performance.now() - startTime) / 1000;
        if (elapsed - lastInteractionPulse < 0.28) {
            return;
        }

        const targetIndex = visibleCellIndexNear(x, y, elapsed);
        if (targetIndex === lastPulseTarget && elapsed - lastInteractionPulse < 1.2) {
            return;
        }

        const semanticIndex = requestedSemanticNode === undefined
            ? nearestSemanticIndex(x, y)
            : requestedSemanticNode;
        injectSemanticSignal(semanticField, semanticIndex, semanticMode, semanticMode === "sprott" ? 0.62 : 0.92);

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
        const element = target.closest && target.closest("[data-semantic-node], [data-archive-node], .archive-list__entry, .market-clock__market, .market-clock__time, a");
        if (!element) {
            return;
        }

        const point = elementPoint(element);
        const semanticElement = element.closest?.("[data-semantic-node], [data-archive-node]");
        const semanticId = semanticElement?.dataset?.semanticNode
            || semanticElement?.dataset?.archiveNode
            || semanticElement?.getAttribute?.("data-semantic-node")
            || semanticElement?.getAttribute?.("data-archive-node");
        triggerPulseAt(point.x, point.y, "heat", semanticId);
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
        const sprottPeriod = 29;
        const sprottPulse = semanticField
            && (radioPulseSequence + (radioSignalSeed % sprottPeriod)) % sprottPeriod === 0;
        triggerPulseAt(
            source.x,
            source.y,
            sprottPulse ? "sprott" : "wave",
            source.semanticIndex,
        );
        lastRadioPulse = elapsed;
        radioPulseSequence += 1;
    }

    function render(now) {
        if (!running) return;
        animationFrame = 0;
        if (now - lastRenderTime < renderIntervalMilliseconds - 1) {
            animationFrame = window.requestAnimationFrame(render);
            return;
        }
        lastRenderTime = now;
        const elapsed = (now - startTime) / 1000;
        const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
        const pulse = elapsed * 3.2;
        lastTime = now;

        const easing = 1 - Math.exp(-dt * 1.4);
        marketDrive += (marketDriveTarget - marketDrive) * easing;
        radioDrive += (radioDriveTarget - radioDrive) * easing;

        stepSemanticField(semanticField, dt);
        reactionClock = Math.min(reactionIntervalSeconds * 2, reactionClock + dt);
        let reactionTicks = 0;
        while (reactionClock >= reactionIntervalSeconds && reactionTicks < 2) {
            stepReactionField(
                reactionField,
                reactionIntervalSeconds,
                clamp((marketDrive - 0.54) / 0.46, 0, 1),
            );
            reactionClock -= reactionIntervalSeconds;
            reactionTicks += 1;
        }
        if (reactionTicks) refreshReactionTexture();
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
        drawReactionTexture();
        drawSemanticGraph();
        drawNutrients(elapsed);
        drawMembrane(elapsed);
        drawLinks(elapsed);
        drawCells(elapsed, pulse);
        pulses.forEach((signal) => drawPulse(signal, elapsed));
        context.restore();

        if (running) {
            animationFrame = window.requestAnimationFrame(render);
        }
    }

    function animationAllowed() {
        return !document.hidden && !reduceMotionQuery.matches && !narrowScreenQuery.matches;
    }

    function synchronizeSize(forceReset = false) {
        const changed = resize();
        if (!initialized || changed || forceReset) {
            resetOrganism();
            initialized = true;
        }
        pendingResize = false;
    }

    function startAnimation() {
        if (running || !animationAllowed()) return;
        synchronizeSize(pendingResize);
        const now = performance.now();
        lastTime = now;
        lastRenderTime = now - renderIntervalMilliseconds;
        running = true;
        animationFrame = window.requestAnimationFrame(render);
    }

    function stopAnimation(clearCanvas = false) {
        running = false;
        if (animationFrame) {
            window.cancelAnimationFrame(animationFrame);
            animationFrame = 0;
        }
        if (clearCanvas && initialized) {
            context.clearRect(0, 0, width, height);
        }
    }

    function reconcileAnimation() {
        if (animationAllowed()) {
            startAnimation();
        } else {
            stopAnimation(reduceMotionQuery.matches);
        }
    }

    function scheduleRootResize() {
        pendingResize = true;
        if (resizeTimer) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
            resizeTimer = 0;
            if (!initialized || !animationAllowed()) return;
            synchronizeSize(false);
        }, 80);
    }

    function listenForMediaChange(query) {
        if (typeof query.addEventListener === "function") {
            query.addEventListener("change", reconcileAnimation);
        } else if (typeof query.addListener === "function") {
            query.addListener(reconcileAnimation);
        }
    }

    window.addEventListener("resize", scheduleRootResize);
    if (typeof window.ResizeObserver === "function") {
        rootResizeObserver = new window.ResizeObserver(scheduleRootResize);
        rootResizeObserver.observe(root);
    }
    listenForMediaChange(reduceMotionQuery);
    listenForMediaChange(narrowScreenQuery);

    root.addEventListener("pointerover", (event) => {
        if (running) pulseForInteraction(event.target);
    }, { passive: true });

    root.addEventListener("focusin", (event) => {
        if (running) pulseForInteraction(event.target);
    });

    document.addEventListener("jimfund:market-state", (event) => {
        const state = event.detail?.unknown ? "unknown" : (event.detail?.anyOpen ? "open" : "closed");
        marketDriveTarget = marketDriveFor(state);
        if (semanticField) {
            const index = hash(`market:${state}:${marketSignalSequence}`) % semanticField.graph.nodes.length;
            injectSemanticSignal(semanticField, index, state === "open" ? "wave" : "heat", state === "unknown" ? 0.38 : 0.7);
            marketSignalSequence += 1;
        }
    });

    document.addEventListener("jimfund:radio-state", (event) => {
        const wasPlaying = radioDriveTarget > 0;
        radioDriveTarget = event.detail?.playing ? 1 : 0;
        if (event.detail?.trackId) {
            radioSignalSeed = hash(`${event.detail.trackId}:${event.detail.trackIndex ?? 0}`);
            if (semanticField) {
                const index = radioSignalSeed % semanticField.graph.nodes.length;
                injectSemanticSignal(semanticField, index, "wave", 0.62);
            }
        }
        if (!wasPlaying && radioDriveTarget > 0) {
            lastRadioPulse = Math.max(0, (performance.now() - startTime) / 1000 - 5);
        }
        if (wasPlaying !== (radioDriveTarget > 0)) {
            scheduleRootResize();
        }
    });

    document.addEventListener("visibilitychange", reconcileAnimation);
    reconcileAnimation();
}());
