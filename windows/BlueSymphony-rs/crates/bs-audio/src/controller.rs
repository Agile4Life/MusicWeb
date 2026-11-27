use std::time::{Duration, Instant};

use tokio::sync::mpsc;

use bs_core::library::LibraryApi;
use bs_core::models::Track;
use bs_core::queue::{AdvanceOutcome, PlaybackQueue, PreviousOutcome, RepeatMode};
use bs_core::resolver::StreamResolver;
use bs_core::session::SessionStore;

use crate::backend::{AudioCommand, AudioEvent, AudioHandle, RemoteCmd};

/// Mirrors `Player.swift` & web `recoveryPolicy`: stop auto-skipping after 4 failures in a row.
pub const MAX_CONSECUTIVE_SKIPS: u32 = 4;

#[derive(Debug, Clone)]
pub enum PlayerAction {
    PlayTracks { tracks: Vec<Track>, start_at: usize },
    Jump(usize),
    TogglePlay,
    Next,
    Previous,
    Seek(f64),
    SetVolume(f64),
    ToggleMute,
    ToggleShuffle,
    CycleRepeat,
    PlayNext(Track),
    Enqueue(Track),
    RemoveFromQueue(usize),
    MoveInQueue { from: usize, to: usize },
    ClearError,
    Shutdown,
}

#[derive(Debug, Clone)]
pub struct PlayerSnapshot {
    pub queue: Vec<Track>,
    pub index: usize,
    pub is_playing: bool,
    pub is_loading: bool,
    pub is_fetching_more: bool,
    pub current_time: f64,
    pub duration: f64,
    pub volume: f64,
    pub muted: bool,
    pub shuffle: bool,
    pub repeat: RepeatMode,
    pub error_message: Option<String>,
}

impl Default for PlayerSnapshot {
    fn default() -> Self {
        Self {
            queue: Vec::new(),
            index: 0,
            is_playing: false,
            is_loading: false,
            is_fetching_more: false,
            current_time: 0.0,
            duration: 0.0,
            volume: 0.85,
            muted: false,
            shuffle: false,
            repeat: RepeatMode::Off,
            error_message: None,
        }
    }
}

impl PlayerSnapshot {
    pub fn current(&self) -> Option<&Track> {
        self.queue.get(self.index)
    }
}

#[derive(Debug)]
enum AttemptResult {
    Ready { duration: f64 },
    Failed,
    Cancelled,
}

#[derive(Debug)]
enum InternalMsg {
    LoadFinished {
        generation: u64,
        success: bool,
        duration: f64,
    },
    AutoSkipTimeout {
        failed_index: usize,
        generation: u64,
    },
    AutoplayFinished {
        tracks: Vec<Track>,
        expected_index: usize,
        expected_len: usize,
    },
}

pub struct PlaybackCoordinator;

