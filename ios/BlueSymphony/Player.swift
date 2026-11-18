import AVFoundation
import MediaPlayer
import Observation
import UIKit

/// Mirrors the web player's recoveryPolicy: stop auto-skipping after this many failures in a row.
private let maxConsecutiveSkips = 4

@MainActor
@Observable
final class Player {
    private(set) var queue: [Track] = []
    private(set) var index = 0
    private(set) var isPlaying = false
    private(set) var isLoading = false
    private(set) var currentTime: Double = 0
    private(set) var duration: Double = 0
    var errorMessage: String?

    var current: Track? { queue.indices.contains(index) ? queue[index] : nil }

    @ObservationIgnored private let avPlayer = AVPlayer()
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var artwork: MPMediaItemArtwork?
    @ObservationIgnored private var consecutiveFailures = 0

    init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        timeObserver = avPlayer.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] t in
            MainActor.assumeIsolated { self?.tick(t.seconds) }
        }
        let nc = NotificationCenter.default
        nc.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            MainActor.assumeIsolated {
                guard let self, (note.object as? AVPlayerItem) === self.avPlayer.currentItem else { return }
                self.next()
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
        queue = tracks
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

    func next() {
        guard index + 1 < queue.count else { stop(); return }
        index += 1
        load()
    }

    func previous() {
        if currentTime > 3 || index == 0 { seek(to: 0); return }
        index -= 1
        load()
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
