(function () {
    const frameObservers = new WeakMap();

    function setFrameHeight(frame, height) {
        frame.style.height = Math.ceil(Math.max(760, Number(height) || 0)) + "px";
    }

    function measureFrame(frame) {
        try {
            const doc = frame.contentDocument;
            if (!doc) {
                return;
            }

            const main = doc.querySelector("main");
            const height = Math.max(
                main ? main.scrollHeight : 0,
                main ? main.offsetHeight : 0,
                main ? main.getBoundingClientRect().height : 0
            );
            setFrameHeight(frame, height + 8);

            if (window.ResizeObserver && main && !frameObservers.has(frame)) {
                const observer = new ResizeObserver(function () {
                    measureFrame(frame);
                });
                observer.observe(main);
                frameObservers.set(frame, observer);
            }
        } catch (error) {
            frame.contentWindow.postMessage({ type: "timehorizonmodel:measure" }, "*");
        }
    }

    window.addEventListener("message", function (event) {
        if (!event.data || event.data.type !== "timehorizonmodel:resize") {
            return;
        }

        document.querySelectorAll(".timehorizon-model-widget").forEach(function (frame) {
            if (frame.contentWindow === event.source) {
                setFrameHeight(frame, event.data.height);
            }
        });
    });

    function attachFrame(frame) {
        frame.addEventListener("load", function () {
            measureFrame(frame);
        });

        [0, 250, 1000, 2500].forEach(function (delay) {
            window.setTimeout(function () {
                measureFrame(frame);
            }, delay);
        });
    }

    document.querySelectorAll(".timehorizon-model-widget").forEach(attachFrame);
})();
