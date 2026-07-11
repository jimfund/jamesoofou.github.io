(function () {
    window.addEventListener("message", function (event) {
        if (!event.data || event.data.type !== "timehorizonmodel:resize") {
            return;
        }

        document.querySelectorAll(".timehorizon-model-widget").forEach(function (frame) {
            if (frame.contentWindow === event.source) {
                frame.style.height = Math.ceil(Math.max(760, Number(event.data.height) || 0)) + "px";
            }
        });
    });

    function attachFrame(frame) {
        frame.addEventListener("load", function () {
            frame.style.height = Math.max(1040, frame.clientHeight || 0) + "px";
        });
    }

    document.querySelectorAll(".timehorizon-model-widget").forEach(attachFrame);
})();
