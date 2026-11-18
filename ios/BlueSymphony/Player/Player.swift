import AVFoundation
import MediaPlayer
import Observation
import UIKit

/// Mirrors the web player's recoveryPolicy: stop auto-skipping after this many failures in a row.
private let maxConsecutiveSkips = 4

enum RepeatMode { case off, all, one }

@MainActor
@Observable
final class Player {
    private(set) var queue: [Track] = []
    private(set) var index = 0
    private(set) var isPlaying = false
    private(set) var isLoading = false
    private(set) var currentTime: Double = 0
    private(set) var duration: Double = 0
    private(set) var shuffleOn = false
    private(set) var repeatMode = RepeatMode.off
    /// True while "Tiếp theo" is being filled with recommendations after the queue ran out.
    private(set) var isFetchingMore = false
    var errorMessage: String?
    /// Set by the app; history and listen events are only sent when signed in.
    @ObservationIgnored weak var session: SessionStore?

    var current: Track? { queue.indices.contains(index) ? queue[index] : nil }

    @ObservationIgnored private let avPlayer = AVPlayer()
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var artwork: MPMediaItemArtwork?
    @ObservationIgnored private var consecutiveFailures = 0
    @ObservationIgnored private var originalOrder: [Track] = []
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastRecorded: (id: String, at: Date)?
    @ObservationIgnored private var autoplayTask: Task<Void, Never>?

