(() => {
    const params = new URLSearchParams(location.search);
    const applicationId = location.hostname.split(".")[0];
    const instanceId = params.get("instance_id") ?? "";
    const ticket = params.get("discord_proxy_ticket") ?? "";
    const frameId = params.get("frame_id");
    const clientId = crypto.randomUUID();
    const api = `/.proxy/api/instances/${encodeURIComponent(instanceId)}`;

    const COLORS = [
        ["Ink", "#1e1f22"],
        ["Red", "#e03131"],
        ["Orange", "#f08c00"],
        ["Green", "#2f9e44"],
        ["Blue", "#1971c2"],
        ["Purple", "#9c36b5"],
    ];
    const SIZES = [
        ["Fine", 4],
        ["Medium", 10],
        ["Bold", 22],
    ];
    const CURSOR_COLORS = ["#5865f2", "#eb459e", "#e67e22", "#23a55a", "#00a8fc", "#9b59b6", "#f23f43"];
    const ERASER = "#ffffff";

    const stage = document.getElementById("stage");
    const boardEl = document.getElementById("board");
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const cursorsEl = document.getElementById("cursors");
    const peopleEl = document.getElementById("people");
    const notice = document.getElementById("notice");
    const eraserButton = document.getElementById("eraser");

    const state = {
        width: 1600,
        height: 900,
        scale: 1,
        me: null,
        strokes: [],
        people: [],
        cursors: new Map(),
        color: COLORS[0][1],
        size: SIZES[1][1],
        erasing: false,
        drawing: null,
        pending: [],
        counter: 0,
        ended: false,
    };

    const showNotice = (text) => {
        notice.hidden = !text;
        notice.textContent = text ?? "";
    };

    const post = (path, body) =>
        fetch(`${api}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-proxy-ticket": ticket, "x-client-id": clientId },
            body: body === undefined ? undefined : JSON.stringify(body),
        }).catch(() => undefined);

    const drawStroke = (stroke, from = 0) => {
        const points = stroke.points;
        const count = points.length / 2;
        if (!count) return;
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (count === 1) {
            ctx.beginPath();
            ctx.arc(points[0], points[1], stroke.size / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        ctx.beginPath();
        for (let i = Math.max(1, from); i < count; i++) {
            const x0 = points[(i - 1) * 2];
            const y0 = points[(i - 1) * 2 + 1];
            const x1 = points[i * 2];
            const y1 = points[i * 2 + 1];
            const startX = i >= 2 ? (points[(i - 2) * 2] + x0) / 2 : x0;
            const startY = i >= 2 ? (points[(i - 2) * 2 + 1] + y0) / 2 : y0;
            ctx.moveTo(startX, startY);
            ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            ctx.lineTo(x1, y1);
        }
        ctx.stroke();
    };

    const redraw = () => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(state.scale * devicePixelRatio, 0, 0, state.scale * devicePixelRatio, 0, 0);
        for (const stroke of state.strokes) drawStroke(stroke);
    };

    const layout = () => {
        const styles = getComputedStyle(stage);
        const availableWidth = stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
        const availableHeight = stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
        const width = Math.max(1, Math.min(availableWidth, (availableHeight * state.width) / state.height));
        const height = (width * state.height) / state.width;
        boardEl.style.width = `${width}px`;
        boardEl.style.height = `${height}px`;
        canvas.width = Math.round(width * devicePixelRatio);
        canvas.height = Math.round(height * devicePixelRatio);
        state.scale = width / state.width;
        redraw();
        for (const [userId, cursor] of state.cursors) placeCursor(userId, cursor.x, cursor.y);
    };

    const nameOf = (userId) => state.people.find((p) => p.id === userId)?.name ?? "Someone";
    const colorOf = (userId) => CURSOR_COLORS[Number(BigInt(userId) % BigInt(CURSOR_COLORS.length))];

    const renderPeople = () => {
        peopleEl.replaceChildren();
        if (!state.people.length) return;
        const avatars = document.createElement("div");
        avatars.className = "avatars";
        for (const person of state.people.slice(0, 5)) {
            const img = document.createElement("img");
            img.src = person.avatar;
            img.alt = "";
            img.title = nameOf(person.id);
            avatars.append(img);
        }
        const count = document.createElement("span");
        count.className = "count";
        const names = state.people.map((p) => nameOf(p.id));
        count.textContent = names.length <= 2 ? names.join(" and ") : `${names[0]} and ${names.length - 1} others`;
        peopleEl.title = names.join(", ");
        peopleEl.append(avatars, count);
    };

    const placeCursor = (userId, x, y) => {
        let cursor = state.cursors.get(userId);
        if (!cursor) {
            const el = document.createElement("div");
            el.className = "cursor";
            el.style.setProperty("--cursor-color", colorOf(userId));
            el.append(document.createElement("span"));
            cursorsEl.append(el);
            cursor = { el, x, y };
            state.cursors.set(userId, cursor);
        }
        cursor.x = x;
        cursor.y = y;
        cursor.el.querySelector("span").textContent = nameOf(userId);
        if (x === null || y === null) {
            cursor.el.dataset.hidden = "";
            return;
        }
        delete cursor.el.dataset.hidden;
        cursor.el.style.transform = `translate(${x * state.scale}px, ${y * state.scale}px)`;
    };

    const toBoard = (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * state.width;
        const y = ((event.clientY - rect.top) / rect.height) * state.height;
        return [Math.min(state.width, Math.max(0, Math.round(x * 10) / 10)), Math.min(state.height, Math.max(0, Math.round(y * 10) / 10))];
    };

    let flushing = Promise.resolve();
    let flushTimer = null;
    const flush = () => {
        flushTimer = null;
        const stroke = state.drawing ?? state.lastStroke;
        if (!stroke || !state.pending.length) return;
        const points = state.pending.splice(0, 1024);
        const body = { id: stroke.id, color: stroke.color, size: stroke.size, points };
        flushing = flushing.then(() => post("/strokes", body));
        if (state.pending.length) flush();
    };
    const scheduleFlush = () => {
        flushTimer ??= setTimeout(flush, 40);
    };

    let cursorTimer = null;
    let lastCursor = null;
    const sendCursor = (point) => {
        lastCursor = point;
        cursorTimer ??= setTimeout(() => {
            cursorTimer = null;
            post("/cursor", lastCursor ? { x: lastCursor[0], y: lastCursor[1] } : { x: null, y: null });
        }, 50);
    };

    canvas.addEventListener("pointerdown", (event) => {
        if (state.ended || !state.me || event.button !== 0) return;
        canvas.setPointerCapture(event.pointerId);
        const stroke = {
            id: `${clientId.slice(0, 8)}-${++state.counter}`,
            user_id: state.me,
            color: state.erasing ? ERASER : state.color,
            size: state.erasing ? Math.max(state.size * 2.5, 24) : state.size,
            points: [...toBoard(event)],
        };
        state.strokes.push(stroke);
        state.drawing = stroke;
        state.pending.push(...stroke.points);
        drawStroke(stroke);
        scheduleFlush();
    });

    canvas.addEventListener("pointermove", (event) => {
        const point = toBoard(event);
        sendCursor(point);
        const stroke = state.drawing;
        if (!stroke) return;
        const from = stroke.points.length / 2;
        for (const sample of event.getCoalescedEvents?.() ?? [event]) {
            const [x, y] = toBoard(sample);
            const lastX = stroke.points[stroke.points.length - 2];
            const lastY = stroke.points[stroke.points.length - 1];
            if (Math.hypot(x - lastX, y - lastY) < 1.5) continue;
            stroke.points.push(x, y);
            state.pending.push(x, y);
        }
        drawStroke(stroke, from);
        scheduleFlush();
    });

    const endStroke = () => {
        if (!state.drawing) return;
        state.lastStroke = state.drawing;
        state.drawing = null;
        clearTimeout(flushTimer);
        flush();
    };
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    canvas.addEventListener("pointerleave", () => sendCursor(null));

    const undo = () => {
        const index = state.strokes.findLastIndex((s) => s.user_id === state.me);
        if (index === -1) return;
        state.strokes.splice(index, 1);
        redraw();
        flushing = flushing.then(() => post("/undo"));
    };

    const buildRadioGroup = (container, items, render, isChecked, onPick) => {
        const buttons = items.map(([label, value]) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "tool";
            button.setAttribute("role", "radio");
            button.setAttribute("aria-label", label);
            button.title = label;
            button.append(render(value));
            button.addEventListener("click", () => {
                onPick(value);
                sync();
            });
            container.append(button);
            return [button, value];
        });
        const sync = () => {
            for (const [button, value] of buttons) button.setAttribute("aria-checked", String(isChecked(value)));
            eraserButton.setAttribute("aria-pressed", String(state.erasing));
            boardEl.classList.toggle("erasing", state.erasing);
        };
        sync();
        return sync;
    };

    const syncColors = buildRadioGroup(
        document.getElementById("colors"),
        COLORS,
        (value) => {
            const swatch = document.createElement("span");
            swatch.className = "swatch";
            swatch.style.setProperty("--swatch", value);
            return swatch;
        },
        (value) => !state.erasing && state.color === value,
        (value) => {
            state.color = value;
            state.erasing = false;
        },
    );
    const syncSizes = buildRadioGroup(
        document.getElementById("sizes"),
        SIZES,
        (value) => {
            const dot = document.createElement("span");
            dot.className = "dot";
            const px = Math.round(4 + value / 2);
            dot.style.width = dot.style.height = `${px}px`;
            return dot;
        },
        (value) => state.size === value,
        (value) => {
            state.size = value;
        },
    );

    eraserButton.addEventListener("click", () => {
        state.erasing = !state.erasing;
        syncColors();
        syncSizes();
    });
    document.getElementById("undo").addEventListener("click", undo);
    document.getElementById("clear").addEventListener("click", () => {
        state.strokes = [];
        redraw();
        flushing = flushing.then(() => post("/clear"));
    });
    addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            undo();
        }
    });

    new ResizeObserver(layout).observe(stage);

    const connect = () => {
        if (!instanceId || !ticket) {
            showNotice("Open this activity from a voice channel to start drawing.");
            return;
        }
        showNotice("Connecting…");
        const source = new EventSource(`${api}/events?ticket=${encodeURIComponent(ticket)}&client=${clientId}`);
        source.addEventListener("hello", (event) => {
            const data = JSON.parse(event.data);
            state.me = data.you;
            state.width = data.width;
            state.height = data.height;
            state.strokes = data.strokes.concat(state.strokes.filter((s) => s.user_id === data.you && !data.strokes.some((r) => r.id === s.id)));
            state.people = data.people;
            showNotice(null);
            renderPeople();
            layout();
        });
        source.addEventListener("points", (event) => {
            const data = JSON.parse(event.data);
            let stroke = state.strokes.findLast((s) => s.id === data.id && s.user_id === data.user_id);
            if (!stroke) state.strokes.push((stroke = { id: data.id, user_id: data.user_id, color: data.color, size: data.size, points: [] }));
            const from = stroke.points.length / 2;
            stroke.points.push(...data.points);
            ctx.setTransform(state.scale * devicePixelRatio, 0, 0, state.scale * devicePixelRatio, 0, 0);
            drawStroke(stroke, from);
        });
        source.addEventListener("remove", (event) => {
            const data = JSON.parse(event.data);
            state.strokes = state.strokes.filter((s) => !(s.id === data.id && s.user_id === data.user_id));
            redraw();
        });
        source.addEventListener("clear", () => {
            state.strokes = [];
            redraw();
        });
        source.addEventListener("cursor", (event) => {
            const data = JSON.parse(event.data);
            placeCursor(data.user_id, data.x, data.y);
        });
        source.addEventListener("people", (event) => {
            state.people = JSON.parse(event.data);
            for (const [userId, cursor] of state.cursors) {
                if (state.people.some((p) => p.id === userId)) continue;
                cursor.el.remove();
                state.cursors.delete(userId);
            }
            renderPeople();
        });
        source.addEventListener("ended", () => {
            state.ended = true;
            source.close();
            showNotice("This activity has ended.");
        });
        source.addEventListener("error", () => {
            if (state.ended) return;
            showNotice(source.readyState === EventSource.CLOSED ? "Lost the connection to the board." : "Reconnecting…");
        });
        source.addEventListener("open", () => {
            if (state.me) showNotice(null);
        });
    };

    if (frameId && window.parent !== window) window.parent.postMessage([0, { v: 1, encoding: "json", client_id: applicationId, frame_id: frameId }], "*");

    layout();
    connect();
})();
