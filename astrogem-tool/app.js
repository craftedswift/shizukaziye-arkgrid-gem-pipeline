// Global State
var astrogemData = {};
var currentThreshold = '';
var isRosterBound = false;
var currentBL = 0;

// ---- Scanner State ----
var scanWorker = null;
var scanStream = null;
var scanTrack  = null;
var scanReader = null;
var scanRunning = false;
var suggestedBL = null;
var scanWorkerReady = false;

function startScan() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert('Screen capture is not supported in this browser.\nPlease use Chrome or Edge.');
        return;
    }
    // Initialize worker first time
    if (!scanWorker) {
        document.getElementById('scanner-status').style.display = 'block';
        document.getElementById('scanner-msg').textContent = 'Initializing OpenCV...';
        document.getElementById('scan-btn').disabled = true;

        scanWorker = new Worker('scanner-worker.js');
        scanWorker.onmessage = handleWorkerMsg;
        scanWorker.onerror   = function(e) {
            setScanMsg('Worker error: ' + e.message, true);
            resetScanUI();
        };
        scanWorker.postMessage({ type: 'init' });
    } else if (scanWorkerReady) {
        beginCapture();
    }
}

function handleWorkerMsg(e) {
    var d = e.data;
    if (d.type === 'loading') {
        setScanMsg('Loading templates... ' + d.loaded + '/' + d.total);
    }
    else if (d.type === 'ready') {
        scanWorkerReady = true;
        setScanMsg('Ready — share your Lost Ark window.');
        document.getElementById('scan-btn').disabled = false;
        beginCapture();
    }
    else if (d.type === 'error') {
        setScanMsg('Error: ' + d.message, true);
        resetScanUI();
    }
    else if (d.type === 'frame:done') {
        if (d.result && d.gems && d.gems.length > 0) {
            document.getElementById('scanner-results').style.display = 'block';
            document.getElementById('scan-gem-count').textContent = d.gems.length;
            document.getElementById('scan-min-score').textContent  = d.minScore !== null ? d.minScore.toFixed(1) : '—';
            document.getElementById('scan-suggested-bl').textContent = d.suggestedBL !== null ? d.suggestedBL : '—';
            if (d.suggestedBL !== null) {
                suggestedBL = d.suggestedBL;
                document.getElementById('apply-bl-btn').style.display = 'inline-flex';
            }
            setScanMsg('Scanning... scroll through your gem bag slowly.');
        }
        // send next frame
        if (scanRunning) readNextFrame();
    }
    else if (d.type === 'reset:done') {
        readNextFrame();
    }
}

async function beginCapture() {
    try {
        setScanMsg('Waiting for screen share permission...');
        var stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
        scanStream = stream;
        scanTrack  = stream.getVideoTracks()[0];
        var processor = new MediaStreamTrackProcessor({ track: scanTrack });
        scanReader = processor.readable.getReader();

        // Reset worker state
        scanWorker.postMessage({ type: 'reset' });
        scanRunning = true;

        document.getElementById('scan-btn').style.display  = 'none';
        document.getElementById('stop-btn').style.display  = 'inline-flex';
        setScanMsg('Scanning... scroll through your gem bag slowly.');

        // Listen for user stopping share
        scanTrack.addEventListener('ended', stopScan);

    } catch(err) {
        if (err.name === 'NotAllowedError') {
            setScanMsg('Screen share was cancelled.', false);
            document.getElementById('scan-btn').disabled = false;
        } else {
            setScanMsg('Error: ' + err.message, true);
        }
    }
}

function readNextFrame() {
    if (!scanReader || !scanRunning) return;
    scanReader.read().then(function(result) {
        if (result.done || !result.value) { stopScan(); return; }
        scanWorker.postMessage({ type: 'frame', frame: result.value }, [result.value]);
    }).catch(function() { stopScan(); });
}

function stopScan() {
    scanRunning = false;
    if (scanTrack) { scanTrack.stop(); scanTrack = null; }
    if (scanStream) { scanStream.getTracks().forEach(function(t){ t.stop(); }); scanStream = null; }
    scanReader = null;
    document.getElementById('scan-btn').style.display  = 'inline-flex';
    document.getElementById('stop-btn').style.display  = 'none';
    document.getElementById('scan-btn').disabled = false;
    if (suggestedBL !== null) {
        setScanMsg('Scan complete. ' + document.getElementById('scan-gem-count').textContent + ' gems found. Suggested BL: ' + suggestedBL);
    } else {
        setScanMsg('Scan stopped. Open your Astrogem bag in-game and try again.');
    }
}

