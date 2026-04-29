(function () {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrowScreen = window.matchMedia("(max-width: 780px)").matches;

    if (reduceMotion || narrowScreen) {
        return;
    }

    const fragments = [
        "observer////signal////archive",
        "presence////unresolved////near",
        "record////trace////return",
    ];

    const field = document.createElement("div");
    field.className = "presence-field";
    field.setAttribute("aria-hidden", "true");
    document.body.appendChild(field);

    const marks = fragments.map((text, index) => {
        const node = document.createElement("span");
        node.className = "presence-mark";
        node.textContent = text;
        field.appendChild(node);

        return {
            node,
            side: index % 2 === 0 ? "left" : "right",
            xOffset: 48 + (index % 3) * 24,
            yRatio: 0.2 + index * 0.22,
            drift: 7 + index * 2,
            rotation: index % 2 === 0 ? 0 : 180,
        };
    });

    const pointer = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
    };
    let frameRequested = false;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function markBaseX(mark) {
        const gutter = Math.max(14, (window.innerWidth - 1040) / 2 - mark.xOffset);
        return mark.side === "left" ? gutter : window.innerWidth - gutter;
    }

    function render() {
        frameRequested = false;

        marks.forEach((mark) => {
            const baseX = markBaseX(mark);
            const baseY = window.innerHeight * mark.yRatio;
            const dx = pointer.x - baseX;
            const dy = pointer.y - baseY;
            const distance = Math.hypot(dx, dy);
            const nearness = clamp(1 - distance / 360, 0, 1);
            const direction = mark.side === "left" ? -1 : 1;
            const x = direction * nearness * mark.drift;
            const y = dy > 0 ? -nearness * mark.drift : nearness * mark.drift;
            const opacity = 0.52 + nearness * 0.38;

            mark.node.style.left = `${baseX}px`;
            mark.node.style.top = `${baseY}px`;
            mark.node.style.opacity = opacity.toFixed(2);
            mark.node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${mark.rotation}deg)`;
        });
    }

    function requestRender() {
        if (!frameRequested) {
            frameRequested = true;
            window.requestAnimationFrame(render);
        }
    }

    window.addEventListener("pointermove", (event) => {
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        requestRender();
    }, { passive: true });

    window.addEventListener("resize", requestRender);

    window.setInterval(() => {
        const mark = marks[Math.floor(Math.random() * marks.length)];
        mark.node.classList.add("is-awake");
        mark.node.style.opacity = "1";
        window.setTimeout(() => mark.node.classList.remove("is-awake"), 1200);
    }, 5600);

    render();
}());
