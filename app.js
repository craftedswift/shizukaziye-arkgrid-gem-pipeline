// Global State
var astrogemData = {};
var currentThreshold = '';
var isRosterBound = false;
var currentBL = 0;

// ---- Bookmarklet & URL Parser ----

// Stat English names & score coefficients from the scanner
const STAT_COEFFS = {
    'Add Dmg': 1.85, 'Additional Damage': 1.85,
    'Boss Dmg': 2.55, 'Boss Damage': 2.55,
    'ATK': 1.00, 'Attack Power': 1.00,
    'Order': 0, 'Chaos': 0,
    'Brand': 1.00, 'Brand Power': 1.00,
    'Ally Atk Buff': 1.00, 'Ally Attack Enh.': 1.00,
    'Ally Dmg Buff': 1.00, 'Ally Damage Enh.': 1.00,
    'Fortify': 0.50, 'Collapse': 0.50,
    'Immutable': 0.50, 'Erode': 0.50,
    'Stable': 0.50, 'Warp': 0.50
};

function scoreToBL(score) {
    // User requested the suggested baseline be the ceiling of the score (e.g. 13.2 -> 14)
    return Math.ceil(score);
}

// Generate the Bookmarklet code
function initBookmarklet() {
    var toolUrl = window.location.href.split('?')[0];
    var rawJs = `javascript:(async function(){
        try {
            let gems = [];
            let triggers = Array.from(document.querySelectorAll('[data-melt-tooltip-trigger]'));
            if(triggers.length === 0) { alert('No gems found! Go to your character page on lostark.bible first.'); return; }
            
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999999;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;flex-direction:column;font-family:sans-serif;';
            overlay.innerHTML = '<div>Scanning Astrogems...</div><div id="bm-progress" style="font-size:16px;margin-top:10px;color:#80d0ff;">0 / ' + triggers.length + '</div>';
            document.body.appendChild(overlay);

            for(let i=0; i<triggers.length; i++) {
                try {
                    let t = triggers[i];
                    document.getElementById('bm-progress').innerText = (i+1) + ' / ' + triggers.length;
                    t.dispatchEvent(new MouseEvent('pointerenter', {bubbles:true}));
                    t.dispatchEvent(new MouseEvent('mouseenter', {bubbles:true}));
                    await new Promise(r => setTimeout(r, 10)); 
                    let tooltip = document.querySelector('[data-melt-tooltip-content][data-state="open"]');
                    if(tooltip) {
                        let html = tooltip.innerHTML;
                        if(html.includes('Astrogem:')) {
                            let wpMatch = html.match(/Willpower Cost.*?<span>(\\d+)/);
                            let wp = wpMatch ? parseInt(wpMatch[1]) : 0;
                            let ptMatch = html.match(/(?:Order|Chaos) Points.*?<span>(\\d+)/);
                            let cp = ptMatch ? parseInt(ptMatch[1]) : 0;
                            let opts = [];
                            let parts = html.split(/Lv\\.\\s*(\\d+)/);
                            for(let j=1; j<parts.length; j+=2) {
                                let lv = parseInt(parts[j]);
                                let textAfter = parts[j+1] || '';
                                let nameMatch = textAfter.match(/<span>([^<]+)/);
                                let name = nameMatch ? nameMatch[1].trim() : 'Unknown';
                                opts.push({name, lv});
                            }
                            gems.push({ wp, cp, opts });
                        }
                    }
                    t.dispatchEvent(new MouseEvent('pointerleave', {bubbles:true}));
                    t.dispatchEvent(new MouseEvent('mouseleave', {bubbles:true}));
                } catch(err) { console.error(err); }
            }
            overlay.remove();
            if(gems.length === 0) {
                alert('Could not find any Astrogems. Make sure your Ark Grid is visible.');
                return;
            }
            let payload = encodeURIComponent(JSON.stringify(gems));
            window.location.href = '${toolUrl}?gems=' + payload;
        } catch(e) { alert('Error: ' + e.message); }
    })();`;
    
    var compressed = rawJs.replace(/\s*[\r\n]+\s*/g, ' ');
    var btn = document.getElementById('bookmarklet-btn');
    if (btn) btn.href = compressed;
}