function applySuggestedBL() {
    if (suggestedBL !== null) {
        setBL(suggestedBL);
        // Scroll to controls
        document.querySelector('.controls').scrollIntoView({ behavior: 'smooth' });
    }
}

function resetScanUI() {
    document.getElementById('scan-btn').style.display  = 'inline-flex';
    document.getElementById('stop-btn').style.display  = 'none';
    document.getElementById('scan-btn').disabled = false;
}

function setScanMsg(msg, isError) {
    var el = document.getElementById('scanner-msg');
    if (el) {
        el.textContent = msg;
        el.style.color = isError ? '#f87171' : '';
    }
}

function toggleGlossary(open) {
    var overlay = document.getElementById('glossary-overlay');
    if (open) {
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    } else {
        overlay.classList.remove('open');
        document.body.style.overflow = '';
    }
}
function closeGlossary(e) {
    // Close when clicking the backdrop (not the modal itself)
    if (e.target === document.getElementById('glossary-overlay')) {
        toggleGlossary(false);
    }
}
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') toggleGlossary(false);
});

// All known threshold keys (match table IDs like tbl_500k_nrb)
var THRESHOLDS = ['500k', '1M', '1.5M', '2.5M', '3.5M', '5M', '7.5M', '10M'];

// Gem column labels
var GEM_TYPES = [
    { rarity: 'Uncommon', cost: 8 },
    { rarity: 'Uncommon', cost: 9 },
    { rarity: 'Uncommon', cost: 10 },
    { rarity: 'Rare',     cost: 8 },
    { rarity: 'Rare',     cost: 9 },
    { rarity: 'Rare',     cost: 10 },
    { rarity: 'Epic',     cost: 8 },
    { rarity: 'Epic',     cost: 9 },
    { rarity: 'Epic',     cost: 10 },
];

function init() {
    try {
        if (typeof RAW_HTML_B64 === 'undefined') {
            throw new Error('RAW_HTML_B64 is not defined. Ensure raw_html.js is loaded.');
        }

        // Decode base64 → UTF-8 string safely
        var binary = atob(RAW_HTML_B64);
        var bytes  = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        var htmlText = new TextDecoder('utf-8').decode(bytes);

        parseData(htmlText);

        var found = Object.keys(astrogemData);
        if (found.length === 0) {
            throw new Error('No threshold tables found in data.');
        }

        document.getElementById('loader').style.display = 'none';
        document.getElementById('app').style.display = 'block';

        setupUI();
        render();
    } catch (err) {
        console.error(err);
        document.getElementById('loader').innerHTML =
            '<p style="color:#f87171;max-width:500px;text-align:center">' +
            '<strong>Error loading data.</strong><br>' + err.message + '</p>';
    }
}

function getActionClass(bg) {
    if (!bg) return 'action-ignore';
    bg = bg.toLowerCase().replace(/\s/g, '');
    if (bg.includes('#2d8a4e')) return 'action-reset';
    if (bg.includes('#5a2020')) return 'action-ignore';
    if (bg.includes('#5b3a8c')) return 'action-fuse';
    return 'action-cut';
}

function parseData(htmlText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(htmlText, 'text/html');

    THRESHOLDS.forEach(function(threshold) {
        var tblNrb = doc.getElementById('tbl_' + threshold + '_nrb');
        var tblRb  = doc.getElementById('tbl_' + threshold + '_rb');

        if (!tblNrb && !tblRb) return;

        astrogemData[threshold] = { nrb: {}, rb: {} };

        if (tblNrb) astrogemData[threshold].nrb = parseTable(tblNrb);
        if (tblRb)  astrogemData[threshold].rb  = parseTable(tblRb);
    });
}

