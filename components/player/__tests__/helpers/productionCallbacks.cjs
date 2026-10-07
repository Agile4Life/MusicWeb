// CommonJS fixture loaded by createRequire so production callbacks run in a VM.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs'), ts = require('typescript'), vm = require('vm');
const src = fs.readFileSync('components/player/PlayerContext.tsx', 'utf8');
const ast = ts.createSourceFile('PlayerContext.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, env) {
    let found;
    function walk(n) { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name && n.initializer) {
        const i = n.initializer;
        if (ts.isCallExpression(i) && i.expression.getText(ast) === 'useCallback')
            found = i.arguments[0].getText(ast);
        else if (ts.isArrowFunction(i))
            found = i.getText(ast);
    } ts.forEachChild(n, walk); }
    walk(ast);
    if (!found)
        throw Error(name);
    return vm.runInContext(ts.transpileModule('(()=>{const f=' + found + ';return f})()', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, env);
}
const ref = current => ({ current });
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
const track = id => ({ id, title: id, artist: 'Artist', duration: 180, source: 'local', file_path: id + '.mp3' });
function setup() {
    const audio = { src: '', paused: true, ended: false, error: null, readyState: 4, currentTime: 0, playCalls: 0, pauseCalls: 0,
        pause() { this.paused = true; this.pauseCalls++; }, removeAttribute() { this.src = ''; }, load() { }, addEventListener() { }, removeEventListener() { },
        play() { this.playCalls++; this.paused = false; return Promise.resolve(); } };
    const e = vm.createContext({ console: { log() { }, warn() { } }, performance, Date, window: { location: { href: 'https://app.test', origin: 'https://app.test' } }, setTimeout, clearTimeout,
        MAX_CONSECUTIVE_SKIPS: 4, DEFAULT_VOLUME: 0.8, TRACK_RESOLUTION_TTL: 1800000, TRACK_RESOLUTION_MAX_ENTRIES: 200,
        isPlaying: false, isBuffering: false, savedQueue: [], audioRef: ref(audio), audioContextRef: ref(null), ytPlayerRef: ref(null), ytHtml5ModeRef: ref(false), ytReadyRef: ref(false), ytLoadedIdRef: ref(null), pendingYtPlayRef: ref(null),
        playRequestRef: ref(0), audioRequestRef: ref(0), audioGenerationRef: ref(0), audioOwnershipRef: ref({ generation: 0, requestId: 0, trackId: null }), resolutionIdentityRef: ref(null),
        consecutiveSkipRef: ref(0), nextTrackEndPrewarmedRef: ref(false), hasPrewarmedNextTrackRef: ref(false), desiredPlayStateRef: ref(null),
        currentTrackRef: ref(null), currentTimeRef: ref(0), currentIndexRef: ref(-1), queueRef: ref([]), volumeRef: ref(0.8), durationRef: ref(0), pendingSeekRef: ref(null), pendingResumeRef: ref(false), toggleActionIdRef: ref(0),
        playedHistoryStackRef: ref([]), forwardHistoryStackRef: ref([]), isPrevNextActionRef: ref(false), isBackwardActionRef: ref(false),
        trackResolutionCacheRef: ref(new Map()), audioUrlCacheRef: ref(new Map()), fallbackAttemptedRef: ref(new Set()), fallbackInProgressRef: ref(new Set()), audioRetryCountRef: ref(0),
        audioStallWatchdogRef: ref(null), nearEndWatchdogRef: ref(null), trackCompletionHandledRef: ref(null), repeatModeRef: ref('off'), autoPlayNextRef: ref(false), isShuffleRef: ref(false),
        clearPlaybackTimers() { }, stopActivePlaybackEngines() { audio.pause(); audio.src = ''; }, recordListenEvent() { }, recordHistory() { }, triggerSmartQueueFill() { },
        inferTrackSource: t => t, isIOSDevice: () => false, classifyTrack: () => ({ needsCatalogResolution: false }), deduplicateQueueTracks: q => q,
        getBoundedRefreshed: (m, k, expired) => { const v = m.get(k); if (v && expired(v)) {
            m.delete(k);
            return;
        } return v; },
        isCurrentYouTubeVideo: () => false, isYtIframeEngine: () => false, ensureWebAudioGain() { }, savePlayerStateToStorage() { }, clearNearEndWatchdog() { },
        setAudioSourceForPlayback(a, url, vol, time) { a.src = url; a.currentTime = time; }, playAudioElement: a => a.play(), clearCachedNctStreamUrl() { }, invalidateCurrentResolution: async () => { },
        fallbackToYouTube: async () => { }, isPreviewUrl: () => false, resolveStreamCached: async () => null, extractYouTubeVideoId: () => null, recordRequestIdFlag: (s, id) => s.add(id), nextTrackRef: ref(() => { }), playTrackRef: ref(async () => { }) });
    e.setIsPlaying = v => { e.isPlaying = v; e.isPlayingRef.current = v; };
    e.setIsBuffering = v => e.isBuffering = v;
    e.setCurrentTrack = t => e.stateTrack = t;
    e.setCurrentIndex = v => e.stateIndex = v;
    e.setCurrentTime = v => e.currentTimeRef.current = v;
    e.setDuration = v => e.durationRef.current = v;
    e.setPlaybackError = v => e.playbackError = v;
    e.setQueue = v => e.savedQueue = typeof v === 'function' ? v(e.savedQueue) : v;
    e.isCurrentPlayback = ({ requestId, currentRequestId, trackId, currentTrackId }) => requestId === currentRequestId && trackId === currentTrackId;
    e.extractDriveFileId = () => null;
    e.isPlayingRef = ref(false);
    e.fallbackSearchRef = ref({ abort() { } });
    e.recordSkipOfCurrent = () => { };
    e.isFastConnection = () => false;
    e.planUpcomingPrewarm = () => [];
    e.prewarmTrackBatch = async () => { };
    e.readFreshAudioUrl = (m, t) => { const v = m.get(t.id); return v && Date.now() - v.ts < 300000 ? v.url : null; };
    e.resolveStartAction = ({ requestId, currentRequestId, desiredState }) => requestId !== currentRequestId ? 'drop' : desiredState === 'paused' ? 'load-paused' : 'play';
    e.mergeResolvedIntoQueue = (q, t) => q.map(x => x.id === t.id ? { ...x, ...t } : x);
    e.commitQueue = callback('commitQueue', e);
    e.beginNewPlaybackRequest = callback('beginNewPlaybackRequest', e);
    e.commitNavigation = callback('commitNavigation', e);
    e.isCurrentAudioOwnership = callback('isCurrentAudioOwnership', e);
    try {
        e.playOwnedAudio = callback('playOwnedAudio', e);
    }
    catch { }
    e.playTrack = callback('playTrack', e);
    e.togglePlay = callback('togglePlay', e);
    e.seek = callback('seek', e);
    return e;
}
function mediaHandler(action, env) {
    let found;
    function walk(n) { if (ts.isCallExpression(n) && n.expression.getText(ast) === 'navigator.mediaSession.setActionHandler' && n.arguments[0]?.text === action)
        found = n.arguments[1].getText(ast); ts.forEachChild(n, walk); }
    walk(ast);
    if (!found)
        throw Error(action);
    return vm.runInContext(ts.transpileModule('(' + found + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, env);
}
function iframeHandler(name, env) {
    let found;
    function walk(n) { if (ts.isPropertyAssignment(n) && n.name.getText(ast) === name)
        found = n.initializer.getText(ast); ts.forEachChild(n, walk); }
    walk(ast);
    if (!found)
        throw Error(name);
    return vm.runInContext(ts.transpileModule('(' + found + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, env);
}
module.exports = { setup, callback, track, deferred, ref, mediaHandler, iframeHandler };