// Check if we arrived via Bookmarklet redirect
function checkUrlData() {
    var params = new URLSearchParams(window.location.search);
    var gemsData = params.get('gems');
    
    if (gemsData) {
        try {
            var gems = JSON.parse(decodeURIComponent(gemsData));
            var minScore = 999;
            var minGemData = null;
            
            gems.forEach(function(g) {
                // Ignore placeholder nodes or big nodes that don't have levels/stats
                if (g.wp === 0 && g.cp === 0) return;

                var wpScore = (4 - g.wp) * 2.4;
                var cpScore = (g.cp - 4) * 5.14;
                var opt1Score = 0, opt2Score = 0;
                var opt1Name = '', opt2Name = '', opt1Lv = 0, opt2Lv = 0;
                
                if (g.opts[0]) {
                    opt1Name = g.opts[0].name;
                    opt1Lv = g.opts[0].lv;
                    var c1 = STAT_COEFFS[opt1Name] || 1;
                    opt1Score = c1 * opt1Lv;
                }
                if (g.opts[1]) {
                    opt2Name = g.opts[1].name;
                    opt2Lv = g.opts[1].lv;
                    var c2 = STAT_COEFFS[opt2Name] || 1;
                    opt2Score = c2 * opt2Lv;
                }
                
                var score = wpScore + cpScore + opt1Score + opt2Score;
                if (score < minScore) {
                    minScore = score;
                    minGemData = {
                        wp: g.wp, wpScore: wpScore,
                        cp: g.cp, cpScore: cpScore,
                        opt1Name: opt1Name, opt1Lv: opt1Lv, opt1Score: opt1Score,
                        opt2Name: opt2Name, opt2Lv: opt2Lv, opt2Score: opt2Score
                    };
                }
            });
            
            if (minScore !== 999) {
                var bl = scoreToBL(minScore);
                setBL(bl);
                
                // Clear the URL so it doesn't look messy
                window.history.replaceState({}, document.title, window.location.pathname);
                
                // Scroll to controls
                document.querySelector('.controls').scrollIntoView({ behavior: 'smooth' });
                
                // Optional: show a small toast or alert
                setTimeout(function(){
                    var mathStr = 'WP ' + minGemData.wp + ' (' + minGemData.wpScore.toFixed(2) + ') + ' +
                                  'CP ' + minGemData.cp + ' (' + minGemData.cpScore.toFixed(2) + ')';
                    
                    if (minGemData.opt1Name) {
                        mathStr += '\n+ ' + minGemData.opt1Name + ' Lv.' + minGemData.opt1Lv + ' (' + minGemData.opt1Score.toFixed(2) + ')';
                    }
                    if (minGemData.opt2Name) {
                        mathStr += '\n+ ' + minGemData.opt2Name + ' Lv.' + minGemData.opt2Lv + ' (' + minGemData.opt2Score.toFixed(2) + ')';
                    }

                    alert('Successfully imported ' + gems.length + ' gems!\n\nWeakest Gem Score: ' + minScore.toFixed(2) + '\n\nMath Breakdown:\n' + mathStr + '\n\nSuggested Baseline Level set to: ' + bl);
                }, 500);
            }
        } catch(e) {
            console.error('Failed to parse gems', e);
        }
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
        initBookmarklet();
        render();
        checkUrlData();
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
    var pct = (val / 15) * 100;
    slider.style.setProperty('--pct', pct + '%');
}

function buildTicks() {
    var container = document.getElementById('slider-ticks');
    container.innerHTML = '';
    for (var i = 0; i <= 15; i++) {
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
    val = Math.max(0, Math.min(15, parseInt(val) || 0));
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

        var rarityKey = gem.type.rarity.toLowerCase(); // 'uncommon', 'rare', 'epic'
        var card = document.createElement('div');
        card.className = 'gem-card rarity-' + rarityKey;

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
                '<span class="gem-title">' +
                    '<span class="rarity-dot rarity-dot-' + rarityKey + '"></span>' +
                    gem.type.rarity + ' (' + gem.type.cost + ')' +
                '</span>' +
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
