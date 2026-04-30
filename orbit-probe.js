(function () {
    const root = document.querySelector(".home-section");
    const canvas = document.querySelector("[data-orbit-probe]");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrowScreen = window.matchMedia("(max-width: 780px)").matches;

    if (!root || !canvas || reduceMotion || narrowScreen) {
        return;
    }

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
        return;
    }

    const G = 0.95;
    const softening = 0.025;
    const maxSpeed = 1.65;
    const burnOptions = [
        0,
        0.018,
        0.032,
        0.048,
    ];
    const bodies = [
        { radius: 0, period: 1, phase: 0, mass: 1.9, size: 2.2, fixed: true },
        { radius: 0.5, period: 22, phase: 0.3, mass: 0.075, size: 1.35 },
        { radius: 0.92, period: 38, phase: 2.1, mass: 0.13, size: 1.75 },
        { radius: 1.42, period: 62, phase: 4.4, mass: 0.095, size: 1.45 },
    ];

    let width = 0;
    let height = 0;
    let dpr = 1;
    let scale = 1;
    let origin = { x: 0, y: 0 };
    let target = { x: 1.55, y: -0.35 };
    let probe = { x: -1.25, y: 0.58, vx: 0.08, vy: -0.48 };
    let predictedPath = [];
    let lastTime = performance.now();
    let lastPlan = 0;
    let lastBurn = { x: 0, y: 0 };
    let animationFrame = 0;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function bodyPosition(body, time) {
        if (body.fixed) {
            return { x: 0, y: 0 };
        }

        const angle = body.phase + (time / body.period) * Math.PI * 2;
        return {
            x: Math.cos(angle) * body.radius,
            y: Math.sin(angle) * body.radius * 0.78,
        };
    }

    function accelerationAt(position, time) {
        let ax = 0;
        let ay = 0;

        bodies.forEach((body) => {
            const bodyPoint = bodyPosition(body, time);
            const dx = bodyPoint.x - position.x;
            const dy = bodyPoint.y - position.y;
            const distanceSquared = dx * dx + dy * dy + softening;
            const force = (G * body.mass) / (distanceSquared * Math.sqrt(distanceSquared));
            ax += dx * force;
            ay += dy * force;
        });

        return { x: ax, y: ay };
    }

    function integrate(state, dt, time) {
        const accel = accelerationAt(state, time);
        state.vx += accel.x * dt;
        state.vy += accel.y * dt;

        const speed = Math.hypot(state.vx, state.vy);
        if (speed > maxSpeed) {
            const ratio = maxSpeed / speed;
            state.vx *= ratio;
            state.vy *= ratio;
        }

        state.x += state.vx * dt;
        state.y += state.vy * dt;

        return state;
    }

    function resetProbe(time) {
        const outer = bodyPosition(bodies[3], time);
        probe = {
            x: outer.x - 0.32,
            y: outer.y + 0.18,
            vx: -outer.y * 0.24,
            vy: outer.x * 0.24 - 0.25,
        };
    }

    function scoreState(state, path) {
        const finalDistance = Math.hypot(state.x - target.x, state.y - target.y);
        const closestDistance = path.reduce((best, point) => {
            return Math.min(best, Math.hypot(point.x - target.x, point.y - target.y));
        }, finalDistance);
        const speed = Math.hypot(state.vx, state.vy);
        return finalDistance * 1.15 + closestDistance * 0.75 + speed * 0.05;
    }

    function simulateCandidate(burn, time) {
        const state = {
            x: probe.x,
            y: probe.y,
            vx: probe.vx + burn.x,
            vy: probe.vy + burn.y,
        };
        const path = [];
        const dt = 0.055;

        for (let index = 0; index < 115; index += 1) {
            integrate(state, dt, time + index * dt);
            if (index % 3 === 0) {
                path.push({ x: state.x, y: state.y });
            }
        }

        return {
            burn,
            path,
            score: scoreState(state, path),
        };
    }

    function plan(time) {
        const velocityAngle = Math.atan2(probe.vy, probe.vx);
        const targetAngle = Math.atan2(target.y - probe.y, target.x - probe.x);
        const angles = [];

        for (let index = 0; index < 16; index += 1) {
            angles.push((index / 16) * Math.PI * 2);
        }
        angles.push(velocityAngle, velocityAngle + Math.PI, targetAngle, targetAngle + Math.PI / 2, targetAngle - Math.PI / 2);

        let best = simulateCandidate({ x: 0, y: 0 }, time);
        angles.forEach((angle) => {
            burnOptions.slice(1).forEach((magnitude) => {
                const candidate = simulateCandidate({
                    x: Math.cos(angle) * magnitude,
                    y: Math.sin(angle) * magnitude,
                }, time);

                if (candidate.score < best.score) {
                    best = candidate;
                }
            });
        });

        probe.vx += best.burn.x;
        probe.vy += best.burn.y;
        lastBurn = best.burn;
        predictedPath = best.path;
    }

    function resize() {
        const rect = root.getBoundingClientRect();
        dpr = Math.min(2, window.devicePixelRatio || 1);
        width = Math.max(1, Math.floor(rect.width));
        height = Math.max(1, Math.floor(rect.height));
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        scale = Math.min(width, height) * 0.25;
        origin = {
            x: width * 0.63,
            y: height * 0.48,
        };
    }

    function toScreen(point) {
        return {
            x: origin.x + point.x * scale,
            y: origin.y + point.y * scale,
        };
    }

    function toWorld(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: clamp((clientX - rect.left - origin.x) / scale, -2.25, 2.25),
            y: clamp((clientY - rect.top - origin.y) / scale, -1.8, 1.8),
        };
    }

    function drawOrbit(body) {
        if (body.fixed) {
            return;
        }

        context.beginPath();
        context.ellipse(origin.x, origin.y, body.radius * scale, body.radius * 0.78 * scale, 0, 0, Math.PI * 2);
        context.strokeStyle = "rgba(155, 184, 207, 0.055)";
        context.lineWidth = 1;
        context.stroke();
    }

    function drawBody(body, time) {
        const point = toScreen(bodyPosition(body, time));
        context.beginPath();
        context.arc(point.x, point.y, body.size, 0, Math.PI * 2);
        context.fillStyle = body.fixed ? "rgba(200, 216, 230, 0.16)" : "rgba(155, 184, 207, 0.22)";
        context.fill();
    }

    function drawPath(path) {
        if (path.length < 2) {
            return;
        }

        context.beginPath();
        path.forEach((point, index) => {
            const screen = toScreen(point);
            if (index === 0) {
                context.moveTo(screen.x, screen.y);
                return;
            }
            context.lineTo(screen.x, screen.y);
        });
        context.strokeStyle = "rgba(227, 56, 33, 0.18)";
        context.lineWidth = 1;
        context.stroke();
    }

    function drawTarget() {
        const point = toScreen(target);
        context.beginPath();
        context.moveTo(point.x - 5, point.y);
        context.lineTo(point.x + 5, point.y);
        context.moveTo(point.x, point.y - 5);
        context.lineTo(point.x, point.y + 5);
        context.strokeStyle = "rgba(227, 56, 33, 0.2)";
        context.lineWidth = 1;
        context.stroke();
    }

    function drawProbe() {
        const point = toScreen(probe);
        const angle = Math.atan2(probe.vy, probe.vx);
        const burnMagnitude = Math.hypot(lastBurn.x, lastBurn.y);

        context.save();
        context.translate(point.x, point.y);
        context.rotate(angle);
        context.beginPath();
        context.moveTo(5, 0);
        context.lineTo(-3.6, -2.4);
        context.lineTo(-2.1, 0);
        context.lineTo(-3.6, 2.4);
        context.closePath();
        context.fillStyle = "rgba(213, 221, 230, 0.78)";
        context.fill();

        if (burnMagnitude > 0.001) {
            context.beginPath();
            context.moveTo(-4, 0);
            context.lineTo(-8 - burnMagnitude * 90, 0);
            context.strokeStyle = "rgba(227, 56, 33, 0.36)";
            context.lineWidth = 1;
            context.stroke();
        }
        context.restore();
    }

    function render(now) {
        const time = now / 1000;
        const dt = Math.min(0.033, Math.max(0.001, (now - lastTime) / 1000));
        lastTime = now;

        if (now - lastPlan > 760) {
            plan(time);
            lastPlan = now;
        }

        integrate(probe, dt, time);
        if (Math.hypot(probe.x, probe.y) > 2.8 || Math.hypot(probe.x, probe.y) < 0.09) {
            resetProbe(time);
        }

        context.clearRect(0, 0, width, height);
        bodies.forEach(drawOrbit);
        drawPath(predictedPath);
        drawTarget();
        bodies.forEach((body) => drawBody(body, time));
        drawProbe();

        animationFrame = window.requestAnimationFrame(render);
    }

    root.addEventListener("pointermove", (event) => {
        target = toWorld(event.clientX, event.clientY);
    }, { passive: true });

    root.addEventListener("pointerleave", () => {
        target = { x: 1.55, y: -0.35 };
    });

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            window.cancelAnimationFrame(animationFrame);
            return;
        }

        lastTime = performance.now();
        animationFrame = window.requestAnimationFrame(render);
    });

    resize();
    resetProbe(0);
    plan(0);
    animationFrame = window.requestAnimationFrame(render);
}());
