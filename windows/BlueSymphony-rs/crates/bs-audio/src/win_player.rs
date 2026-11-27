use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use tokio::sync::mpsc;
use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
use windows::Media::Core::MediaSource;
use windows::Media::Playback::{
    IMediaPlaybackSource, MediaPlaybackSession, MediaPlaybackState, MediaPlayer,
    MediaPlayerFailedEventArgs,
};
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
    SystemMediaTransportControls, SystemMediaTransportControlsButton,
    SystemMediaTransportControlsButtonPressedEventArgs,
    SystemMediaTransportControlsTimelineProperties,
};
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
use windows::core::{HSTRING, Interface};

use crate::backend::{AudioCommand, AudioEvent, AudioHandle, RemoteCmd};

const TICKS_PER_SECOND: f64 = 10_000_000.0;

#[derive(Debug, Clone)]
pub(crate) enum WinPlayerCmd {
    Audio(AudioCommand),
    SmtcSetMeta {
        title: String,
        artist: String,
        album: String,
        cover_url: Option<String>,
    },
    SmtcSetState {
        playing: bool,
        position: f64,
        duration: f64,
    },
}

pub fn spawn_win_audio_backend() -> (AudioHandle, mpsc::UnboundedReceiver<AudioEvent>) {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    let (evt_tx, evt_rx) = mpsc::unbounded_channel();
    let (internal_tx, internal_rx) = mpsc::unbounded_channel();

    // Forward raw AudioCommand -> WinPlayerCmd::Audio
    tokio::spawn(async move {
        let mut rx = cmd_rx;
        while let Some(c) = rx.recv().await {
            if internal_tx.send(WinPlayerCmd::Audio(c)).is_err() {
                break;
            }
        }
    });

    spawn_win_player_thread(internal_rx, evt_tx);
    (AudioHandle::new(cmd_tx), evt_rx)
}

pub(crate) fn spawn_win_player_thread(
    cmd_rx: mpsc::UnboundedReceiver<WinPlayerCmd>,
    evt_tx: mpsc::UnboundedSender<AudioEvent>,
) {
    std::thread::Builder::new()
        .name("bs-winrt-audio".to_string())
        .spawn(move || {
            if let Err(err) = run_winrt_loop(cmd_rx, evt_tx.clone()) {
                let _ = evt_tx.send(AudioEvent::Failed {
                    generation: 0,
                    message: format!("Không khởi tạo được trình phát Windows: {err}"),
                });
            }
        })
        .expect("spawn winrt audio thread");
}