impl PlaybackCoordinator {
    pub fn spawn(
        session: SessionStore,
        resolver: StreamResolver,
        audio: AudioHandle,
        mut audio_rx: mpsc::UnboundedReceiver<AudioEvent>,
        initial_volume: f64,
        initial_muted: bool,
    ) -> (
        mpsc::UnboundedSender<PlayerAction>,
        mpsc::UnboundedReceiver<PlayerSnapshot>,
    ) {
        let (action_tx, mut action_rx) = mpsc::unbounded_channel::<PlayerAction>();
        let (snap_tx, snap_rx) = mpsc::unbounded_channel::<PlayerSnapshot>();

        tokio::spawn(async move {
            let (internal_tx, mut internal_rx) = mpsc::unbounded_channel::<InternalMsg>();

            let mut queue = PlaybackQueue::default();
            let mut generation: u64 = 0;
            let mut is_playing = false;
            let mut is_loading = false;
            let mut is_fetching_more = false;
            let mut current_time = 0.0_f64;
            let mut duration = 0.0_f64;
            let mut volume = initial_volume.clamp(0.0, 1.0);
            let mut muted = initial_muted;
            let mut consecutive_failures: u32 = 0;
            let mut started = false;
            let mut error_message: Option<String> = None;
            let mut last_recorded: Option<(String, Instant)> = None;
            let mut load_task: Option<tokio::task::JoinHandle<()>> = None;
            let mut active_open_waiter: Option<(u64, mpsc::UnboundedSender<Result<f64, ()>>)> = None;

            audio.send(AudioCommand::SetVolume(volume));
            audio.send(AudioCommand::SetMuted(muted));

            macro_rules! emit {
                () => {{
                    let _ = snap_tx.send(PlayerSnapshot {
                        queue: queue.queue.clone(),
                        index: queue.index,
                        is_playing,
                        is_loading,
                        is_fetching_more,
                        current_time,
                        duration,
                        volume,
                        muted,
                        shuffle: queue.shuffle,
                        repeat: queue.repeat,
                        error_message: error_message.clone(),
                    });
                }};
            }

            loop {
                tokio::select! {
                    action = action_rx.recv() => {
                        let Some(act) = action else { break; };
                        match act {
                            PlayerAction::Shutdown => {
                                if let Some(h) = load_task.take() { h.abort(); }
                                audio.send(AudioCommand::Shutdown);
                                break;
                            }
                            PlayerAction::PlayTracks { tracks, start_at } => {
                                if started {
                                    if let Some(t) = queue.current().cloned() {
                                        let s = session.clone();
                                        let skip_sec = current_time.round() as u32;
                                        tokio::spawn(async move {
                                            LibraryApi::report_listen_event(&s, &t, false, Some(skip_sec)).await;
                                        });
                                    }
                                    started = false;
                                }
                                queue.play(tracks, start_at);
                                consecutive_failures = 0;
                                begin_load(
                                    &mut generation, &queue, &mut is_loading, &mut is_playing,
                                    &mut is_fetching_more, &mut started, &mut current_time,
                                    &mut duration, &mut error_message, &mut load_task,
                                    &mut active_open_waiter, &audio, &resolver, &internal_tx,
                                );
                                emit!();
                            }
                            PlayerAction::Jump(i) => {
                                if queue.jump(i) {
                                    if started {
                                        if let Some(t) = queue.current().cloned() {
                                            let s = session.clone();
                                            let skip_sec = current_time.round() as u32;
                                            tokio::spawn(async move {
                                                LibraryApi::report_listen_event(&s, &t, false, Some(skip_sec)).await;
                                            });
                                        }
                                        started = false;
                                    }
                                    consecutive_failures = 0;
                                    begin_load(
                                        &mut generation, &queue, &mut is_loading, &mut is_playing,
                                        &mut is_fetching_more, &mut started, &mut current_time,
                                        &mut duration, &mut error_message, &mut load_task,
                                        &mut active_open_waiter, &audio, &resolver, &internal_tx,
                                    );
                                    emit!();
                                }
                            }
                            PlayerAction::TogglePlay => {
                                if queue.current().is_some() && !is_loading {
                                    if is_playing {
                                        audio.send(AudioCommand::Pause);
                                        is_playing = false;
                                    } else {
                                        audio.send(AudioCommand::Play);
                                        is_playing = true;
                                    }
                                    emit!();
                                }
                            }
                            PlayerAction::Next => {
                                handle_advance(
                                    false, &session, &resolver, &audio, &internal_tx,
                                    &mut queue, &mut generation, &mut is_loading, &mut is_playing,
                                    &mut is_fetching_more, &mut started, &mut current_time,
                                    &mut duration, &mut error_message, &mut load_task,
                                    &mut active_open_waiter,
                                );
                                emit!();
                            }
                            PlayerAction::Previous => {
                                match queue.previous_step(current_time) {
                                    PreviousOutcome::SeekZero => {
                                        current_time = 0.0;
                                        audio.send(AudioCommand::Seek(0.0));
                                    }
                                    PreviousOutcome::LoadCurrent => {
                                        if started {
                                            if let Some(t) = queue.current().cloned() {
                                                let s = session.clone();
                                                let skip_sec = current_time.round() as u32;
                                                tokio::spawn(async move {
                                                    LibraryApi::report_listen_event(&s, &t, false, Some(skip_sec)).await;
                                                });
                                            }
                                            started = false;
                                        }
                                        begin_load(
                                            &mut generation, &queue, &mut is_loading, &mut is_playing,
                                            &mut is_fetching_more, &mut started, &mut current_time,
                                            &mut duration, &mut error_message, &mut load_task,
                                            &mut active_open_waiter, &audio, &resolver, &internal_tx,
                                        );
                                    }
                                }
                                emit!();
                            }
                            PlayerAction::Seek(secs) => {
                                let clamped = if duration > 0.0 { secs.clamp(0.0, duration) } else { secs.max(0.0) };
                                current_time = clamped;
                                audio.send(AudioCommand::Seek(clamped));
                                emit!();
                            }
                            PlayerAction::SetVolume(v) => {
                                volume = v.clamp(0.0, 1.0);
                                if volume > 0.0 && muted {
                                    muted = false;
                                    audio.send(AudioCommand::SetMuted(false));
                                }
                                audio.send(AudioCommand::SetVolume(volume));
                                emit!();
                            }
                            PlayerAction::ToggleMute => {
                                muted = !muted;
                                audio.send(AudioCommand::SetMuted(muted));
                                emit!();
                            }
                            PlayerAction::ToggleShuffle => {
                                queue.toggle_shuffle();
                                emit!();
                            }
                            PlayerAction::CycleRepeat => {
                                queue.cycle_repeat();
                                emit!();
                            }
                            PlayerAction::PlayNext(track) => {
                                if queue.play_next(track) {
                                    consecutive_failures = 0;
                                    begin_load(
                                        &mut generation, &queue, &mut is_loading, &mut is_playing,
                                        &mut is_fetching_more, &mut started, &mut current_time,
                                        &mut duration, &mut error_message, &mut load_task,
                                        &mut active_open_waiter, &audio, &resolver, &internal_tx,
                                    );
                                }
                                emit!();
                            }
                            PlayerAction::Enqueue(track) => {
                                if queue.enqueue(track) {
                                    consecutive_failures = 0;
                                    begin_load(
                                        &mut generation, &queue, &mut is_loading, &mut is_playing,
                                        &mut is_fetching_more, &mut started, &mut current_time,
                                        &mut duration, &mut error_message, &mut load_task,
                                        &mut active_open_waiter, &audio, &resolver, &internal_tx,
                                    );
                                }
                                emit!();
                            }
                            PlayerAction::RemoveFromQueue(i) => {
                                if queue.remove(i) {
                                    emit!();
                                }
                            }
                            PlayerAction::MoveInQueue { from, to } => {
                                if queue.move_item(from, to) {
                                    emit!();
                                }
                            }
                            PlayerAction::ClearError => {
                                error_message = None;
                                emit!();
                            }
                        }
                    }

                    evt = audio_rx.recv() => {
                        let Some(evt) = evt else { break; };
                        match evt {
                            AudioEvent::Opened { generation: g, duration: d } => {
                                if let Some((wg, ref wtx)) = active_open_waiter {
                                    if wg == g {
                                        let _ = wtx.send(Ok(d));
                                    }
                                }
                                if g == generation && d > 0.0 {
                                    duration = d;
                                    emit!();
                                }
                            }
                            AudioEvent::Failed { generation: g, .. } => {
                                if let Some((wg, ref wtx)) = active_open_waiter {
                                    if wg == g {
                                        let _ = wtx.send(Err(()));
                                        continue;
                                    }
                                }
                                if g == generation && !is_loading && started {
                                    // Stream dropped mid-playback -> run failure recovery
                                    started = false;
                                    handle_failure(
                                        &queue, generation, &mut is_loading, &mut is_playing,
                                        &mut consecutive_failures, &mut error_message,
                                        &audio, &internal_tx,
                                    );
                                    emit!();
                                }
                            }
                            AudioEvent::Position { generation: g, current, duration: d } => {
                                if g == generation && !is_loading {
                                    current_time = current;
                                    if d > 0.0 {
                                        duration = d;
                                    }
                                    emit!();
                                }
                            }
                            AudioEvent::StateChanged { generation: g, playing, buffering } => {
                                if g == generation && !is_loading && !buffering {
                                    is_playing = playing;
                                    emit!();
                                }
                            }
                            AudioEvent::Ended { generation: g } => {
                                if g == generation && !is_loading {
                                    handle_advance(
                                        true, &session, &resolver, &audio, &internal_tx,
                                        &mut queue, &mut generation, &mut is_loading, &mut is_playing,
                                        &mut is_fetching_more, &mut started, &mut current_time,
                                        &mut duration, &mut error_message, &mut load_task,
                                        &mut active_open_waiter,
                                    );
                                    emit!();
                                }
                            }
                            AudioEvent::Remote(cmd) => {
                                match cmd {
                                    RemoteCmd::Play => {
                                        if !is_playing && queue.current().is_some() && !is_loading {
                                            audio.send(AudioCommand::Play);
                                            is_playing = true;
                                            emit!();
                                        }
                                    }
                                    RemoteCmd::Pause => {
                                        if is_playing {
                                            audio.send(AudioCommand::Pause);
                                            is_playing = false;
                                            emit!();
                                        }
                                    }
                                    RemoteCmd::TogglePlayPause => {
                                        if queue.current().is_some() && !is_loading {
                                            is_playing = !is_playing;
                                            audio.send(if is_playing { AudioCommand::Play } else { AudioCommand::Pause });
                                            emit!();
                                        }
                                    }
                                    RemoteCmd::Next => {
                                        handle_advance(
                                            false, &session, &resolver, &audio, &internal_tx,
                                            &mut queue, &mut generation, &mut is_loading, &mut is_playing,
                                            &mut is_fetching_more, &mut started, &mut current_time,
                                            &mut duration, &mut error_message, &mut load_task,
                                            &mut active_open_waiter,
                                        );
                                        emit!();
                                    }
                                    RemoteCmd::Previous => {
                                        if matches!(queue.previous_step(current_time), PreviousOutcome::SeekZero) {
                                            current_time = 0.0;
                                            audio.send(AudioCommand::Seek(0.0));
                                        } else {
                                            begin_load(
                                                &mut generation, &queue, &mut is_loading, &mut is_playing,
                                                &mut is_fetching_more, &mut started, &mut current_time,
                                                &mut duration, &mut error_message, &mut load_task,
                                                &mut active_open_waiter, &audio, &resolver, &internal_tx,
                                            );
                                        }
                                        emit!();
                                    }
                                    RemoteCmd::Seek(secs) => {
                                        let s = secs.max(0) as f64;
                                        current_time = s;
                                        audio.send(AudioCommand::Seek(s));
                                        emit!();
                                    }
                                }
                            }
                        }
                    }

                    msg = internal_rx.recv() => {
                        let Some(msg) = msg else { break; };
                        match msg {
                            InternalMsg::LoadFinished { generation: g, success, duration: d } => {
                                if g != generation {
                                    continue;
                                }
                                active_open_waiter = None;
                                if success {
                                    consecutive_failures = 0;
                                    started = true;
                                    is_loading = false;
                                    is_playing = true;
                                    if d > 0.0 {
                                        duration = d;
                                    }
                                    if let Some(track) = queue.current().cloned() {
                                        let should_record = match &last_recorded {
                                            Some((id, at)) => id != &track.id || at.elapsed() >= Duration::from_secs(3),
                                            None => true,
                                        };
                                        if should_record {
                                            last_recorded = Some((track.id.clone(), Instant::now()));
                                            let s = session.clone();
                                            tokio::spawn(async move {
                                                tokio::time::sleep(Duration::from_millis(100)).await;
                                                LibraryApi::record_history(&s, &track).await;
                                            });
                                        }
                                    }
                                    if let Some(next_track) = queue.upcoming_next().cloned() {
                                        resolver.prewarm(next_track);
                                    }
                                } else {
                                    handle_failure(
                                        &queue, generation, &mut is_loading, &mut is_playing,
                                        &mut consecutive_failures, &mut error_message,
                                        &audio, &internal_tx,
                                    );
                                }
                                emit!();
                            }
                            InternalMsg::AutoSkipTimeout { failed_index, generation: g } => {
                                if g == generation && queue.index == failed_index {
                                    handle_advance(
                                        false, &session, &resolver, &audio, &internal_tx,
                                        &mut queue, &mut generation, &mut is_loading, &mut is_playing,
                                        &mut is_fetching_more, &mut started, &mut current_time,
                                        &mut duration, &mut error_message, &mut load_task,
                                        &mut active_open_waiter,
                                    );
                                    emit!();
                                }
                            }
                            InternalMsg::AutoplayFinished { tracks, expected_index, expected_len } => {
                                is_fetching_more = false;
                                if queue.index == expected_index && queue.queue.len() == expected_len {
                                    let added = queue.append_autoplay(tracks);
                                    if added > 0 {
                                        queue.index += 1;
                                        begin_load(
                                            &mut generation, &queue, &mut is_loading, &mut is_playing,
                                            &mut is_fetching_more, &mut started, &mut current_time,
                                            &mut duration, &mut error_message, &mut load_task,
                                            &mut active_open_waiter, &audio, &resolver, &internal_tx,
                                        );
                                    } else {
                                        audio.send(AudioCommand::Pause);
                                        is_playing = false;
                                    }
                                }
                                emit!();
                            }
                        }
                    }
                }
            }
        });

        (action_tx, snap_rx)
    }
}

