// scanner-worker.js
// Runs in a Web Worker. Uses OpenCV.js template matching to detect astrogem stats.
// Templates from: https://github.com/Airplaner/lostark-arkgrid-gem-locator-v2 (MIT) — bundled locally.

// Local paths (relative to this worker file)
const TEMPLATE_BASE = './templates/en_us/';

const THRESHOLDS = { anchor: 0.92, digit: 0.75, optName: 0.75 };

// --- Template definitions ---
const DIGIT_KEYS    = ['1','2','3','4','5','6','7','8','9'];
const WP_KEYS       = ['lv1','lv2','lv3','lv4','lv5'];
const OPT_STAT_KEYS = ['추가피해','보스피해','공격력','질서','혼돈','낙인력','아군공격강화','아군피해강화','견고','붕괴','불변','침식','안정','왜곡'];

// Stat English names & score coefficients
const STAT_INFO = {
    '추가피해':    { name: 'Add Dmg',       coeff: 1.85 },
    '보스피해':    { name: 'Boss Dmg',      coeff: 2.55 },
    '공격력':      { name: 'ATK',           coeff: 1.00 },
    '질서':        { name: 'Order',         coeff: 0    }, // gemAttr stat, not option
    '혼돈':        { name: 'Chaos',         coeff: 0    },
    '낙인력':      { name: 'Brand',         coeff: 1.00 },
    '아군공격강화':{ name: 'Ally Atk Buff', coeff: 1.00 },
    '아군피해강화':{ name: 'Ally Dmg Buff', coeff: 1.00 },
    '견고':        { name: 'Fortify',       coeff: 0.50 },
    '붕괴':        { name: 'Collapse',      coeff: 0.50 },
    '불변':        { name: 'Immutable',     coeff: 0.50 },
    '침식':        { name: 'Erode',         coeff: 0.50 },
    '안정':        { name: 'Stable',        coeff: 0.50 },
    '왜곡':        { name: 'Warp',          coeff: 0.50 },
};

let cv = null;
let templates = {};   // { key: cv.Mat }
let initialized = false;

// --- OpenCV init (bundled locally) ---
self.importScripts('./opencv.js');

function waitForOpenCV() {
    return new Promise((resolve) => {
        if (typeof cv !== 'undefined' && cv.Mat) { resolve(); return; }
        Module['onRuntimeInitialized'] = resolve;
    });
}

// --- Template loading ---
async function fetchTemplate(filename) {
    const url = TEMPLATE_BASE + encodeURIComponent(filename);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch template: ' + filename);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    const mat = cv.matFromImageData(imgData);
    cv.cvtColor(mat, mat, cv.COLOR_RGBA2GRAY);
    return mat;
}

async function loadTemplates() {
    const all = [];
    all.push({ key: 'anchor', file: 'anchor.png' });
    DIGIT_KEYS.forEach(k => all.push({ key: 'd_' + k, file: k + '.png' }));
    WP_KEYS.forEach(k    => all.push({ key: 'w_' + k, file: k + '.png' }));
    OPT_STAT_KEYS.forEach(k => all.push({ key: 'n_' + k, file: k + '.png' }));

    let loaded = 0;
    for (const { key, file } of all) {
        try {
            templates[key] = await fetchTemplate(file);
            loaded++;
            self.postMessage({ type: 'loading', loaded, total: all.length });
        } catch (e) {
            console.warn('Could not load template', file, e.message);
        }
    }
}

// --- Template matching helpers ---
function matchOne(grayFrame, tmpl, roi) {
    if (!tmpl) return null;
    const r = new cv.Rect(
        Math.max(0, roi.x), Math.max(0, roi.y),
        Math.min(tmpl.cols + 40, roi.w),
        Math.min(tmpl.rows + 10, roi.h)
    );
    if (r.x + r.width  > grayFrame.cols) r.width  = grayFrame.cols - r.x;
    if (r.y + r.height > grayFrame.rows) r.height = grayFrame.rows - r.y;
    if (r.width <= tmpl.cols || r.height <= tmpl.rows) return null;

    const roiMat = grayFrame.roi(r);
    const result = new cv.Mat();
    try {
        cv.matchTemplate(roiMat, tmpl, result, cv.TM_CCOEFF_NORMED);
        const mm = cv.minMaxLoc(result);
        return { score: mm.maxVal, x: r.x + mm.maxLoc.x, y: r.y + mm.maxLoc.y };
    } finally {
        roiMat.delete();
        result.delete();
    }
}

