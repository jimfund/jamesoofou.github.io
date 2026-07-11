(function () {
    window.addEventListener("message", function (event) {
        if (!event.data || event.data.type !== "timehorizonmodel:resize") {
            return;
        }

        document.querySelectorAll(".timehorizon-model-widget").forEach(function (frame) {
            if (frame.contentWindow === event.source) {
                frame.style.height = Math.ceil(Math.max(760, event.data.height)) + "px";
            }
        });
    });

    function resizeFrame(frame) {
        try {
            var doc = frame.contentDocument || frame.contentWindow.document;
            var root = doc.documentElement;
            var body = doc.body;
            var height = Math.max(
                root ? root.scrollHeight : 0,
                body ? body.scrollHeight : 0,
                760
            );
            frame.style.height = Math.ceil(height + 4) + "px";
        } catch (error) {
            frame.style.height = "920px";
        }
    }

    function attachFrame(frame) {
        frame.addEventListener("load", function () {
            resizeFrame(frame);
            try {
                var doc = frame.contentDocument || frame.contentWindow.document;
                if (window.ResizeObserver && doc.body) {
                    var observer = new ResizeObserver(function () {
                        resizeFrame(frame);
                    });
                    observer.observe(doc.body);
                    observer.observe(doc.documentElement);
                }
            } catch (error) {
                resizeFrame(frame);
            }
        });
        resizeFrame(frame);
    }

    document.querySelectorAll(".timehorizon-model-widget").forEach(attachFrame);
    window.addEventListener("resize", function () {
        document.querySelectorAll(".timehorizon-model-widget").forEach(resizeFrame);
    });
})();
