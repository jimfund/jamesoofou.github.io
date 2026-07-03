"use strict";

const MONTH_DAYS = 365.2425 / 12;
const START_DATE_MS = Date.UTC(2026, 4, 1, 0, 0, 0);
const MILESTONES = [100, 500, 1000];
const TERMINAL_THRESHOLD_HOURS = 100000;
const CAP_STOP_FRACTION = 0.999;
const BASELINE_UPLIFT = 0.2;
const BASELINE_UPLIFT_HOURS = 13;
const DEFAULTS = {
  startHours: 26 + 53 / 60,
  doublingMonths: 2.69,
  algorithmicShare: 50,
  capHours: 100000,
  utilityExponent: 1,
  difficulty27: 0.95,
  difficulty500: 0.4,
  difficulty2000: 0.05,
  difficulty10000: 0.001,
  biweeklyThreshold: 100,
  dailyThreshold: 500,
  continuousThreshold: 1000,
};

const els = {
  app: document.querySelector(".app"),
  canvas: document.getElementById("projectionChart"),
  tooltip: document.getElementById("tooltip"),
  resetButton: document.getElementById("resetButton"),
  algorithmicShareOut: document.getElementById("algorithmicShareOut"),
  thresholdDate: document.getElementById("thresholdDate"),
};

const fields = Object.keys(DEFAULTS).reduce((acc, key) => {
  const input = document.getElementById(key);
  if (input) acc[key] = input;
  return acc;
}, {});

let currentRows = [];
let currentParams = null;
let currentTerminalCrossing = null;
let hoverRow = null;
let lastPlot = null;
let resizeQueued = false;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function sendEmbedHeight() {
  if (window.parent === window) return;
  const contentHeight = els.app
    ? els.app.getBoundingClientRect().height
    : document.body.getBoundingClientRect().height;
  window.parent.postMessage({
    type: "timehorizonprojection:resize",
    height: contentHeight,
  }, "*");
}

function queueEmbedHeight() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    sendEmbedHeight();
  });
}

function readParams() {
  const params = { ...DEFAULTS };
  for (const [key, input] of Object.entries(fields)) {
    params[key] = Number(input.value);
  }
  params.startHours = Math.max(0.01, params.startHours);
  params.doublingMonths = Math.max(0.01, params.doublingMonths);
  params.capHours = Math.max(20000, params.capHours);
  params.utilityExponent = Math.max(0, params.utilityExponent);
  params.biweeklyThreshold = Math.max(1, params.biweeklyThreshold);
  params.dailyThreshold = Math.max(params.biweeklyThreshold + 1, params.dailyThreshold);
  params.continuousThreshold = Math.max(params.dailyThreshold + 1, params.continuousThreshold);
  params.algorithmicFraction = params.algorithmicShare / 100;
  params.difficultyAnchors = [
    [27, params.difficulty27],
    [500, params.difficulty500],
    [2000, params.difficulty2000],
    [10000, params.difficulty10000],
  ];
  return params;
}

function resetParams() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (fields[key]) fields[key].value = String(value);
  }
  render();
}

function dateFromDay(day) {
  return new Date(START_DATE_MS + day * 86400000);
}

function formatDate(date, withTime = false) {
  const opts = {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  };
  if (withTime) {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
    opts.hour12 = false;
  }
  return new Intl.DateTimeFormat("en-US", opts).format(date);
}

function formatMonth(date) {
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return `${month}'${String(date.getUTCFullYear()).slice(2)}`;
}

function formatDuration(hours) {
  if (!Number.isFinite(hours)) return "inf";
  if (hours < 10) {
    return `${hours.toFixed(1)} h`;
  }
  return `${Math.round(hours).toLocaleString("en-US")} h`;
}

function formatDays(days) {
  if (!Number.isFinite(days)) return "inf";
  if (days >= 1) return `${days.toFixed(3)}d`;
  const hours = days * 24;
  if (hours >= 1) return `${hours.toFixed(2)}h`;
  const minutes = hours * 60;
  if (minutes >= 1) return `${minutes.toFixed(2)}m`;
  return `${(minutes * 60).toFixed(2)}s`;
}