function findBest(grayFrame, keyPrefix, roi, threshold) {
    let best = null;
    for (const [key, mat] of Object.entries(templates)) {
        if (!key.startsWith(keyPrefix)) continue;
        const m = matchOne(grayFrame, mat, roi);
        if (m && m.score > threshold && (!best || m.score > best.score)) {
            best = { key: key.slice(keyPrefix.length), score: m.score, x: m.x, y: m.y };
        }
    }
    return best;
}

// --- Score calculation ---
function computeScore(wpLv, cpLv, opt1Key, opt1Lv, opt2Key, opt2Lv) {
    const wpScore  = (4 - wpLv) * 2.4;
    const cpScore  = (cpLv - 4) * 5.14;
    const o1coeff  = (STAT_INFO[opt1Key] || { coeff: 1 }).coeff;
    const o2coeff  = (STAT_INFO[opt2Key] || { coeff: 1 }).coeff;
    const opt1Score = o1coeff * opt1Lv;
    const opt2Score = o2coeff * opt2Lv;
    return +(wpScore + cpScore + opt1Score + opt2Score).toFixed(2);
}

function scoreToBL(score) {
    // Empirical mapping: score range ~-16 to ~73 (90 pt range, 11 BL levels)
    const thresholds = [-8, 1, 9, 18, 27, 36, 45, 54, 63, 72];
    for (let i = 0; i < thresholds.length; i++) {
        if (score < thresholds[i]) return i;
    }
    return 10;
}

// --- Frame processor ---
let canvas = new OffscreenCanvas(1, 1);
let ctx = canvas.getContext('2d', { willReadFrequently: true });
let scannedGems = [];  // accumulated across frames
let anchorPrev = null;

