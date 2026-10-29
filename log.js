// ============================================================
// log.js v2 — Smartgate Pro Data Logger
// ✅ เก็บ log ลง "ไฟล์ .txt" จริงแบบ real-time
//    - File System Access API: เขียนต่อเนื่องลงไฟล์ที่เลือก
//    - Fallback: Blob download เป็น .txt
// ✅ Auto-flush ทุก 1 วินาที
// ✅ Summary: protocol ไหนอ่าน PID อะไรได้บ้าง
// ============================================================

(function () {
    'use strict';

    const LOG_STORAGE_KEY = 'sg_pro_log_v2';
    const SUMMARY_STORAGE_KEY = 'sg_pro_summary_v2';
    const MAX_LOG_ENTRIES = 5000;
    const AUTO_FLUSH_MS = 1000;

    let logs = [];
    let summary = {};
    let sessionStart = Date.now();
    let protocolTag = 'UNKNOWN';
    let vehicleProfile = 'pcx160';

    let fileHandle = null;
    let fileWritable = null;
    let fileWriteQueue = [];
    let isWriting = false;
    let flushTimer = null;

    function loadFromStorage() {
        try {
            const raw = localStorage.getItem(LOG_STORAGE_KEY);
            if (raw) logs = JSON.parse(raw) || [];
            const rawSum = localStorage.getItem(SUMMARY_STORAGE_KEY);
            if (rawSum) summary = JSON.parse(rawSum) || {};
        } catch (e) {
            console.warn('[SGLog] Load failed:', e);
            logs = [];
            summary = {};
        }
    }

    function saveToStorage() {
        try {
            if (logs.length > MAX_LOG_ENTRIES) logs = logs.slice(-MAX_LOG_ENTRIES);
            localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs));
            localStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(summary));
        } catch (e) {
            console.warn('[SGLog] Save failed:', e);
        }
    }

    function enqueueFileWrite(text) {
        if (!fileWritable) return;
        fileWriteQueue.push(text);
        scheduleFlush();
    }

    function scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(flushToFile, AUTO_FLUSH_MS);
    }

    async function flushToFile() {
        flushTimer = null;
        if (isWriting) return;
        if (!fileWritable || fileWriteQueue.length === 0) return;
        isWriting = true;
        try {
            const chunk = fileWriteQueue.join('');
            fileWriteQueue = [];
            await fileWritable.write(chunk);
        } catch (e) {
            console.warn('[SGLog] File write failed:', e);
            fileWritable = null;
            fileHandle = null;
        } finally {
            isWriting = false;
            if (fileWriteQueue.length > 0) scheduleFlush();
        }
    }

    function buildFileHeader() {
        const lines = [];
        lines.push('═══════════════════════════════════════════════════════════');
        lines.push('  SMARTGATE PRO — SESSION LOG');
        lines.push('═══════════════════════════════════════════════════════════');
        lines.push(`Session Start : ${new Date(sessionStart).toLocaleString('th-TH')}`);
        lines.push(`Vehicle       : ${vehicleProfile}`);
        lines.push(`Device        : ${(navigator.userAgent.match(/(Android|iPhone|iPad)[^;)]*/) || ['Unknown'])[0]}`);
        lines.push(`User Agent    : ${navigator.userAgent}`);
        lines.push('');
        lines.push('─── RAW LOG (chronological) ─────────────────────────────');
        lines.push('');
        return lines.join('\n') + '\n';
    }

    function buildFileFooter() {
        const lines = [];
        lines.push('');
        lines.push('');
        lines.push('═══════════════════════════════════════════════════════════');
        lines.push('  SUMMARY — PROTOCOL × PID MATRIX');
        lines.push('═══════════════════════════════════════════════════════════');
        lines.push(`Export Time : ${new Date().toLocaleString('th-TH')}`);
        lines.push(`Total Logs  : ${logs.length}`);
        lines.push('');

        const protos = Object.keys(summary);
        if (protos.length === 0) {
            lines.push('(no protocols tried yet)');
        } else {
            protos.forEach(proto => {
                lines.push('');
                lines.push(`▶ PROTOCOL: ${proto}`);
                const pids = summary[proto];
                const pidKeys = Object.keys(pids).sort();
                const okPids = pidKeys.filter(p => !pids[p].failCount || pids[p].count > 0);
                const failPids = pidKeys.filter(p => pids[p].failCount && pids[p].count === 0);

                if (okPids.length > 0) {
                    lines.push('  ✅ WORKING PIDs:');
                    okPids.forEach(pid => {
                        const s = pids[pid];
                        lines.push(`     ${pid}  ${(s.label || '').padEnd(14)} = ${s.lastVal}${s.lastUnit || ''}   (${s.count} reads)`);
                        if (s.rawSamples && s.rawSamples.length) {
                            lines.push(`           raw samples: ${s.rawSamples.join(', ')}`);
                        }
                    });
                }
                if (failPids.length > 0) {
                    lines.push('  ❌ FAILED PIDs:');
                    failPids.forEach(pid => {
                        const s = pids[pid];
                        lines.push(`     ${pid}  ${(s.label || '').padEnd(14)} → ${s.lastReason || 'FAIL'}   (${s.failCount} fails)`);
                    });
                }
            });
        }
        lines.push('');
        lines.push('═══════════════════════════════════════════════════════════');
        lines.push('  END OF LOG');
        lines.push('═══════════════════════════════════════════════════════════');
        return lines.join('\n');
    }

    function formatLogEntry(entry) {
        const t = entry.t.substr(11, 12);
        const lvl = (entry.level || 'INFO').padEnd(8);
        const proto = (entry.proto || '').padEnd(24);
        let line = `[${t}] [${lvl}] [${proto}] ${entry.msg}`;
        if (entry.data) line += `  ${JSON.stringify(entry.data)}`;
        return line + '\n';
    }

    async function openLogFile() {
        if (!window.showSaveFilePicker) return false;
        try {
            const ts = new Date().toISOString().replace(/[:.]/g, '-').substr(0, 19);
            fileHandle = await window.showSaveFilePicker({
                suggestedName: `sgpro-log-${vehicleProfile}-${ts}.txt`,
                types: [{ description: 'Text log file', accept: { 'text/plain': ['.txt'] } }],
            });
            fileWritable = await fileHandle.createWritable();
            await fileWritable.write(buildFileHeader());
            console.log('%c[SGLog] ✅ File opened — logging to .txt in real-time', 'color:#00ff88;font-weight:bold');
            return true;
        } catch (e) {
            if (e.name !== 'AbortError') console.warn('[SGLog] File open failed:', e);
            fileHandle = null;
            fileWritable = null;
            return false;
        }
    }

    async function closeLogFile() {
        if (!fileWritable) return;
        try {
            await flushToFile();
            await fileWritable.write(buildFileFooter());
            await fileWritable.close();
            console.log('%c[SGLog] 📁 Log file closed & saved', 'color:#00ff88;font-weight:bold');
        } catch (e) {
            console.warn('[SGLog] Close failed:', e);
        }
        fileWritable = null;
        fileHandle = null;
    }

    function downloadBlob(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    }

    function buildFullText() {
        const lines = [buildFileHeader()];
        logs.forEach(e => lines.push(formatLogEntry(e)));
        lines.push(buildFileFooter());
        return lines.join('');
    }

    const SGLog = {

        start: async function () {
            if (fileWritable) return true;
            return await openLogFile();
        },

        stop: async function () {
            if (fileWritable) { await closeLogFile(); return; }
            const content = buildFullText();
            const ts = new Date().toISOString().replace(/[:.]/g, '-').substr(0, 19);
            downloadBlob(content, `sgpro-log-${vehicleProfile}-${ts}.txt`);
            console.log('%c[SGLog] 📥 Downloaded log', 'color:#00ff88;font-weight:bold');
        },

        setVehicle: function (profile) {
            vehicleProfile = profile || 'pcx160';
            this.info(`Vehicle profile: ${vehicleProfile}`);
        },

        setProtocol: function (tag) {
            protocolTag = tag || 'UNKNOWN';
            this.info(`Protocol set: ${protocolTag}`);
        },

        debug: function (msg, data) { this._log('DEBUG', msg, data); },
        info: function (msg, data) { this._log('INFO', msg, data); },
        warn: function (msg, data) { this._log('WARN', msg, data); },
        error: function (msg, data) { this._log('ERROR', msg, data); },
        tx: function (cmd) { this._log('TX', cmd, null); },
        rx: function (raw) { this._log('RX', raw, null); },

        pid: function (pidHex, label, val, unit, rawHex) {
            const ts = Date.now();
            this._log('PID', `${pidHex} ${label}=${val}${unit}`, { rawHex });
            if (!summary[protocolTag]) summary[protocolTag] = {};
            if (!summary[protocolTag][pidHex]) {
                summary[protocolTag][pidHex] = {
                    label, count: 0, lastVal: val, lastUnit: unit,
                    firstSeen: ts, lastSeen: ts, rawSamples: [],
                };
            }
            const s = summary[protocolTag][pidHex];
            s.count++;
            s.lastVal = val;
            s.lastUnit = unit;
            s.lastSeen = ts;
            if (s.rawSamples.length < 3) s.rawSamples.push(rawHex);
            saveToStorage();
        },

        pidFail: function (pidHex, label, reason) {
            const ts = Date.now();
            this._log('PID-FAIL', `${pidHex} ${label} → ${reason}`, null);
            if (!summary[protocolTag]) summary[protocolTag] = {};
            if (!summary[protocolTag][pidHex]) {
                summary[protocolTag][pidHex] = {
                    label, count: 0, failCount: 0, lastReason: reason,
                    firstSeen: ts, lastSeen: ts, rawSamples: [],
                };
            }
            const s = summary[protocolTag][pidHex];
            s.failCount = (s.failCount || 0) + 1;
            s.lastReason = reason;
            s.lastSeen = ts;
            saveToStorage();
        },

        _log: function (level, msg, data) {
            const entry = {
                ts: Date.now(),
                t: new Date().toISOString(),
                level, proto: protocolTag, veh: vehicleProfile,
                msg, data: data || null,
            };
            logs.push(entry);
            enqueueFileWrite(formatLogEntry(entry));
            saveToStorage();

            const color = level === 'ERROR' ? '#ff4444'
                : level === 'WARN' ? '#ffaa00'
                    : level === 'PID' ? '#00ff88'
                        : level === 'PID-FAIL' ? '#ff8888'
                            : level === 'TX' ? '#00d2ff'
                                : level === 'RX' ? '#aaaaff'
                                    : '#cccccc';
            console.log(`%c[SGLog ${entry.t.substr(11, 8)}] [${level}] [${protocolTag}] ${msg}`,
                `color:${color};font-weight:bold;`);
        },

        getSummary: function () { return summary; },

        printSummary: function () {
            console.log('%c╔══════════════════════════════════════════════╗', 'color:#00ff88');
            console.log('%c║  SMARTGATE PRO — DATA COLLECTION SUMMARY    ║', 'color:#00ff88;font-weight:bold');
            console.log('%c╚══════════════════════════════════════════════╝', 'color:#00ff88');
            console.log(`Vehicle: ${vehicleProfile}`);
            console.log(`Total logs: ${logs.length}`);
            console.log(`File logging: ${fileWritable ? '✅ ON' : '❌ OFF'}`);
            console.log('');
            const protos = Object.keys(summary);
            protos.forEach(proto => {
                console.log(`%c▶ PROTOCOL: ${proto}`, 'color:#00d2ff;font-weight:bold');
                const pids = summary[proto];
                const pidKeys = Object.keys(pids).sort();
                const okPids = pidKeys.filter(p => !pids[p].failCount || pids[p].count > 0);
                const failPids = pidKeys.filter(p => pids[p].failCount && pids[p].count === 0);
                if (okPids.length > 0) {
                    console.log('%c  ✅ WORKING PIDs:', 'color:#00ff88');
                    okPids.forEach(pid => {
                        const s = pids[pid];
                        console.log(`     ${pid}  ${(s.label || '').padEnd(12)} = ${s.lastVal}${s.lastUnit || ''}  (${s.count} reads)`);
                    });
                }
                if (failPids.length > 0) {
                    console.log('%c  ❌ FAILED PIDs:', 'color:#ff8888');
                    failPids.forEach(pid => {
                        const s = pids[pid];
                        console.log(`     ${pid}  ${(s.label || '').padEnd(12)} → ${s.lastReason}  (${s.failCount} fails)`);
                    });
                }
                console.log('');
            });
        },

        download: function () {
            const content = buildFullText();
            const ts = new Date().toISOString().replace(/[:.]/g, '-').substr(0, 19);
            downloadBlob(content, `sgpro-log-${vehicleProfile}-${ts}.txt`);
            this.info('📥 Downloaded log');
        },

        clear: function () {
            if (!confirm('ล้าง log ทั้งหมดหรือไม่?')) return;
            logs = [];
            summary = {};
            sessionStart = Date.now();
            localStorage.removeItem(LOG_STORAGE_KEY);
            localStorage.removeItem(SUMMARY_STORAGE_KEY);
            console.log('%c[SGLog] Cleared all logs', 'color:#ffaa00;font-weight:bold');
        },

        status: function () {
            return {
                entries: logs.length,
                protocols: Object.keys(summary),
                vehicle: vehicleProfile,
                fileLogging: !!fileWritable,
                pendingWrites: fileWriteQueue.length,
            };
        },

        isFileApiSupported: function () { return !!window.showSaveFilePicker; },
    };

    loadFromStorage();

    window.addEventListener('beforeunload', () => {
        if (fileWritable) {
            try {
                const chunk = fileWriteQueue.join('') + buildFileFooter();
                fileWriteQueue = [];
                fileWritable.write(chunk);
                fileWritable.close();
            } catch (e) { }
        }
    });

    window.SGLog = SGLog;
    console.log('%c[SGLog v2] Data Logger ready', 'color:#00ff88;font-weight:bold');
    console.log('%cCommands: SGLog.start() / SGLog.stop() / SGLog.printSummary() / SGLog.download() / SGLog.clear()', 'color:#aaa');

})();