function parseTable(table) {
    var dataByBL = {};
    var rows = table.querySelectorAll('tr');

    for (var i = 2; i < rows.length; i++) {
        var tr  = rows[i];
        var tds = tr.querySelectorAll('td');
        if (tds.length < 11) continue;

        var bl = parseInt(tds[0].textContent.trim());
        if (isNaN(bl)) continue;

        var blData = { gems: [], pipeline: {} };

        for (var g = 0; g < 9; g++) {
            var td  = tds[g + 1];
            var bkt = td.querySelector('.bkt');
            if (!bkt) { blData.gems.push(null); continue; }

            var hdrEl = bkt.querySelector('.bkt-hdr');
            var hdr   = hdrEl ? hdrEl.textContent.trim() : '0';

            var bktRows = bkt.querySelectorAll('.bkt-row');
            var buckets = [];
            for (var r = 0; r < bktRows.length; r++) {
                var row       = bktRows[r];
                var styleAttr = row.getAttribute('style') || '';
                var bgMatch   = styleAttr.match(/background:([^;]+)/);
                var bg        = bgMatch ? bgMatch[1].trim() : '';
                var resetEl   = row.querySelector('.bkt-reset');

                buckets.push({
                    label:    (row.querySelector('.bkt-label') || {}).textContent || '',
                    val:      (row.querySelector('.bkt-val')   || {}).textContent || '',
                    pct:      (row.querySelector('.bkt-pct')   || {}).textContent || '',
                    hasReset: resetEl ? resetEl.textContent.indexOf('\u21bb') !== -1 : false,
                    action:   getActionClass(bg)
                });
            }

            blData.gems.push({ type: GEM_TYPES[g], ev: hdr, buckets: buckets });
        }

        blData.pipeline = {
            boxes:      tds[10].textContent.trim(),
            boxEV:      tds[11].textContent.trim(),
            directWk:   tds[12].textContent.trim(),
            fuseWk:     tds[13].textContent.trim(),
            totalWk:    tds[14].textContent.trim(),
            weeks:      tds[15].textContent.trim(),
            weeksClass: tds[15].className,
            gold:       tds[16].textContent.trim(),
            avgScore:   tds[17].textContent.trim(),
            totalScore: tds[18].textContent.trim(),
            cpGain:     tds[19].textContent.trim()
        };

        dataByBL[bl] = blData;
    }

    return dataByBL;
}

// ---- Slider helpers ----

function getMinBL(threshold, mode) {
    var data = astrogemData[threshold] && astrogemData[threshold][mode];
    if (!data) return 0;
    var keys = Object.keys(data).map(Number).sort(function(a, b) { return a - b; });
    return keys.length > 0 ? keys[0] : 0;
}

function updateSliderFill(val) {
    var slider = document.getElementById('baseline-level');
    var pct = (val / 10) * 100;
    slider.style.setProperty('--pct', pct + '%');
}

function buildTicks() {
    var container = document.getElementById('slider-ticks');
    container.innerHTML = '';
    for (var i = 0; i <= 10; i++) {
        var span = document.createElement('span');
        span.className = 'slider-tick' + (i === currentBL ? ' active' : '');
        span.textContent = i;
        span.setAttribute('data-bl', i);
        (function(v) {
            span.addEventListener('click', function() { setBL(v); });
        })(i);
        container.appendChild(span);
    }
}

function updateTickHighlight() {
    document.querySelectorAll('.slider-tick').forEach(function(t) {
        t.classList.toggle('active', parseInt(t.getAttribute('data-bl')) === currentBL);
    });
}

function setBL(val) {
    val = Math.max(0, Math.min(10, parseInt(val) || 0));
    currentBL = val;
    document.getElementById('baseline-level').value   = val;
    document.getElementById('baseline-display').textContent = val;
    document.getElementById('current-bl').textContent = val;
    updateSliderFill(val);
    updateTickHighlight();
    render();
}

// ---- UI Setup ----

