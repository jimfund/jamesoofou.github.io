(function () {
    const root = document.querySelector("[data-radio]");

    if (!root) {
        return;
    }

    const playlistNode = root.querySelector("[data-radio-tracks]");
    const titleNodes = root.querySelectorAll("[data-radio-title]");
    const frame = root.querySelector("[data-radio-frame]");
    const launchButton = root.querySelector("[data-radio-launch]");
    const launchCommand = root.querySelector("[data-radio-launch-command]");
    const panel = root.querySelector("[data-radio-panel]");
    const toggleButton = root.querySelector("[data-radio-toggle]");
    const previousButton = root.querySelector("[data-radio-prev]");
    const nextButton = root.querySelector("[data-radio-next]");
    const detachButton = root.querySelector("[data-radio-detach]");
    const statusNode = root.querySelector("[data-radio-status]");
    const detachedMode = root.hasAttribute("data-radio-window");
    const handoff = new URLSearchParams(window.location.search);

    let tracks = [];
    try {
        const parsed = JSON.parse(playlistNode ? playlistNode.textContent : "[]");
        if (Array.isArray(parsed)) {
            tracks = parsed.filter((track) => {
                return track
                    && typeof track.id === "string"
                    && /^[A-Za-z0-9_-]{11}$/.test(track.id)
                    && typeof track.title === "string"
                    && track.title.trim();
            });
        }
    } catch (_error) {
        tracks = [];
    }

    let currentIndex = 0;
    const handedTrack = handoff.get("track");
    const handedIndex = tracks.findIndex((track) => track.id === handedTrack);
    if (handedIndex >= 0) {
        currentIndex = handedIndex;
    }
    let pendingStartSeconds = Math.max(0, Number.parseFloat(handoff.get("time")) || 0);
    let isPlaying = detachedMode && handoff.get("play") === "1";
    let autoplayBlocked = false;
    let statusMessage = "";
    let player = null;
    let playerReady = false;
    let youtubeApiPromise = null;
    let consecutiveFailures = 0;
    const instanceId = window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `${Date.now()}:${Math.random()}`;
    const radioChannel = typeof window.BroadcastChannel === "function"
        ? new window.BroadcastChannel("jimfund-radio")
        : null;

    if (!titleNodes.length || !frame || !launchButton || !launchCommand || !panel || !toggleButton || !previousButton || !nextButton || !detachButton || !statusNode || tracks.length === 0) {
        return;
    }

    if (detachedMode && window.history && typeof window.history.replaceState === "function") {
        window.history.replaceState({}, "", window.location.pathname);
    }

    function currentTrack() {
        return tracks[currentIndex];
    }

    function embedUrl(track, startSeconds) {
        const params = new URLSearchParams({
            autoplay: "1",
            enablejsapi: "1",
            playsinline: "1",
            rel: "0",
        });
        if (window.location.origin && window.location.origin !== "null") {
            params.set("origin", window.location.origin);
        }
        if (startSeconds > 0) {
            params.set("start", String(Math.floor(startSeconds)));
        }
        return `https://www.youtube-nocookie.com/embed/${track.id}?${params.toString()}`;
    }

    function loadYouTubeApi() {
        if (window.YT && typeof window.YT.Player === "function") {
            return Promise.resolve(window.YT);
        }
        if (youtubeApiPromise) {
            return youtubeApiPromise;
        }

        youtubeApiPromise = new Promise((resolve, reject) => {
            const previousReadyHandler = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = function () {
                if (typeof previousReadyHandler === "function") {
                    previousReadyHandler();
                }
                resolve(window.YT);
            };

            let script = document.querySelector("script[data-youtube-iframe-api]");
            if (!script) {
                script = document.createElement("script");
                script.src = "https://www.youtube.com/iframe_api";
                script.async = true;
                script.dataset.youtubeIframeApi = "true";
                document.head.appendChild(script);
            }
            script.addEventListener("error", () => reject(new Error("Unable to load the YouTube player API")), { once: true });
        });

        return youtubeApiPromise;
    }

    function initializePlayer() {
        if (player || !isPlaying) {
            return;
        }

        loadYouTubeApi().then(() => {
            if (player || !isPlaying) {
                return;
            }
            player = new window.YT.Player(frame, {
                events: {
                    onReady(event) {
                        playerReady = true;
                        if (!isPlaying) {
                            event.target.stopVideo();
                            return;
                        }
                        const loadedVideo = event.target.getVideoData();
                        if (!loadedVideo || loadedVideo.video_id !== currentTrack().id) {
                            event.target.loadVideoById({
                                videoId: currentTrack().id,
                                startSeconds: pendingStartSeconds,
                            });
                            pendingStartSeconds = 0;
                        }
                    },
                    onStateChange(event) {
                        if (event.data === window.YT.PlayerState.PLAYING) {
                            consecutiveFailures = 0;
                            autoplayBlocked = false;
                            statusMessage = "";
                            if (radioChannel) {
                                radioChannel.postMessage({ type: "claim", instanceId });
                            }
                            render(false);
                        } else if (event.data === window.YT.PlayerState.ENDED && isPlaying) {
                            move(1);
                        }
                    },
                    onAutoplayBlocked() {
                        autoplayBlocked = true;
                        statusMessage = "Autoplay blocked";
                        render(false);
                    },
                    onError() {
                        if (!isPlaying) {
                            return;
                        }
                        consecutiveFailures += 1;
                        if (consecutiveFailures >= tracks.length) {
                            stop("No tracks available");
                            return;
                        }
                        move(1);
                    },
                },
            });
        }).catch((error) => {
            root.title = error instanceof Error ? error.message : "Unable to enable automatic playback";
            statusMessage = "Receiver unavailable";
            render(false);
        });
    }

    function loadTrack() {
        const track = currentTrack();
        titleNodes.forEach((node) => {
            node.textContent = track.title;
        });
        frame.title = `Jimfund radio: ${track.title}`;

        if (isPlaying && playerReady) {
            player.loadVideoById({
                videoId: track.id,
                startSeconds: pendingStartSeconds,
            });
            pendingStartSeconds = 0;
        } else if (isPlaying && !player) {
            frame.src = embedUrl(track, pendingStartSeconds);
            initializePlayer();
        }
    }

    function broadcastState() {
        document.documentElement.dataset.radioState = isPlaying && !autoplayBlocked ? "playing" : "stopped";
        document.dispatchEvent(new CustomEvent("jimfund:radio-state", {
            detail: {
                playing: isPlaying && !autoplayBlocked,
                trackId: currentTrack().id,
                trackIndex: currentIndex,
            },
        }));
    }

    function render(shouldLoadTrack = true) {
        const hasMultipleTracks = tracks.length > 1;
        previousButton.disabled = !hasMultipleTracks;
        nextButton.disabled = !hasMultipleTracks;
        root.classList.toggle("has-multiple-tracks", hasMultipleTracks);
        launchButton.setAttribute("aria-expanded", String(isPlaying));
        launchCommand.textContent = autoplayBlocked ? "Resume"
            : isPlaying ? "On air"
                : statusMessage === "No tracks available" ? "Unavailable" : "Turn on";
        toggleButton.textContent = "Stop";
        detachButton.textContent = detachedMode ? "Close" : "Detach";
        statusNode.textContent = statusMessage;
        root.classList.toggle("is-active", isPlaying);
        root.classList.toggle("is-blocked", autoplayBlocked);
        panel.hidden = !isPlaying;
        if (detachedMode) {
            document.title = `${currentTrack().title} / jimfund radio`;
        }
        if (shouldLoadTrack) {
            loadTrack();
        }
        broadcastState();
    }

    function stop(message = "") {
        isPlaying = false;
        autoplayBlocked = false;
        statusMessage = message;
        if (playerReady) {
            player.stopVideo();
        } else if (!player) {
            frame.removeAttribute("src");
        }
        render();
    }

    function play() {
        if (autoplayBlocked && playerReady) {
            autoplayBlocked = false;
            isPlaying = true;
            statusMessage = "";
            player.playVideo();
            render(false);
            return;
        }
        if (isPlaying) {
            return;
        }

        isPlaying = true;
        statusMessage = "";
        render();
    }

    function move(offset) {
        currentIndex = (currentIndex + offset + tracks.length) % tracks.length;
        pendingStartSeconds = 0;
        autoplayBlocked = false;
        statusMessage = "";
        render();
    }

    function detach() {
        if (detachedMode) {
            window.close();
            return;
        }

        const currentTime = playerReady && typeof player.getCurrentTime === "function"
            ? Math.max(0, player.getCurrentTime())
            : 0;
        const url = new URL("radio.html", window.location.href);
        url.searchParams.set("track", currentTrack().id);
        url.searchParams.set("time", String(Math.floor(currentTime)));
        url.searchParams.set("play", isPlaying ? "1" : "0");
        const receiver = window.open(
            url.toString(),
            "jimfund-radio",
            "popup=yes,width=620,height=560,resizable=yes,scrollbars=yes",
        );
        if (receiver) {
            stop();
        } else {
            root.title = "Detached receiver was blocked; inline playback continues";
            statusMessage = "Pop-up blocked";
            render(false);
        }
    }

    launchButton.addEventListener("click", play);
    toggleButton.addEventListener("click", () => {
        stop();
    });

    previousButton.addEventListener("click", () => move(-1));
    nextButton.addEventListener("click", () => move(1));
    detachButton.addEventListener("click", detach);

    if (radioChannel) {
        radioChannel.addEventListener("message", (event) => {
            if (event.data && event.data.type === "claim" && event.data.instanceId !== instanceId && isPlaying) {
                stop();
            }
        });
        window.addEventListener("pagehide", () => radioChannel.close(), { once: true });
    }

    render();
}());