function internalLabUplift(horizonHours) {
  return BASELINE_UPLIFT * (horizonHours / BASELINE_UPLIFT_HOURS);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(value < 1 ? 1 : 0)}%`;
}

function formatCountdown(ms) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(" ");
}

function logLinearInterpolate(horizonHours, points) {
  const x = Math.log(horizonHours);
  const xs = points.map(([h]) => Math.log(h));
  const ys = points.map(([, y]) => Math.log(y));
  let left = 0;

  if (x >= xs[xs.length - 1]) {
    left = xs.length - 2;
  } else {
    for (let i = 0; i < xs.length - 1; i += 1) {
      if (x <= xs[i + 1]) {
        left = i;
        break;
      }
    }
  }

  const slope = (ys[left + 1] - ys[left]) / (xs[left + 1] - xs[left]);
  return Math.exp(ys[left] + slope * (x - xs[left]));
}

function difficulty(horizonHours, params) {
  if (horizonHours >= params.capHours) return Infinity;
  const adjusted = params.difficultyAnchors.map(([h, d]) => [
    h,
    d * (1 - h / params.capHours),
  ]);
  return logLinearInterpolate(horizonHours, adjusted) / (1 - horizonHours / params.capHours);
}

function releaseRegime(horizonHours, params) {
  if (horizonHours >= params.continuousThreshold) return ["continuous", null];
  if (horizonHours >= params.dailyThreshold) return ["daily", 1];
  if (horizonHours >= params.biweeklyThreshold) return ["biweekly", 14];
  return ["monthly", MONTH_DAYS];
}

function rawProgressComponents(params) {
  const observedStartRate = 1 / (params.doublingMonths * MONTH_DAYS);
  const rawStartRate = observedStartRate * difficulty(params.startHours, params);
  const algo = rawStartRate * params.algorithmicFraction;
  return [rawStartRate - algo, algo];
}

function doublingRatePerDay(horizonHours, releasedHorizonHours, params) {
  const [nonAlgo, algoAtStart] = rawProgressComponents(params);
  const utilityFactor = Math.pow(releasedHorizonHours / params.startHours, params.utilityExponent);
  const algo = algoAtStart * utilityFactor;
  const d = difficulty(horizonHours, params);
  return (nonAlgo + algo) / d;
}

function rk4Step(logHorizon, dtDays, releasedHorizonHours, params, continuousRelease) {
  const deriv = (x) => {
    const horizon = Math.exp(x);
    const released = continuousRelease ? horizon : releasedHorizonHours;
    return Math.log(2) * doublingRatePerDay(horizon, released, params);
  };
  const k1 = deriv(logHorizon);
  const k2 = deriv(logHorizon + 0.5 * dtDays * k1);
  const k3 = deriv(logHorizon + 0.5 * dtDays * k2);
  const k4 = deriv(logHorizon + dtDays * k3);
  return logHorizon + (dtDays / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
}

function makeRow(day, horizonHours, releasedHorizonHours, params) {
  const clampedHorizon = Math.min(horizonHours, params.capHours * CAP_STOP_FRACTION);
  const rate = doublingRatePerDay(horizonHours, releasedHorizonHours, params);
  return {
    day,
    date: dateFromDay(day),
    horizonHours: clampedHorizon,
    releasedHorizonHours,
    difficulty: difficulty(clampedHorizon, params),
    doublingDays: rate <= 0 ? Infinity : 1 / rate,
    releaseRegime: releaseRegime(clampedHorizon, params)[0],
  };
}

function crossingDayForLogTarget(target, oldDay, oldLogHorizon, day, logHorizon) {
  const denominator = logHorizon - oldLogHorizon;
  if (Math.abs(denominator) < 1e-12) return day;
  const frac = (Math.log(target) - oldLogHorizon) / denominator;
  return oldDay + Math.max(0, Math.min(1, frac)) * (day - oldDay);
}

function terminalTargetHours(params) {
  if (params.capHours < TERMINAL_THRESHOLD_HOURS) return null;
  return Math.min(TERMINAL_THRESHOLD_HOURS, params.capHours * CAP_STOP_FRACTION);
}

function simulate(params) {
  let day = 0;
  let logHorizon = Math.log(params.startHours);
  let releasedHorizon = params.startHours;
  let nextReleaseDay = releaseRegime(releasedHorizon, params)[1];
  let nextSampleDay = 0;
  const capStopHours = params.capHours * CAP_STOP_FRACTION;
  const terminalTarget = terminalTargetHours(params);
  let terminalCrossing = terminalTarget !== null && params.startHours >= terminalTarget
    ? makeRow(0, params.startHours, releasedHorizon, params)
    : null;
  const rows = [];
  const milestones = new Map();
  const pendingMilestones = [...MILESTONES];
  const maxDays = 365 * 5;

  while (day < maxDays) {
    let horizon = Math.exp(logHorizon);
    if (horizon >= capStopHours) break;

    const [frontierRegime, frontierInterval] = releaseRegime(horizon, params);
    if (frontierRegime === "continuous") {
      releasedHorizon = horizon;
      nextReleaseDay = null;
    } else if (frontierInterval !== null) {
      const desiredNextReleaseDay = day + frontierInterval;
      if (nextReleaseDay === null || desiredNextReleaseDay < nextReleaseDay) {
        nextReleaseDay = desiredNextReleaseDay;
      }
    }

    if (day >= nextSampleDay - 1e-9) {
      rows.push(makeRow(day, horizon, releasedHorizon, params));
      nextSampleDay += 0.25;
    }

    if (pendingMilestones.length && horizon >= pendingMilestones[0]) {
      const milestone = pendingMilestones.shift();
      milestones.set(milestone, makeRow(day, horizon, releasedHorizon, params));
      continue;
    }

    const continuousRelease = releaseRegime(horizon, params)[0] === "continuous";
    if (continuousRelease) releasedHorizon = horizon;

    const localRate = Math.max(doublingRatePerDay(horizon, releasedHorizon, params), 1e-12);
    let dt = Math.min(0.05, 0.02 / localRate, maxDays - day);
    if (nextReleaseDay !== null) {
      dt = Math.min(dt, Math.max(nextReleaseDay - day, 0) || dt);
    }

    const oldDay = day;
    const oldLogHorizon = logHorizon;
    logHorizon = rk4Step(logHorizon, dt, releasedHorizon, params, continuousRelease);
    day += dt;
    horizon = Math.exp(logHorizon);

    if (!terminalCrossing && terminalTarget !== null && horizon >= terminalTarget) {
      const crossingDay = crossingDayForLogTarget(
        terminalTarget,
        oldDay,
        oldLogHorizon,
        day,
        logHorizon,
      );
      terminalCrossing = makeRow(crossingDay, terminalTarget, releasedHorizon, params);
    }

    while (pendingMilestones.length && horizon >= pendingMilestones[0]) {
      const target = pendingMilestones.shift();
      const crossingDay = crossingDayForLogTarget(target, oldDay, oldLogHorizon, day, logHorizon);
      milestones.set(target, makeRow(crossingDay, target, releasedHorizon, params));
    }

    if (nextReleaseDay !== null && day >= nextReleaseDay - 1e-9) {
      releasedHorizon = Math.max(releasedHorizon, horizon);
      const [, interval] = releaseRegime(horizon, params);
      nextReleaseDay = interval === null ? null : day + interval;
    }

    if (horizon >= capStopHours) {
      day = crossingDayForLogTarget(capStopHours, oldDay, oldLogHorizon, day, logHorizon);
      logHorizon = Math.log(capStopHours);
      break;
    }
  }

  const finalHorizon = Math.min(Math.exp(logHorizon), capStopHours);
  rows.push(makeRow(day, finalHorizon, releasedHorizon, params));
  return { rows, milestones, terminalCrossing };
}

function updateThresholdClock(params, terminalCrossing) {
  if (!els.thresholdDate) return;

  if (params.capHours < TERMINAL_THRESHOLD_HOURS) {
    els.thresholdDate.textContent = "AGI unreachable: cap <100k h";
    return;
  }

  if (!terminalCrossing) {
    els.thresholdDate.textContent = "AGI not reached in 5y";
    return;
  }

  const msUntilCrossing = terminalCrossing.date.getTime() - Date.now();
  if (msUntilCrossing <= 0) {
    els.thresholdDate.textContent = `AGI ${formatDate(terminalCrossing.date, true)} UTC`;
    return;
  }

  els.thresholdDate.textContent = `AGI in ${formatCountdown(msUntilCrossing)}`;
}

function monthlyRows(rows) {
  const picked = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.date.getUTCFullYear()}-${row.date.getUTCMonth()}`;
    if (!seen.has(key)) {
      picked.push(row);
      seen.add(key);
    }
  }
  const final = rows[rows.length - 1];
  if (picked[picked.length - 1] !== final) picked.push(final);
  return picked;
}