function setupUI() {
    var thresholdSelect = document.getElementById('gold-threshold');

    THRESHOLDS.forEach(function(t) {
        if (!astrogemData[t]) return;
        var opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t + ' gold / 1%';
        thresholdSelect.appendChild(opt);
    });

    currentThreshold = thresholdSelect.value;

    // Initialize slider visuals
    buildTicks();
    updateSliderFill(currentBL);

    // Threshold dropdown change → auto-snap to min available BL
    thresholdSelect.addEventListener('change', function(e) {
        currentThreshold = e.target.value;
        var mode  = isRosterBound ? 'rb' : 'nrb';
        var minBL = getMinBL(currentThreshold, mode);
        setBL(minBL);
    });

    // Roster-bound toggle
    document.getElementById('binding-toggle').addEventListener('change', function(e) {
        isRosterBound = e.target.checked;
        var minBL = getMinBL(currentThreshold, isRosterBound ? 'rb' : 'nrb');
        if (currentBL < minBL) setBL(minBL); else render();
    });

    // Slider
    document.getElementById('baseline-level').addEventListener('input', function(e) {
        setBL(e.target.value);
    });
}

// ---- Render ----

function render() {
    if (!astrogemData[currentThreshold]) return;

    var mode = isRosterBound ? 'rb' : 'nrb';
    var data = astrogemData[currentThreshold][mode];

    if (!data || data[currentBL] === undefined) {
        document.getElementById('gems-grid').innerHTML =
            '<p style="color:var(--text-muted)">No data for BL ' + currentBL + ' at this threshold.</p>';
        document.getElementById('pipeline-stats').innerHTML = '';
        return;
    }

    var blData = data[currentBL];

    // --- Gems Grid ---
    var grid = document.getElementById('gems-grid');
    grid.innerHTML = '';

    blData.gems.forEach(function(gem) {
        if (!gem) return;

        var card = document.createElement('div');
        card.className = 'gem-card';

        var bucketsHtml = '';
        gem.buckets.forEach(function(b) {
            bucketsHtml +=
                '<div class="bucket-row ' + b.action + '">' +
                    '<span class="bucket-label">' + b.label.trim() + '</span>' +
                    '<span class="bucket-val">'   + b.val.trim()   + '</span>' +
                    '<span class="bucket-pct">'   + b.pct.trim()   + '</span>' +
                    '<span class="bucket-icon">'  + (b.hasReset ? '\u21bb' : '') + '</span>' +
                '</div>';
        });

        card.innerHTML =
            '<div class="gem-header">' +
                '<span class="gem-title">' + gem.type.rarity + ' (' + gem.type.cost + ')</span>' +
                '<span class="gem-ev">EV: ' + gem.ev + '</span>' +
            '</div>' +
            '<div class="gem-buckets">' + bucketsHtml + '</div>';

        grid.appendChild(card);
    });

    // --- Pipeline Summary ---
    var p          = blData.pipeline;
    var weeksColor = p.weeksClass.indexOf('fast') !== -1 ? 'fast'
                   : p.weeksClass.indexOf('slow') !== -1 ? 'slow' : '';

    document.getElementById('pipeline-stats').innerHTML =
        '<div class="stat-box">' +
            '<div class="stat-label">Weeks to Fill</div>' +
            '<div class="stat-value ' + weeksColor + '">' + p.weeks + '</div>' +
        '</div>' +
        '<div class="stat-box">' +
            '<div class="stat-label">Direct / wk</div>' +
            '<div class="stat-value">' + p.directWk + '</div>' +
        '</div>' +
        '<div class="stat-box">' +
            '<div class="stat-label">Fusion / wk</div>' +
            '<div class="stat-value">' + p.fuseWk + '</div>' +
        '</div>' +
        '<div class="stat-box">' +
            '<div class="stat-label">Total Gems / wk</div>' +
            '<div class="stat-value">' + p.totalWk + '</div>' +
        '</div>' +
        '<div class="stat-box">' +
            '<div class="stat-label">Gold / wk</div>' +
            '<div class="stat-value" style="font-size:1rem;color:white">' + p.gold + '</div>' +
        '</div>' +
        '<div class="stat-box">' +
            '<div class="stat-label">Avg Gem Score</div>' +
            '<div class="stat-value">' + p.avgScore + '</div>' +
        '</div>' +
        '<div class="stat-box">' +
            '<div class="stat-label">Total Score</div>' +
            '<div class="stat-value">' + p.totalScore + '</div>' +
        '</div>' +
        '<div class="stat-box">' +
            '<div class="stat-label">CP% Gain</div>' +
            '<div class="stat-value highlight">' + p.cpGain + '</div>' +
        '</div>';
}

window.addEventListener('DOMContentLoaded', init);