#[allow(clippy::too_many_arguments)]
fn begin_load(
    generation: &mut u64,
    queue: &PlaybackQueue,
    is_loading: &mut bool,
    is_playing: &mut bool,
    is_fetching_more: &mut bool,
    started: &mut bool,
    current_time: &mut f64,
    duration: &mut f64,
    error_message: &mut Option<String>,
    load_task: &mut Option<tokio::task::JoinHandle<()>>,
    active_open_waiter: &mut Option<(u64, mpsc::UnboundedSender<Result<f64, ()>>)>,
    audio: &AudioHandle,
    resolver: &StreamResolver,
    internal_tx: &mpsc::UnboundedSender<InternalMsg>,
) {
    if let Some(h) = load_task.take() {
        h.abort();
    }
    *is_fetching_more = false;
    *started = false;
    audio.send(AudioCommand::Stop);

    let Some(track) = queue.current().cloned() else {
        *is_loading = false;
        *is_playing = false;
        *active_open_waiter = None;
        return;
    };

    *generation += 1;
    let gen = *generation;
    *is_loading = true;
    *is_playing = false;
    *current_time = 0.0;
    *duration = track.duration.unwrap_or(0.0);
    *error_message = None;

    let (waiter_tx, mut waiter_rx) = mpsc::unbounded_channel::<Result<f64, ()>>();
    *active_open_waiter = Some((gen, waiter_tx));

    let resolver = resolver.clone();
    let audio = audio.clone();
    let internal_tx = internal_tx.clone();

    *load_task = Some(tokio::spawn(async move {
        let mut success_duration = None;

        'outer: for invalidate in [false, true] {
            let Some(url) = resolver.resolve_url(&track, invalidate).await else {
                continue;
            };

            for attempt in 0..2 {
                // Drain stale waiter signals
                while waiter_rx.try_recv().is_ok() {}

                audio.send(AudioCommand::Load {
                    generation: gen,
                    url: url.clone(),
                    title: track.title.clone(),
                    artist: track.artist_name().to_string(),
                    album: track.album.clone().unwrap_or_default(),
                    cover_url: track.cover_url.clone(),
                });

                let res = wait_for_open(&mut waiter_rx).await;
                match res {
                    AttemptResult::Ready { duration } => {
                        success_duration = Some(duration);
                        break 'outer;
                    }
                    AttemptResult::Cancelled => return,
                    AttemptResult::Failed => {
                        if attempt == 0 {
                            tokio::time::sleep(Duration::from_secs(1)).await;
                        }
                    }
                }
            }
        }

        let _ = internal_tx.send(InternalMsg::LoadFinished {
            generation: gen,
            success: success_duration.is_some(),
            duration: success_duration.unwrap_or(0.0),
        });
    }));
}