function yTicks(minHours, maxHours) {
  const candidates = [];
  for (let magnitude = 1; magnitude <= 100000; magnitude *= 10) {
    for (const multiple of [1, 2, 5]) {
      candidates.push(multiple * magnitude);
    }
  }
  return candidates.filter((h) => h >= minHours && h <= maxHours);
}

function drawChart(rows) {
  const canvas = els.canvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const pad = { top: 18, right: 42, bottom: 46, left: 92 };
  const width = rect.width - pad.left - pad.right;
  const height = rect.height - pad.top - pad.bottom;
  const minDay = rows[0].day;
  const maxDay = rows[rows.length - 1].day;
  const minY = Math.log(Math.max(1, rows[0].horizonHours * 0.8));
  const maxY = Math.log(Math.min(100000, Math.max(...rows.map((r) => r.horizonHours)) * 1.1));

  const xForDay = (day) => pad.left + ((day - minDay) / (maxDay - minDay || 1)) * width;
  const yForHours = (hours) => pad.top + (1 - (Math.log(hours) - minY) / (maxY - minY || 1)) * height;
  const ink = cssVar("--ink") || "#191713";
  const muted = cssVar("--muted") || "#6f675d";
  const grid = cssVar("--grid") || "#e8e0d3";
  const panel = cssVar("--panel") || "#ffffff";
  const accent = cssVar("--accent") || "#e33821";
  const accent3 = cssVar("--accent-3") || "#e33821";

  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = muted;
  ctx.font = "12px \"IBM Plex Mono\", ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (const tick of yTicks(Math.exp(minY), Math.exp(maxY))) {
    const y = yForHours(tick);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(rect.width - pad.right, y);
    ctx.stroke();
    ctx.fillText(formatDuration(tick), pad.left - 8, y);
  }

  const monthMarks = monthlyRows(rows);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  monthMarks.forEach((row, index) => {
    const x = xForDay(row.day);
    ctx.strokeStyle = grid;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, rect.height - pad.bottom);
    ctx.stroke();
    if (index === monthMarks.length - 1) {
      return;
    }
    ctx.fillStyle = muted;
    ctx.fillText(formatMonth(row.date), x, rect.height - pad.bottom + 12);
  });

  ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, rect.height - pad.bottom);
  ctx.lineTo(rect.width - pad.right, rect.height - pad.bottom);
  ctx.stroke();

  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = xForDay(row.day);
    const y = yForHours(row.horizonHours);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  if (hoverRow) {
    const x = xForDay(hoverRow.day);
    const y = yForHours(hoverRow.horizonHours);
    ctx.strokeStyle = accent3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, rect.height - pad.bottom);
    ctx.stroke();
    ctx.fillStyle = accent3;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  lastPlot = { pad, width, height, minDay, maxDay, minY, maxY, xForDay, yForHours, rect };
}