    init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        timeObserver = avPlayer.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] t in
            MainActor.assumeIsolated { self?.tick(t.seconds) }
        }
        let nc = NotificationCenter.default
        nc.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            MainActor.assumeIsolated {
                guard let self, (note.object as? AVPlayerItem) === self.avPlayer.currentItem else { return }
                self.advance(natural: true)
            }
        }
        // Stream dropped mid-song (network, expired URL): same recovery path as a failed start.
        nc.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            MainActor.assumeIsolated {
                guard let self, (note.object as? AVPlayerItem) === self.avPlayer.currentItem else { return }
                self.fail()
            }
        }
        setupRemoteCommands()
    }

    func play(_ tracks: [Track], startAt i: Int) {
        reportListen(completed: false)
        queue = tracks
        originalOrder = tracks
        index = i
        consecutiveFailures = 0
        if shuffleOn { shuffleUpcoming() }
        load()
    }

    /// Plays the track at `i` of the current queue (tap in "Tiếp theo").
    func jump(to i: Int) {
        guard queue.indices.contains(i) else { return }
        reportListen(completed: false)
        index = i
        consecutiveFailures = 0
        load()
    }

    func togglePlay() {
        guard current != nil, !isLoading else { return }
        if isPlaying { avPlayer.pause() } else { avPlayer.play() }
        isPlaying.toggle()
        updateNowPlaying()
    }

    func next() { advance(natural: false) }

    func previous() {
        if currentTime > 3 || index == 0 { seek(to: 0); return }
        reportListen(completed: false)
        index -= 1
        load()
    }

    /// Moves on after a track ends (`natural`) or the user skips. Repeat-one only loops on a natural end.
    private func advance(natural: Bool) {
        reportListen(completed: natural)
        if natural && repeatMode == .one {
            seek(to: 0)
            avPlayer.play()
            isPlaying = true
            started = true
            updateNowPlaying()
            return
        }
        if index + 1 < queue.count {
            index += 1
            load()
        } else if repeatMode == .all, !queue.isEmpty {
            index = 0
            load()
        } else {
            autoplay()
        }
    }

    // MARK: - Queue editing

    func playNext(_ track: Track) {
        guard current != nil else { play([track], startAt: 0); return }
        queue.insert(track, at: index + 1)
        let at = current.flatMap { c in originalOrder.firstIndex { $0.id == c.id } }.map { $0 + 1 } ?? originalOrder.count
        originalOrder.insert(track, at: min(at, originalOrder.count))
    }

    func enqueue(_ track: Track) {
        guard current != nil else { play([track], startAt: 0); return }
        queue.append(track)
        originalOrder.append(track)
    }

    /// The playing row can't be removed.
    func remove(at i: Int) {
        guard queue.indices.contains(i), i != index else { return }
        if let o = originalOrder.firstIndex(where: { $0.id == queue[i].id }) { originalOrder.remove(at: o) }
        queue.remove(at: i)
        if i < index { index -= 1 }
    }

    func move(from source: IndexSet, to destination: Int) {
        var order = Array(queue.indices)
        order.move(fromOffsets: source, toOffset: destination)
        queue = order.map { queue[$0] }
        index = order.firstIndex(of: index) ?? index
        if !shuffleOn { originalOrder = queue }
    }

    func toggleShuffle() {
        shuffleOn.toggle()
        if shuffleOn {
            originalOrder = queue
            shuffleUpcoming()
        } else if let cur = current {
            let ids = Set(queue.map(\.id))
            let known = Set(originalOrder.map(\.id))
            queue = originalOrder.filter { ids.contains($0.id) } + queue.filter { !known.contains($0.id) }
            index = queue.firstIndex { $0.id == cur.id } ?? 0
        }
    }

    func cycleRepeat() {
        repeatMode = switch repeatMode { case .off: .all; case .all: .one; case .one: .off }
    }

    private func shuffleUpcoming() {
        guard current != nil else { return }
        queue = Array(queue[...index]) + queue[(index + 1)...].shuffled()
    }

    /// Queue ran out: ask the server for similar tracks (same call as the web player's `recommend`).
    private func autoplay() {
        guard let seed = current, autoplayTask == nil else { return }
        isFetchingMore = true
        autoplayTask = Task {
            let more = (try? await API.recommend(seed: seed, queue: queue)) ?? []
            autoplayTask = nil
            isFetchingMore = false
            let existing = Set(queue.map(\.id))
            let fresh = more.filter { !existing.contains($0.id) }
            guard !Task.isCancelled, index == queue.count - 1 else { return }
            if fresh.isEmpty { stop(); return }
            queue += fresh
            originalOrder += fresh
            index += 1
            load()
        }
    }

    // MARK: - History + listen events (signed in only, fire and forget)

    private func recordHistory(_ t: Track) {
        guard session?.isSignedIn == true else { return }
        if let l = lastRecorded, l.id == t.id, Date().timeIntervalSince(l.at) < 3 { return }
        lastRecorded = (t.id, .now)
        struct Body: Encodable { let track: Track }
        Task {
            try? await Task.sleep(for: .milliseconds(100))
            _ = try? await API.send("POST", "api/history/record", body: Body(track: t))
        }
    }

    private func reportListen(completed: Bool) {
        guard started, let t = current else { return }
        started = false
        guard session?.isSignedIn == true else { return }
        struct Body: Encodable { let track_id: String; let artist: String?; let completed: Bool; let skip_at_seconds: Int? }
        let body = Body(track_id: t.id, artist: t.artist, completed: completed, skip_at_seconds: completed ? nil : Int(currentTime.rounded()))
        Task { _ = try? await API.send("POST", "api/listen-events", body: body) }
    }

    func seek(to seconds: Double) {
        avPlayer.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
        currentTime = seconds
        updateNowPlaying()
    }

    private func stop() {
        avPlayer.pause()
        isPlaying = false
        updateNowPlaying()
    }

    private func tick(_ t: Double) {
        guard t.isFinite else { return }
        currentTime = t
        if let d = avPlayer.currentItem?.duration.seconds, d.isFinite, d > 0 { duration = d }
    }

    private func load() {
        guard let track = current else { return }
        loadTask?.cancel()
        autoplayTask?.cancel()
        autoplayTask = nil
        isFetchingMore = false
        started = false
        avPlayer.pause()
        avPlayer.replaceCurrentItem(with: nil)
        isLoading = true
        isPlaying = false
        currentTime = 0
        duration = track.duration ?? 0
        artwork = nil
        updateNowPlaying()
        loadArtwork(track)

        loadTask = Task {
            try? AVAudioSession.sharedInstance().setActive(true)
            // Cached resolve first; if that stream won't play, ask the server for a fresh one (invalidate=1),
            // like the web client does on a playback error.
            for invalidate in [false, true] {
                guard let url = try? await API.streamURL(for: track, invalidate: invalidate) else { continue }
                // The stream worker often 502s on a cold cache, then serves fine; retry once.
                for attempt in 0..<2 {
                    guard !Task.isCancelled else { return }
                    let item = AVPlayerItem(url: url)
                    avPlayer.replaceCurrentItem(with: item)
                    avPlayer.play()
                    if await waitUntilReady(item) {
                        guard !Task.isCancelled else { return }
                        consecutiveFailures = 0
                        started = true
                        recordHistory(track)
                        isPlaying = true
                        isLoading = false
                        updateNowPlaying()
                        if queue.indices.contains(index + 1) { API.prewarm(queue[index + 1]) }
                        return
                    }
                    if attempt == 0 { try? await Task.sleep(for: .seconds(1)) }
                }
            }
            guard !Task.isCancelled else { return }
            fail()
        }
    }

    private func fail() {
        guard let track = current else { return }
        avPlayer.pause()
        isLoading = false
        isPlaying = false
        consecutiveFailures += 1
        errorMessage = "Không phát được “\(track.title)”"
        updateNowPlaying()
        guard consecutiveFailures < maxConsecutiveSkips, index + 1 < queue.count else { return }
        let failedIndex = index
        loadTask = Task {
            try? await Task.sleep(for: .milliseconds(1200))
            guard !Task.isCancelled, index == failedIndex else { return }
            next()
        }
    }

    private func waitUntilReady(_ item: AVPlayerItem) async -> Bool {
        for _ in 0..<60 { // ~15s
            switch item.status {
            case .readyToPlay: return true
            case .failed: return false
            default: try? await Task.sleep(for: .milliseconds(250))
            }
        }
        return false
    }

    private func loadArtwork(_ track: Track) {
        guard let url = track.coverURL else { return }
        Task {
            guard let (data, _) = try? await URLSession.shared.data(from: url),
                  let image = UIImage(data: data), current?.id == track.id else { return }
            artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            updateNowPlaying()
        }
    }

    private func updateNowPlaying() {
        guard let t = current else { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: t.title,
            MPMediaItemPropertyArtist: t.artistName,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func setupRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { if self?.isPlaying == false { self?.togglePlay() } }
            return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { if self?.isPlaying == true { self?.togglePlay() } }
            return .success
        }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.togglePlay() }
            return .success
        }
        c.nextTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.next() }
            return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.previous() }
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            MainActor.assumeIsolated { self?.seek(to: e.positionTime) }
            return .success
        }
    }
}
