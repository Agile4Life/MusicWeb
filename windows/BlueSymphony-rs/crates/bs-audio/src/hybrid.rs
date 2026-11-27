use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use bs_dsp::{DspStore, MicCalibration, SharedDspState};
use tokio::sync::mpsc;

use crate::backend::{AudioCommand, AudioEvent, AudioHandle, DspUiEvent};
use crate::mic_capture::{MicTaskCmd, enumerate_audio_devices, spawn_mic_service};
use crate::pcm_player::{PcmOutcome, PcmPlayerCmd, spawn_pcm_player};
use crate::win_player::{WinPlayerCmd, spawn_win_player_thread};

#[derive(Clone, Copy, PartialEq, Eq)]
enum TrackEngine {
    Pcm,
    WinRt,
}

#[derive(Clone)]
struct PendingTrackMeta {
    generation: u64,
    url: String,
    title: String,
    artist: String,
    album: String,
    cover_url: Option<String>,
}

/// Spawns the Dual-Backend Audio Engine:
/// - Primary: Pure-Rust PCM pipeline (`reqwest` + `symphonia` + `rubato` + `bs_dsp` + `cpal` WASAPI)
/// - Secondary / SMTC Bridge: `win_player.rs` (handles Windows 11 SMTC media keys & cover metadata,
///   plus automatic seamless fallback when encountering unsupported streams like HLS `.m3u8`).
/// - Mic & Calibration Service: WASAPI input capture for Room Calibration sweeps and opt-in Adaptive Audio.
pub fn spawn_hybrid_audio_backend(
    http: reqwest::Client,
    initial_dsp: DspStore,
    initial_volume: f64,
) -> (
    AudioHandle,
    mpsc::UnboundedReceiver<AudioEvent>,
    mpsc::UnboundedReceiver<DspUiEvent>,
) {
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<AudioCommand>();
    let (evt_tx, evt_rx) = mpsc::unbounded_channel::<AudioEvent>();
    let (ui_tx, ui_rx) = mpsc::unbounded_channel::<DspUiEvent>();

    let (win_tx, win_rx) = mpsc::unbounded_channel::<WinPlayerCmd>();
    let (win_evt_tx, mut win_evt_rx) = mpsc::unbounded_channel::<AudioEvent>();
    spawn_win_player_thread(win_rx, win_evt_tx);

    let shared_dsp = SharedDspState::new(initial_dsp.clone(), initial_volume);
    let playback_rms_bits = Arc::new(AtomicU32::new((-90.0_f32).to_bits()));

    let (pcm_out_tx, mut pcm_out_rx) = mpsc::unbounded_channel::<PcmOutcome>();
    let pcm = spawn_pcm_player(
        http,
        shared_dsp.clone(),
        Arc::clone(&playback_rms_bits),
        pcm_out_tx,
        ui_tx.clone(),
    );

    let mic = spawn_mic_service(shared_dsp.clone(), playback_rms_bits, ui_tx.clone());
    if initial_dsp.adaptive.ambient_enabled || initial_dsp.adaptive.ducking_enabled {
        let _ = mic
            .cmd_tx
            .send(MicTaskCmd::SetAdaptiveConfig(initial_dsp.adaptive.clone()));
    }

    tokio::spawn(async move {
        let mut active_engine = TrackEngine::Pcm;
        let mut dsp_enabled = initial_dsp.dsp_engine_enabled;
        let mut bit_perfect_enabled = initial_dsp.bit_perfect_enabled;
        let mut adaptive_cfg = initial_dsp.adaptive;
        let mut current_meta: Option<PendingTrackMeta> = None;

        if bit_perfect_enabled {
            let _ = pcm.cmd_tx.send(PcmPlayerCmd::SetBitPerfect {
                enabled: true,
                device: initial_dsp.bit_perfect_device.clone(),
                lock_volume: initial_dsp.bit_perfect_lock_volume,
            });
            let mut off = adaptive_cfg.clone();
            off.ambient_enabled = false;
            off.ducking_enabled = false;
            let _ = mic.cmd_tx.send(MicTaskCmd::SetAdaptiveConfig(off));
        }

        // Announce devices right after startup
        {
            let (outputs, inputs, default_output, default_input) = enumerate_audio_devices();
            let _ = ui_tx.send(DspUiEvent::DevicesListed {
                outputs,
                inputs,
                default_output: default_output.clone(),
                default_input,
            });
            if let Some(out) = default_output {
                let _ = ui_tx.send(DspUiEvent::OutputDeviceChanged(out));
            }
        }

        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    let Some(cmd) = cmd else { break; };
                    match cmd {
                        AudioCommand::Shutdown => {
                            let _ = pcm.cmd_tx.send(PcmPlayerCmd::Shutdown);
                            let _ = mic.cmd_tx.send(MicTaskCmd::Shutdown);
                            let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::Shutdown));
                            break;
                        }
                        AudioCommand::Load { generation, url, title, artist, album, cover_url } => {
                            let meta = PendingTrackMeta {
                                generation,
                                url: url.clone(),
                                title: title.clone(),
                                artist: artist.clone(),
                                album: album.clone(),
                                cover_url: cover_url.clone(),
                            };
                            current_meta = Some(meta);

                            if dsp_enabled || bit_perfect_enabled {
                                active_engine = TrackEngine::Pcm;
                                let _ = win_tx.send(WinPlayerCmd::SmtcSetMeta {
                                    title,
                                    artist,
                                    album,
                                    cover_url,
                                });
                                let _ = pcm.cmd_tx.send(PcmPlayerCmd::Load { generation, url });
                                let _ = ui_tx.send(DspUiEvent::BackendMode { using_dsp: true, reason: None });
                            } else {
                                active_engine = TrackEngine::WinRt;
                                let _ = pcm.cmd_tx.send(PcmPlayerCmd::Stop);
                                let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::Load {
                                    generation,
                                    url,
                                    title,
                                    artist,
                                    album,
                                    cover_url,
                                }));
                                let _ = ui_tx.send(DspUiEvent::BackendMode {
                                    using_dsp: false,
                                    reason: Some("DSP Engine đang tắt".to_string()),
                                });
                            }
                        }
                        AudioCommand::Play => {
                            if active_engine == TrackEngine::Pcm {
                                let _ = pcm.cmd_tx.send(PcmPlayerCmd::Play);
                            }
                            let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::Play));
                        }
                        AudioCommand::Pause => {
                            if active_engine == TrackEngine::Pcm {
                                let _ = pcm.cmd_tx.send(PcmPlayerCmd::Pause);
                            }
                            let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::Pause));
                        }
                        AudioCommand::Stop => {
                            let _ = pcm.cmd_tx.send(PcmPlayerCmd::Stop);
                            let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::Stop));
                        }
                        AudioCommand::Seek(s) => {
                            if active_engine == TrackEngine::Pcm {
                                let _ = pcm.cmd_tx.send(PcmPlayerCmd::Seek(s));
                            } else {
                                let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::Seek(s)));
                            }
                        }
                        AudioCommand::SetVolume(v) => {
                            shared_dsp.set_app_volume(v);
                            let _ = pcm.cmd_tx.send(PcmPlayerCmd::SetVolume(v));
                            let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::SetVolume(v)));
                        }
                        AudioCommand::SetMuted(m) => {
                            let _ = pcm.cmd_tx.send(PcmPlayerCmd::SetMuted(m));
                            let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::SetMuted(m)));
                        }
                        AudioCommand::SetDspStore(store) => {
                            dsp_enabled = store.dsp_engine_enabled;
                            bit_perfect_enabled = store.bit_perfect_enabled;
                            adaptive_cfg = store.adaptive.clone();
                            let bp_dev = store.bit_perfect_device.clone();
                            let bp_lock = store.bit_perfect_lock_volume;
                            shared_dsp.set_store(store);
                            let _ = pcm.cmd_tx.send(PcmPlayerCmd::SetBitPerfect {
                                enabled: bit_perfect_enabled,
                                device: bp_dev,
                                lock_volume: bp_lock,
                            });
                            let mic_cfg = if bit_perfect_enabled {
                                let mut off = adaptive_cfg.clone();
                                off.ambient_enabled = false;
                                off.ducking_enabled = false;
                                off
                            } else {
                                adaptive_cfg.clone()
                            };
                            let _ = mic.cmd_tx.send(MicTaskCmd::SetAdaptiveConfig(mic_cfg));
                        }
                        AudioCommand::SetAdaptiveConfig(cfg) => {
                            adaptive_cfg = cfg.clone();
                            let _ = mic.cmd_tx.send(MicTaskCmd::SetAdaptiveConfig(cfg));
                        }
                        AudioCommand::RecordVolumePreference(vol) => {
                            if adaptive_cfg.ambient_enabled {
                                let room_db = f32::from_bits(mic.last_room_dbfs.load(Ordering::Relaxed));
                                adaptive_cfg.learned_points.push((room_db, vol.clamp(0.0, 1.0)));
                                if adaptive_cfg.learned_points.len() > 32 {
                                    adaptive_cfg.learned_points.remove(0);
                                }
                                let _ = mic.cmd_tx.send(MicTaskCmd::SetAdaptiveConfig(adaptive_cfg.clone()));
                            }
                        }
                        AudioCommand::RefreshDevices => {
                            let (outputs, inputs, default_output, default_input) = enumerate_audio_devices();
                            let _ = ui_tx.send(DspUiEvent::DevicesListed {
                                outputs,
                                inputs,
                                default_output,
                                default_input,
                            });
                        }
                        AudioCommand::StartNoiseCheck { mic_name } => {
                            let _ = mic.cmd_tx.send(MicTaskCmd::StartNoiseCheck { mic_name });
                        }
                        AudioCommand::StartPinkNoise {
                            output_name,
                            channel,
                            volume,
                        } => {
                            let _ = mic.cmd_tx.send(MicTaskCmd::StartPinkNoise {
                                output_name,
                                channel,
                                volume,
                            });
                        }
                        AudioCommand::StopTestTone => {
                            let _ = mic.cmd_tx.send(MicTaskCmd::StopTestTone);
                        }
                        AudioCommand::PlaySpeakerPinkNoise {
                            output_name,
                            channel,
                            duration_sec,
                            volume,
                        } => {
                            let _ = pcm.cmd_tx.send(PcmPlayerCmd::Pause);
                            let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::Pause));
                            let _ = mic.cmd_tx.send(MicTaskCmd::PlaySpeakerPinkNoise {
                                output_name,
                                channel,
                                duration_sec,
                                volume,
                            });
                        }
                        AudioCommand::PlaySpeakerSyncedSweep {
                            output_name,
                            channel,
                            duration_sec,
                            volume,
                        } => {
                            let _ = pcm.cmd_tx.send(PcmPlayerCmd::Pause);
                            let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::Pause));
                            let _ = mic.cmd_tx.send(MicTaskCmd::PlaySpeakerSyncedSweep {
                                output_name,
                                channel,
                                duration_sec,
                                volume,
                            });
                        }
                        AudioCommand::RunSweep {
                            mic_name,
                            output_name,
                            channel,
                            duration_sec,
                            volume,
                            mic_cal_points,
                            mic_cal_name,
                        } => {
                            // Pause active music cleanly while sweeping
                            let _ = pcm.cmd_tx.send(PcmPlayerCmd::Pause);
                            let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::Pause));
                            let mic_cal = mic_cal_points.map(|pts| MicCalibration {
                                name: mic_cal_name.unwrap_or_else(|| "Custom Cal".to_string()),
                                points: pts,
                            });
                            let _ = mic.cmd_tx.send(MicTaskCmd::RunSweep {
                                mic_name,
                                output_name,
                                channel,
                                duration_sec,
                                volume,
                                mic_cal,
                            });
                        }
                    }
                }

                pcm_evt = pcm_out_rx.recv() => {
                    let Some(evt) = pcm_evt else { break; };
                    match evt {
                        PcmOutcome::Event(ae) => {
                            if active_engine == TrackEngine::Pcm {
                                match &ae {
                                    AudioEvent::Position { current, duration, .. } => {
                                        let _ = win_tx.send(WinPlayerCmd::SmtcSetState {
                                            playing: true,
                                            position: *current,
                                            duration: *duration,
                                        });
                                    }
                                    AudioEvent::StateChanged { playing, .. } => {
                                        let _ = win_tx.send(WinPlayerCmd::SmtcSetState {
                                            playing: *playing,
                                            position: 0.0,
                                            duration: 0.0,
                                        });
                                    }
                                    _ => {}
                                }
                                let _ = evt_tx.send(ae);
                            }
                        }
                        PcmOutcome::Fallback { generation, reason } => {
                            tracing::info!("PCM backend falling back to WinRT for gen {generation}: {reason}");
                            if let Some(ref meta) = current_meta {
                                if meta.generation == generation {
                                    active_engine = TrackEngine::WinRt;
                                    let _ = ui_tx.send(DspUiEvent::BackendMode {
                                        using_dsp: false,
                                        reason: Some(reason),
                                    });
                                    let _ = win_tx.send(WinPlayerCmd::Audio(AudioCommand::Load {
                                        generation: meta.generation,
                                        url: meta.url.clone(),
                                        title: meta.title.clone(),
                                        artist: meta.artist.clone(),
                                        album: meta.album.clone(),
                                        cover_url: meta.cover_url.clone(),
                                    }));
                                }
                            }
                        }
                    }
                }

                win_evt = win_evt_rx.recv() => {
                    let Some(we) = win_evt else { break; };
                    match we {
                        // Remote SMTC media keys always apply regardless of backend
                        AudioEvent::Remote(_) => {
                            let _ = evt_tx.send(we);
                        }
                        _ => {
                            if active_engine == TrackEngine::WinRt {
                                let _ = evt_tx.send(we);
                            }
                        }
                    }
                }
            }
        }
    });

    (AudioHandle::new(cmd_tx), evt_rx, ui_rx)
}