async fn wait_for_open(rx: &mut mpsc::UnboundedReceiver<Result<f64, ()>>) -> AttemptResult {
    match tokio::time::timeout(Duration::from_secs(15), rx.recv()).await {
        Ok(Some(Ok(dur))) => AttemptResult::Ready { duration: dur },
        Ok(Some(Err(()))) | Err(_) => AttemptResult::Failed,
        Ok(None) => AttemptResult::Cancelled,
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_failure(
    queue: &PlaybackQueue,
    generation: u64,
    is_loading: &mut bool,
    is_playing: &mut bool,
    consecutive_failures: &mut u32,
    error_message: &mut Option<String>,
    audio: &AudioHandle,
    internal_tx: &mpsc::UnboundedSender<InternalMsg>,
) {
    let Some(track) = queue.current() else {
        return;
    };
    audio.send(AudioCommand::Pause);
    *is_loading = false;
    *is_playing = false;
    *consecutive_failures += 1;
    *error_message = Some(format!("Không phát được “{}”", track.title));

    if *consecutive_failures < MAX_CONSECUTIVE_SKIPS && queue.index + 1 < queue.queue.len() {
        let failed_index = queue.index;
        let tx = internal_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(1200)).await;
            let _ = tx.send(InternalMsg::AutoSkipTimeout {
                failed_index,
                generation,
            });
        });
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_advance(
    natural: bool,
    session: &SessionStore,
    resolver: &StreamResolver,
    audio: &AudioHandle,
    internal_tx: &mpsc::UnboundedSender<InternalMsg>,
    queue: &mut PlaybackQueue,
    generation: &mut u64,
    is_loading: &mut bool,
    is_playing: &mut bool,
    is_fetching_more: &mut bool,
    started: &mut bool,
    current_time: &mut f64,
    duration: &mut f64,
    error_message: &mut Option<String>,
    load_task: &mut Option<tokio::task::JoinHandle<()>>,
    active_open_waiter: &mut Option<(u64, mpsc::UnboundedSender<Result<f64, ()>>)>,
) {
    if *started {
        if let Some(t) = queue.current().cloned() {
            let s = session.clone();
            let skip_sec = if natural {
                None
            } else {
                Some(current_time.round() as u32)
            };
            tokio::spawn(async move {
                LibraryApi::report_listen_event(&s, &t, natural, skip_sec).await;
            });
        }
        *started = false;
    }

    match queue.advance_step(natural) {
        AdvanceOutcome::ReplayCurrent => {
            *current_time = 0.0;
            *started = true;
            *is_playing = true;
            audio.send(AudioCommand::Seek(0.0));
            audio.send(AudioCommand::Play);
        }
        AdvanceOutcome::LoadCurrent => {
            begin_load(
                generation, queue, is_loading, is_playing, is_fetching_more, started,
                current_time, duration, error_message, load_task, active_open_waiter,
                audio, resolver, internal_tx,
            );
        }
        AdvanceOutcome::NeedAutoplay => {
            let Some(seed) = queue.current().cloned() else {
                audio.send(AudioCommand::Pause);
                *is_playing = false;
                return;
            };
            if *is_fetching_more {
                return;
            }
            *is_fetching_more = true;
            let api = session.api().clone();
            let q_snapshot = queue.queue.clone();
            let expected_index = queue.index;
            let expected_len = queue.queue.len();
            let tx = internal_tx.clone();
            tokio::spawn(async move {
                let more = api.recommend(&seed, &q_snapshot).await.unwrap_or_default();
                let _ = tx.send(InternalMsg::AutoplayFinished {
                    tracks: more,
                    expected_index,
                    expected_len,
                });
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_skips_constant_matches_policy() {
        assert_eq!(MAX_CONSECUTIVE_SKIPS, 4);
    }
}