fn run_winrt_loop(
    mut cmd_rx: mpsc::UnboundedReceiver<WinPlayerCmd>,
    evt_tx: mpsc::UnboundedSender<AudioEvent>,
) -> windows::core::Result<()> {
    unsafe {
        RoInitialize(RO_INIT_MULTITHREADED)?;
    }

    let player = MediaPlayer::new()?;
    let active_gen = Arc::new(AtomicU64::new(0));
    let smtc_only = Arc::new(AtomicBool::new(false));

    let smtc = player.SystemMediaTransportControls()?;
    smtc.SetIsEnabled(true)?;
    smtc.SetIsPlayEnabled(true)?;
    smtc.SetIsPauseEnabled(true)?;
    smtc.SetIsNextEnabled(true)?;
    smtc.SetIsPreviousEnabled(true)?;
    let _ = smtc.SetPlaybackStatus(MediaPlaybackStatus::Stopped);

    {
        let tx = evt_tx.clone();
        smtc.ButtonPressed(&TypedEventHandler::<
            SystemMediaTransportControls,
            SystemMediaTransportControlsButtonPressedEventArgs,
        >::new(move |_, args| {
            if let Some(args) = args.as_ref() {
                if let Ok(btn) = args.Button() {
                    let cmd = if btn == SystemMediaTransportControlsButton::Play {
                        Some(RemoteCmd::Play)
                    } else if btn == SystemMediaTransportControlsButton::Pause {
                        Some(RemoteCmd::Pause)
                    } else if btn == SystemMediaTransportControlsButton::Next {
                        Some(RemoteCmd::Next)
                    } else if btn == SystemMediaTransportControlsButton::Previous {
                        Some(RemoteCmd::Previous)
                    } else {
                        None
                    };
                    if let Some(c) = cmd {
                        let _ = tx.send(AudioEvent::Remote(c));
                    }
                }
            }
            Ok(())
        }))?;
    }

    {
        let tx = evt_tx.clone();
        smtc.PlaybackPositionChangeRequested(&TypedEventHandler::<
            SystemMediaTransportControls,
            PlaybackPositionChangeRequestedEventArgs,
        >::new(move |_, args| {
            if let Some(args) = args.as_ref() {
                if let Ok(pos) = args.RequestedPlaybackPosition() {
                    let secs = (pos.Duration as f64 / TICKS_PER_SECOND).round() as i64;
                    let _ = tx.send(AudioEvent::Remote(RemoteCmd::Seek(secs.max(0))));
                }
            }
            Ok(())
        }))?;
    }

    {
        let tx = evt_tx.clone();
        let gen_ref = Arc::clone(&active_gen);
        let smtc_flag = Arc::clone(&smtc_only);
        player.MediaOpened(&TypedEventHandler::<MediaPlayer, windows::core::IInspectable>::new(
            move |sender, _| {
                if smtc_flag.load(Ordering::SeqCst) {
                    return Ok(());
                }
                let g = gen_ref.load(Ordering::SeqCst);
                let dur = sender
                    .as_ref()
                    .and_then(|p| p.PlaybackSession().ok())
                    .and_then(|s| s.NaturalDuration().ok())
                    .map(timespan_to_secs)
                    .unwrap_or(0.0);
                let _ = tx.send(AudioEvent::Opened {
                    generation: g,
                    duration: dur,
                });
                Ok(())
            },
        ))?;
    }

    {
        let tx = evt_tx.clone();
        let gen_ref = Arc::clone(&active_gen);
        let smtc_flag = Arc::clone(&smtc_only);
        player.MediaEnded(&TypedEventHandler::<MediaPlayer, windows::core::IInspectable>::new(
            move |_, _| {
                if smtc_flag.load(Ordering::SeqCst) {
                    return Ok(());
                }
                let g = gen_ref.load(Ordering::SeqCst);
                let _ = tx.send(AudioEvent::Ended { generation: g });
                Ok(())
            },
        ))?;
    }

    {
        let tx = evt_tx.clone();
        let gen_ref = Arc::clone(&active_gen);
        let smtc_flag = Arc::clone(&smtc_only);
        player.MediaFailed(&TypedEventHandler::<MediaPlayer, MediaPlayerFailedEventArgs>::new(
            move |_, args| {
                if smtc_flag.load(Ordering::SeqCst) {
                    return Ok(());
                }
                let g = gen_ref.load(Ordering::SeqCst);
                let msg = args
                    .as_ref()
                    .and_then(|a| a.ErrorMessage().ok())
                    .map(|s| s.to_string_lossy())
                    .unwrap_or_else(|| "Media playback failed".to_string());
                let _ = tx.send(AudioEvent::Failed {
                    generation: g,
                    message: msg,
                });
                Ok(())
            },
        ))?;
    }

    if let Ok(session) = player.PlaybackSession() {
        let tx = evt_tx.clone();
        let gen_ref = Arc::clone(&active_gen);
        let smtc_flag = Arc::clone(&smtc_only);
        session.PlaybackStateChanged(&TypedEventHandler::<
            MediaPlaybackSession,
            windows::core::IInspectable,
        >::new(move |sender, _| {
            if smtc_flag.load(Ordering::SeqCst) {
                return Ok(());
            }
            let g = gen_ref.load(Ordering::SeqCst);
            if let Some(s) = sender.as_ref() {
                if let Ok(st) = s.PlaybackState() {
                    let playing = st == MediaPlaybackState::Playing;
                    let buffering =
                        st == MediaPlaybackState::Buffering || st == MediaPlaybackState::Opening;
                    let _ = tx.send(AudioEvent::StateChanged {
                        generation: g,
                        playing,
                        buffering,
                    });
                }
            }
            Ok(())
        }))?;
    }

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("audio command runtime");

    rt.block_on(async move {
        let mut tick = tokio::time::interval(Duration::from_millis(250));
        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    match cmd {
                        None | Some(WinPlayerCmd::Audio(AudioCommand::Shutdown)) => {
                            let _ = player.Pause();
                            let _ = player.Close();
                            break;
                        }
                        Some(WinPlayerCmd::SmtcSetMeta { title, artist, album, cover_url }) => {
                            smtc_only.store(true, Ordering::SeqCst);
                            let _ = player.Pause();
                            let _ = player.SetSource(None::<&IMediaPlaybackSource>);
                            update_smtc_display(&smtc, &title, &artist, &album, cover_url.as_deref());
                            let _ = smtc.SetPlaybackStatus(MediaPlaybackStatus::Playing);
                        }
                        Some(WinPlayerCmd::SmtcSetState { playing, position, duration }) => {
                            smtc_only.store(true, Ordering::SeqCst);
                            let _ = smtc.SetPlaybackStatus(if playing {
                                MediaPlaybackStatus::Playing
                            } else {
                                MediaPlaybackStatus::Paused
                            });
                            update_smtc_timeline(&smtc, position, duration);
                        }
                        Some(WinPlayerCmd::Audio(AudioCommand::Load { generation, url, title, artist, album, cover_url })) => {
                            smtc_only.store(false, Ordering::SeqCst);
                            active_gen.store(generation, Ordering::SeqCst);
                            if let Err(err) = load_source(&player, &smtc, &url, &title, &artist, &album, cover_url.as_deref()) {
                                let _ = evt_tx.send(AudioEvent::Failed {
                                    generation,
                                    message: err.to_string(),
                                });
                            }
                        }
                        Some(WinPlayerCmd::Audio(AudioCommand::Play)) => {
                            if !smtc_only.load(Ordering::SeqCst) {
                                let _ = player.Play();
                            }
                            let _ = smtc.SetPlaybackStatus(MediaPlaybackStatus::Playing);
                        }
                        Some(WinPlayerCmd::Audio(AudioCommand::Pause)) => {
                            if !smtc_only.load(Ordering::SeqCst) {
                                let _ = player.Pause();
                            }
                            let _ = smtc.SetPlaybackStatus(MediaPlaybackStatus::Paused);
                        }
                        Some(WinPlayerCmd::Audio(AudioCommand::Stop)) => {
                            let _ = player.Pause();
                            let _ = player.SetSource(None::<&IMediaPlaybackSource>);
                            let _ = smtc.SetPlaybackStatus(MediaPlaybackStatus::Stopped);
                        }
                        Some(WinPlayerCmd::Audio(AudioCommand::Seek(secs))) => {
                            if !smtc_only.load(Ordering::SeqCst) {
                                if let Ok(session) = player.PlaybackSession() {
                                    let _ = session.SetPosition(secs_to_timespan(secs.max(0.0)));
                                }
                            }
                        }
                        Some(WinPlayerCmd::Audio(AudioCommand::SetVolume(vol))) => {
                            let _ = player.SetVolume(vol.clamp(0.0, 1.0));
                        }
                        Some(WinPlayerCmd::Audio(AudioCommand::SetMuted(muted))) => {
                            let _ = player.SetIsMuted(muted);
                        }
                        Some(WinPlayerCmd::Audio(_)) => {}
                    }
                }
                _ = tick.tick() => {
                    if smtc_only.load(Ordering::SeqCst) {
                        continue;
                    }
                    let g = active_gen.load(Ordering::SeqCst);
                    if g == 0 {
                        continue;
                    }
                    if let Ok(session) = player.PlaybackSession() {
                        let state = session.PlaybackState().unwrap_or(MediaPlaybackState::None);
                        let pos = session.Position().map(timespan_to_secs).unwrap_or(0.0);
                        let dur = session.NaturalDuration().map(timespan_to_secs).unwrap_or(0.0);

                        let smtc_status = if state == MediaPlaybackState::Playing {
                            MediaPlaybackStatus::Playing
                        } else if state == MediaPlaybackState::Paused {
                            MediaPlaybackStatus::Paused
                        } else if state == MediaPlaybackState::Buffering || state == MediaPlaybackState::Opening {
                            MediaPlaybackStatus::Changing
                        } else {
                            MediaPlaybackStatus::Stopped
                        };
                        let _ = smtc.SetPlaybackStatus(smtc_status);
                        update_smtc_timeline(&smtc, pos, dur);

                        if state == MediaPlaybackState::Playing {
                            let _ = evt_tx.send(AudioEvent::Position {
                                generation: g,
                                current: pos,
                                duration: dur,
                            });
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

fn load_source(
    player: &MediaPlayer,
    smtc: &SystemMediaTransportControls,
    url: &str,
    title: &str,
    artist: &str,
    album: &str,
    cover_url: Option<&str>,
) -> windows::core::Result<()> {
    let uri = Uri::CreateUri(&HSTRING::from(url))?;
    let source = MediaSource::CreateFromUri(&uri)?;
    let playback_source: IMediaPlaybackSource = source.cast()?;
    player.SetSource(&playback_source)?;
    let _ = smtc.SetPlaybackStatus(MediaPlaybackStatus::Changing);
    update_smtc_display(smtc, title, artist, album, cover_url);
    player.Play()?;
    Ok(())
}

fn update_smtc_display(
    smtc: &SystemMediaTransportControls,
    title: &str,
    artist: &str,
    album: &str,
    cover_url: Option<&str>,
) {
    if let Ok(updater) = smtc.DisplayUpdater() {
        let _ = updater.ClearAll();
        let _ = updater.SetType(MediaPlaybackType::Music);
        if let Ok(props) = updater.MusicProperties() {
            let _ = props.SetTitle(&HSTRING::from(title));
            let _ = props.SetArtist(&HSTRING::from(artist));
            if !album.is_empty() {
                let _ = props.SetAlbumTitle(&HSTRING::from(album));
            }
        }
        if let Some(cover) = cover_url.filter(|s| s.starts_with("http")) {
            if let Ok(cover_uri) = Uri::CreateUri(&HSTRING::from(cover)) {
                if let Ok(thumb) = RandomAccessStreamReference::CreateFromUri(&cover_uri) {
                    let _ = updater.SetThumbnail(&thumb);
                }
            }
        }
        let _ = updater.Update();
    }
}

fn update_smtc_timeline(smtc: &SystemMediaTransportControls, position: f64, duration: f64) {
    if duration <= 0.0 {
        return;
    }
    if let Ok(tl) = SystemMediaTransportControlsTimelineProperties::new() {
        let _ = tl.SetStartTime(TimeSpan { Duration: 0 });
        let _ = tl.SetMinSeekTime(TimeSpan { Duration: 0 });
        let _ = tl.SetPosition(secs_to_timespan(position.clamp(0.0, duration)));
        let _ = tl.SetMaxSeekTime(secs_to_timespan(duration));
        let _ = tl.SetEndTime(secs_to_timespan(duration));
        let _ = smtc.UpdateTimelineProperties(&tl);
    }
}

fn timespan_to_secs(ts: TimeSpan) -> f64 {
    (ts.Duration as f64 / TICKS_PER_SECOND).max(0.0)
}

fn secs_to_timespan(secs: f64) -> TimeSpan {
    TimeSpan {
        Duration: (secs * TICKS_PER_SECOND).round() as i64,
    }
}