function updateTooltip(event) {
  if (!lastPlot || !currentRows.length) return;
  const rect = els.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const day = lastPlot.minDay + ((x - lastPlot.pad.left) / lastPlot.width) * (lastPlot.maxDay - lastPlot.minDay);
  let best = currentRows[0];
  let bestDistance = Infinity;
  for (const row of currentRows) {
    const distance = Math.abs(row.day - day);
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  hoverRow = best;
  drawChart(currentRows);

  const pointX = lastPlot.xForDay(best.day);
  const pointY = lastPlot.yForHours(best.horizonHours);
  els.tooltip.hidden = false;
  els.tooltip.innerHTML = `
    <strong>${formatDuration(best.horizonHours)}</strong>
    <span>${formatDate(best.date, true)}</span>
    <span>Uplift: ${formatPercent(internalLabUplift(best.horizonHours))}</span>
    <span>Released: ${formatDuration(best.releasedHorizonHours)}</span>
    <span>Doubling: ${formatDays(best.doublingDays)}</span>
  `;
  const left = Math.min(Math.max(10, pointX + 14), rect.width - 200);
  const top = Math.min(Math.max(10, pointY - 38), rect.height - 112);
  els.tooltip.style.left = `${left}px`;
  els.tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  hoverRow = null;
  els.tooltip.hidden = true;
  drawChart(currentRows);
}

function render() {
  els.algorithmicShareOut.textContent = `${fields.algorithmicShare.value}%`;
  const params = readParams();
  const { rows, milestones, terminalCrossing } = simulate(params);
  currentRows = rows;
  currentParams = params;
  currentTerminalCrossing = terminalCrossing;
  updateThresholdClock(currentParams, currentTerminalCrossing);
  drawChart(rows);
  queueEmbedHeight();
}

for (const input of Object.values(fields)) {
  input.addEventListener("input", render);
}

els.resetButton.addEventListener("click", resetParams);
els.canvas.addEventListener("pointermove", updateTooltip);
els.canvas.addEventListener("pointerleave", hideTooltip);
window.addEventListener("resize", () => {
  drawChart(currentRows);
  queueEmbedHeight();
});

window.setInterval(() => {
  if (currentParams) updateThresholdClock(currentParams, currentTerminalCrossing);
}, 60000);

if ("ResizeObserver" in window) {
  new ResizeObserver(queueEmbedHeight).observe(els.app || document.body);
}

render();