function processFrame(frame, detectionMargin) {
    const dm = detectionMargin || 0;
    const h = frame.displayHeight;
    let scale = 1;
    if (h >= 1440 && h <= 1488) scale = 3 / 4;
    else if (h >= 2160 && h <= 2208) scale = 1 / 2;
    else if (h < 1080) scale = 1080 / (h - 27);

    const w = Math.round(frame.displayWidth  * scale);
    const fh = Math.round(frame.displayHeight * scale);
    canvas.width = w; canvas.height = fh;
    ctx.drawImage(frame, 0, 0, w, fh);
    frame.close();

    const imgData = ctx.getImageData(0, 0, w, fh);
    const gray = cv.matFromImageData(imgData);
    cv.cvtColor(gray, gray, cv.COLOR_RGBA2GRAY);

    try {
        // 1. Find anchor
        const anchorRoi = anchorPrev
            ? { x: anchorPrev.x - 5, y: anchorPrev.y - 5, w: templates['anchor'].cols + 10, h: templates['anchor'].rows + 10 }
            : { x: Math.floor(w / 2), y: 0, w: Math.floor(w / 2), h: Math.floor(fh / 2) };

        const anchor = findBest(gray, 'anchor', anchorRoi, THRESHOLDS.anchor - dm);
        if (!anchor) { anchorPrev = null; gray.delete(); return null; }
        anchorPrev = { x: anchor.x, y: anchor.y };

        const ax = anchor.x, ay = anchor.y;
        const newGems = [];

        // 2. Scan 9 gem rows
        for (let i = 0; i < 9; i++) {
            const rowX = ax - 287;
            const rowY = ay + 213 + 63 * i;
            if (rowY < 0 || rowY + 63 > fh) continue;

            const wp = findBest(gray, 'w_lv', { x: rowX + 65, y: rowY,      w: 30, h: 32 }, THRESHOLDS.digit - dm);
            const cp = findBest(gray, 'd_',   { x: rowX + 65, y: rowY + 30, w: 30, h: 32 }, THRESHOLDS.digit - dm);
            if (!wp || !cp) continue;

            const wpLv = parseInt(wp.key);
            const cpLv = parseInt(cp.key);

            // Option 1
            const opt1Name = findBest(gray, 'n_', { x: rowX + 125, y: rowY,      w: 220, h: 32 }, THRESHOLDS.optName - dm);
            const opt1LvX  = opt1Name ? (opt1Name.x - (rowX + 125) + (templates['n_' + opt1Name.key] ? templates['n_' + opt1Name.key].cols : 40) + 16) : 60;
            const opt1Lv   = findBest(gray, 'd_', { x: rowX + 125 + opt1LvX, y: rowY,      w: 50, h: 32 }, THRESHOLDS.digit - dm);

            // Option 2
            const opt2Name = findBest(gray, 'n_', { x: rowX + 125, y: rowY + 30, w: 220, h: 32 }, THRESHOLDS.optName - dm);
            const opt2LvX  = opt2Name ? (opt2Name.x - (rowX + 125) + (templates['n_' + opt2Name.key] ? templates['n_' + opt2Name.key].cols : 40) + 16) : 60;
            const opt2Lv   = findBest(gray, 'd_', { x: rowX + 125 + opt2LvX, y: rowY + 30, w: 50, h: 32 }, THRESHOLDS.digit - dm);

            const o1k = opt1Name ? opt1Name.key : null;
            const o2k = opt2Name ? opt2Name.key : null;
            const o1l = opt1Lv  ? parseInt(opt1Lv.key) : 0;
            const o2l = opt2Lv  ? parseInt(opt2Lv.key) : 0;

            const score = computeScore(wpLv, cpLv, o1k, o1l, o2k, o2l);
            const bl    = scoreToBL(score);

            newGems.push({
                wp: wpLv, cp: cpLv,
                opt1: o1k ? (STAT_INFO[o1k] || {}).name + ' ' + o1l : '?',
                opt2: o2k ? (STAT_INFO[o2k] || {}).name + ' ' + o2l : '?',
                score, bl
            });
        }

        // Deduplicate: use score+wp+cp as key
        newGems.forEach(g => {
            const key = g.wp + '_' + g.cp + '_' + g.score.toFixed(1);
            if (!scannedGems.find(e => (e.wp + '_' + e.cp + '_' + e.score.toFixed(1)) === key)) {
                scannedGems.push(g);
            }
        });

        return { count: scannedGems.length, newThisFrame: newGems.length };
    } finally {
        gray.delete();
    }
}

// --- Message handler ---
self.onmessage = async function(e) {
    const { type } = e.data;

    if (type === 'init') {
        try {
            await waitForOpenCV();
            cv = self.cv || globalThis.cv;
            await loadTemplates();
            initialized = true;
            self.postMessage({ type: 'ready' });
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }

    else if (type === 'frame') {
        if (!initialized || !cv) { e.data.frame.close(); return; }
        try {
            const result = processFrame(e.data.frame, e.data.detectionMargin);
            self.postMessage({
                type: 'frame:done',
                result,
                gems: scannedGems,
                minScore: scannedGems.length ? Math.min(...scannedGems.map(g => g.score)) : null,
                suggestedBL: scannedGems.length ? Math.min(...scannedGems.map(g => g.bl)) : null
            });
        } catch (err) {
            self.postMessage({ type: 'frame:done', result: null });
        }
    }

    else if (type === 'reset') {
        scannedGems = [];
        anchorPrev = null;
        self.postMessage({ type: 'reset:done' });
    }

    else if (type === 'get_results') {
        self.postMessage({
            type: 'results',
            gems: scannedGems,
            minScore: scannedGems.length ? Math.min(...scannedGems.map(g => g.score)) : null,
            suggestedBL: scannedGems.length ? Math.min(...scannedGems.map(g => g.bl)) : null
        });
    }
};
