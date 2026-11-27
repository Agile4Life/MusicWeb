use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bs_dsp::{
    AdaptiveConfig, AdaptiveEngine, AdaptiveTelemetry, MicCalibration, SharedDspState, SweepChannel,
    analyze_noise_floor, analyze_sweep_rir, generate_farina_ess, generate_pink_noise,
    generate_synced_farina_ess,
};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat, StreamConfig};
use tokio::sync::mpsc;

use crate::backend::DspUiEvent;

pub fn enumerate_audio_devices() -> (Vec<String>, Vec<String>, Option<String>, Option<String>) {
    let host = cpal::default_host();
    let default_out = host
        .default_output_device()
        .and_then(|d| d.name().ok());
    let default_in = host
        .default_input_device()
        .and_then(|d| d.name().ok());

    let mut outputs = Vec::new();
    if let Ok(devs) = host.output_devices() {
        for d in devs {
            if let Ok(n) = d.name() {
                if !outputs.contains(&n) {
                    outputs.push(n);
                }
            }
        }
    }
    let mut inputs = Vec::new();
    if let Ok(devs) = host.input_devices() {
        for d in devs {
            if let Ok(n) = d.name() {
                if !inputs.contains(&n) {
                    inputs.push(n);
                }
            }
        }
    }

    (outputs, inputs, default_out, default_in)
}

pub fn pick_output_device(name: Option<&str>) -> Option<cpal::Device> {
    let host = cpal::default_host();
    if let Some(target) = name {
        if let Ok(mut devs) = host.output_devices() {
            if let Some(d) = devs.find(|d| d.name().ok().as_deref() == Some(target)) {
                return Some(d);
            }
        }
    }
    host.default_output_device()
}

pub fn pick_input_device(name: Option<&str>) -> Option<cpal::Device> {
    let host = cpal::default_host();
    if let Some(target) = name {
        if let Ok(mut devs) = host.input_devices() {
            if let Some(d) = devs.find(|d| d.name().ok().as_deref() == Some(target)) {
                return Some(d);
            }
        }
    }
    host.default_input_device()
}

pub(crate) enum MicTaskCmd {
    StartNoiseCheck { mic_name: Option<String> },
    StartPinkNoise {
        output_name: Option<String>,
        channel: SweepChannel,
        volume: f32,
    },
    StopTestTone,
    RunSweep {
        mic_name: Option<String>,
        output_name: Option<String>,
        channel: SweepChannel,
        duration_sec: f64,
        volume: f32,
        mic_cal: Option<MicCalibration>,
    },
    PlaySpeakerPinkNoise {
        output_name: Option<String>,
        channel: SweepChannel,
        duration_sec: f64,
        volume: f32,
    },
    PlaySpeakerSyncedSweep {
        output_name: Option<String>,
        channel: SweepChannel,
        duration_sec: f64,
        volume: f32,
    },
    SetAdaptiveConfig(AdaptiveConfig),
    Shutdown,
}

pub(crate) struct MicServiceHandle {
    pub cmd_tx: mpsc::UnboundedSender<MicTaskCmd>,
    pub last_room_dbfs: Arc<AtomicU32>,
}

pub(crate) fn spawn_mic_service(
    shared_dsp: SharedDspState,
    playback_rms_bits: Arc<AtomicU32>,
    ui_tx: mpsc::UnboundedSender<DspUiEvent>,
) -> MicServiceHandle {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    let last_room_dbfs = Arc::new(AtomicU32::new((-65.0_f32).to_bits()));
    let room_ref = Arc::clone(&last_room_dbfs);

    std::thread::Builder::new()
        .name("bs-mic-service".to_string())
        .spawn(move || {
            run_mic_loop(cmd_rx, shared_dsp, playback_rms_bits, room_ref, ui_tx);
        })
        .expect("spawn mic service thread");

    MicServiceHandle {
        cmd_tx,
        last_room_dbfs,
    }
}

fn run_mic_loop(
    mut cmd_rx: mpsc::UnboundedReceiver<MicTaskCmd>,
    shared_dsp: SharedDspState,
    playback_rms_bits: Arc<AtomicU32>,
    last_room_dbfs: Arc<AtomicU32>,
    ui_tx: mpsc::UnboundedSender<DspUiEvent>,
) {
    let mut adaptive_cfg = AdaptiveConfig::default();
    let mut adaptive_engine = AdaptiveEngine::new(48_000.0);

    let mut adaptive_stream: Option<cpal::Stream> = None;
    let mut active_adaptive_mic: Option<String> = None;
    let adaptive_buf = Arc::new(Mutex::new(Vec::<f32>::new()));

    let mut noise_stream: Option<cpal::Stream> = None;
    let noise_buf = Arc::new(Mutex::new(Vec::<f32>::new()));

    let mut pink_stream: Option<cpal::Stream> = None;

    loop {
        // Drain pending commands non-blockingly if streams are running, else block briefly
        let cmd = if adaptive_stream.is_some() || noise_stream.is_some() || pink_stream.is_some() {
            match cmd_rx.try_recv() {
                Ok(c) => Some(c),
                Err(mpsc::error::TryRecvError::Empty) => None,
                Err(mpsc::error::TryRecvError::Disconnected) => break,
            }
        } else {
            match cmd_rx.blocking_recv() {
                Some(c) => Some(c),
                None => break,
            }
        };

        if let Some(c) = cmd {
            match c {
                MicTaskCmd::Shutdown => break,
                MicTaskCmd::SetAdaptiveConfig(cfg) => {
                    let want = cfg.ambient_enabled || cfg.ducking_enabled;
                    let mic_changed = cfg.mic_name != active_adaptive_mic;
                    adaptive_cfg = cfg;
                    if !want {
                        adaptive_stream = None;
                        active_adaptive_mic = None;
                        adaptive_engine.reset();
                        shared_dsp.set_adaptive_gains(0.0, 0.0);
                        let _ = ui_tx.send(DspUiEvent::AdaptiveStatus(AdaptiveTelemetry::default()));
                    } else if (adaptive_stream.is_none() || mic_changed) && noise_stream.is_none() {
                        drop(adaptive_stream.take());
                        active_adaptive_mic = adaptive_cfg.mic_name.clone();
                        adaptive_stream = open_mono_mic_stream(
                            active_adaptive_mic.as_deref(),
                            Arc::clone(&adaptive_buf),
                            &mut adaptive_engine,
                        );
                        if adaptive_stream.is_none() {
                            let _ = ui_tx.send(DspUiEvent::AdaptiveStatus(
                                AdaptiveTelemetry::default(),
                            ));
                        }
                    }
                }
                MicTaskCmd::StartNoiseCheck { mic_name } => {
                    // Pause background adaptive mic while running explicit calibration check
                    adaptive_stream = None;
                    noise_stream = open_simple_mic_stream(mic_name.as_deref(), Arc::clone(&noise_buf));
                    if noise_stream.is_none() {
                        let _ = ui_tx.send(DspUiEvent::MicLevel {
                            rms_dbfs: -90.0,
                            peak_dbfs: -90.0,
                            clipping: false,
                        });
                    }
                }
                MicTaskCmd::StartPinkNoise {
                    output_name,
                    channel,
                    volume,
                } => {
                    shared_dsp.set_calibration_bypass(true);
                    pink_stream = start_pink_noise_stream(output_name.as_deref(), channel, volume);
                }
                MicTaskCmd::StopTestTone => {
                    noise_stream = None;
                    pink_stream = None;
                    shared_dsp.set_calibration_bypass(false);
                    if adaptive_cfg.ambient_enabled || adaptive_cfg.ducking_enabled {
                        active_adaptive_mic = adaptive_cfg.mic_name.clone();
                        adaptive_stream = open_mono_mic_stream(
                            active_adaptive_mic.as_deref(),
                            Arc::clone(&adaptive_buf),
                            &mut adaptive_engine,
                        );
                    }
                }
                MicTaskCmd::RunSweep {
                    mic_name,
                    output_name,
                    channel,
                    duration_sec,
                    volume,
                    mic_cal,
                } => {
                    noise_stream = None;
                    pink_stream = None;
                    adaptive_stream = None;
                    shared_dsp.set_calibration_bypass(true);

                    let result = perform_full_duplex_sweep(
                        mic_name.as_deref(),
                        output_name.as_deref(),
                        channel,
                        duration_sec,
                        volume,
                        mic_cal.as_ref(),
                        &ui_tx,
                    );
                    shared_dsp.set_calibration_bypass(false);
                    let _ = ui_tx.send(DspUiEvent::SweepCompleted(result));

                    if adaptive_cfg.ambient_enabled || adaptive_cfg.ducking_enabled {
                        active_adaptive_mic = adaptive_cfg.mic_name.clone();
                        adaptive_stream = open_mono_mic_stream(
                            active_adaptive_mic.as_deref(),
                            Arc::clone(&adaptive_buf),
                            &mut adaptive_engine,
                        );
                    }
                }
                MicTaskCmd::PlaySpeakerPinkNoise {
                    output_name,
                    channel,
                    duration_sec,
                    volume,
                } => {
                    noise_stream = None;
                    pink_stream = None;
                    adaptive_stream = None;
                    shared_dsp.set_calibration_bypass(true);

                    let result = perform_speaker_signal_playback(
                        output_name.as_deref(),
                        channel,
                        duration_sec,
                        volume,
                        false,
                        &ui_tx,
                    );
                    shared_dsp.set_calibration_bypass(false);
                    let _ = ui_tx.send(DspUiEvent::SpeakerPlaybackDone(result));

                    if adaptive_cfg.ambient_enabled || adaptive_cfg.ducking_enabled {
                        active_adaptive_mic = adaptive_cfg.mic_name.clone();
                        adaptive_stream = open_mono_mic_stream(
                            active_adaptive_mic.as_deref(),
                            Arc::clone(&adaptive_buf),
                            &mut adaptive_engine,
                        );
                    }
                }
                MicTaskCmd::PlaySpeakerSyncedSweep {
                    output_name,
                    channel,
                    duration_sec,
                    volume,
                } => {
                    noise_stream = None;
                    pink_stream = None;
                    adaptive_stream = None;
                    shared_dsp.set_calibration_bypass(true);

                    let result = perform_speaker_signal_playback(
                        output_name.as_deref(),
                        channel,
                        duration_sec,
                        volume,
                        true,
                        &ui_tx,
                    );
                    shared_dsp.set_calibration_bypass(false);
                    let _ = ui_tx.send(DspUiEvent::SpeakerPlaybackDone(result));

                    if adaptive_cfg.ambient_enabled || adaptive_cfg.ducking_enabled {
                        active_adaptive_mic = adaptive_cfg.mic_name.clone();
                        adaptive_stream = open_mono_mic_stream(
                            active_adaptive_mic.as_deref(),
                            Arc::clone(&adaptive_buf),
                            &mut adaptive_engine,
                        );
                    }
                }
            }
        }

        // Process live noise-check mic samples
        if noise_stream.is_some() {
            let chunk: Vec<f32> = {
                let mut g = noise_buf.lock().unwrap();
                if g.len() >= 1024 {
                    std::mem::take(&mut *g)
                } else {
                    Vec::new()
                }
            };
            if !chunk.is_empty() {
                let check = analyze_noise_floor(&chunk);
                let _ = ui_tx.send(DspUiEvent::MicLevel {
                    rms_dbfs: check.rms_dbfs,
                    peak_dbfs: check.peak_dbfs,
                    clipping: check.clipping,
                });
            }
        }

        // Process opt-in adaptive background mic samples
        if adaptive_stream.is_some() {
            let drained: Vec<f32> = {
                let mut g = adaptive_buf.lock().unwrap();
                if g.len() >= 1024 {
                    std::mem::take(&mut *g)
                } else {
                    Vec::new()
                }
            };
            if !drained.is_empty() {
                let play_rms = f32::from_bits(playback_rms_bits.load(Ordering::Relaxed));
                let mut latest = AdaptiveTelemetry::default();
                for frame in drained.as_chunks::<1024>().0 {
                    latest = adaptive_engine.process_mic_frame(frame, play_rms, &adaptive_cfg);
                }
                last_room_dbfs.store(latest.room_dbfs.to_bits(), Ordering::Relaxed);
                shared_dsp.set_adaptive_gains(latest.applied_ambient_db, latest.applied_duck_db);
                let _ = ui_tx.send(DspUiEvent::AdaptiveStatus(latest));
            }
        }

        if adaptive_stream.is_some() || noise_stream.is_some() || pink_stream.is_some() {
            std::thread::sleep(Duration::from_millis(45));
        }
    }
}

fn open_mono_mic_stream(
    mic_name: Option<&str>,
    buf: Arc<Mutex<Vec<f32>>>,
    engine: &mut AdaptiveEngine,
) -> Option<cpal::Stream> {
    let dev = pick_input_device(mic_name)?;
    let cfg = dev.default_input_config().ok()?;
    let sr = cfg.sample_rate().0;
    let ch = cfg.channels() as usize;
    engine.set_sample_rate(sr as f64);

    build_input_stream_mono(&dev, &cfg, ch, buf)
}

fn open_simple_mic_stream(mic_name: Option<&str>, buf: Arc<Mutex<Vec<f32>>>) -> Option<cpal::Stream> {
    let dev = pick_input_device(mic_name)?;
    let cfg = dev.default_input_config().ok()?;
    let ch = cfg.channels() as usize;
    build_input_stream_mono(&dev, &cfg, ch, buf)
}

fn build_input_stream_mono(
    dev: &cpal::Device,
    supported: &cpal::SupportedStreamConfig,
    channels: usize,
    buf: Arc<Mutex<Vec<f32>>>,
) -> Option<cpal::Stream> {
    let fmt = supported.sample_format();
    let cfg: StreamConfig = supported.clone().into();
    let err_fn = |err| tracing::warn!("Mic input error: {err}");

    match fmt {
        SampleFormat::F32 => dev
            .build_input_stream(
                &cfg,
                move |data: &[f32], _| push_downmixed_mono(data, channels, &buf),
                err_fn,
                None,
            )
            .ok(),
        SampleFormat::I16 => dev
            .build_input_stream(
                &cfg,
                move |data: &[i16], _| {
                    let floats: Vec<f32> = data.iter().map(|&s| s.to_sample::<f32>()).collect();
                    push_downmixed_mono(&floats, channels, &buf);
                },
                err_fn,
                None,
            )
            .ok(),
        SampleFormat::U16 => dev
            .build_input_stream(
                &cfg,
                move |data: &[u16], _| {
                    let floats: Vec<f32> = data.iter().map(|&s| s.to_sample::<f32>()).collect();
                    push_downmixed_mono(&floats, channels, &buf);
                },
                err_fn,
                None,
            )
            .ok(),
        _ => None,
    }
    .and_then(|s| s.play().ok().map(|()| s))
}

fn push_downmixed_mono(data: &[f32], channels: usize, buf: &Arc<Mutex<Vec<f32>>>) {
    let ch = channels.max(1);
    if let Ok(mut g) = buf.try_lock() {
        if g.len() > 48_000 * 12 {
            return;
        }
        for frame in data.chunks(ch) {
            let sum: f32 = frame.iter().copied().sum();
            g.push(sum / frame.len() as f32);
        }
    }
}

fn write_mono_to_channel<T>(frame: &mut [T], sample: f32, channel: SweepChannel)
where
    T: Sample + cpal::FromSample<f32>,
{
    let q = T::from_sample(sample);
    let zero = T::from_sample(0.0);
    match channel {
        SweepChannel::Stereo => frame.fill(q),
        SweepChannel::Left => {
            if !frame.is_empty() {
                frame[0] = q;
            }
            for s in frame.iter_mut().skip(1) {
                *s = zero;
            }
        }
        SweepChannel::Right => {
            let flen = frame.len();
            for (ci, s) in frame.iter_mut().enumerate() {
                *s = if ci == 1 || flen == 1 { q } else { zero };
            }
        }
    }
}

fn start_pink_noise_stream(
    output_name: Option<&str>,
    channel: SweepChannel,
    volume: f32,
) -> Option<cpal::Stream> {
    let dev = pick_output_device(output_name)?;
    let supported = dev.default_output_config().ok()?;
    let sr = supported.sample_rate().0;
    let ch = supported.channels() as usize;
    let loop_buf = generate_pink_noise(sr, 4.0, volume.clamp(0.05, 0.7));
    let len = loop_buf.len().max(1);
    let idx = Arc::new(AtomicUsize::new(0));
    let fmt = supported.sample_format();
    let cfg: StreamConfig = supported.into();
    let err_fn = |err| tracing::warn!("Pink noise output error: {err}");

    let stream = match fmt {
        SampleFormat::F32 => dev
            .build_output_stream(
                &cfg,
                move |data: &mut [f32], _| {
                    let mut p = idx.load(Ordering::Relaxed);
                    for frame in data.chunks_mut(ch.max(1)) {
                        let s = loop_buf[p % len];
                        p = (p + 1) % len;
                        write_mono_to_channel(frame, s, channel);
                    }
                    idx.store(p, Ordering::Relaxed);
                },
                err_fn,
                None,
            )
            .ok(),
        SampleFormat::I16 => dev
            .build_output_stream(
                &cfg,
                move |data: &mut [i16], _| {
                    let mut p = idx.load(Ordering::Relaxed);
                    for frame in data.chunks_mut(ch.max(1)) {
                        let s = loop_buf[p % len];
                        p = (p + 1) % len;
                        write_mono_to_channel(frame, s, channel);
                    }
                    idx.store(p, Ordering::Relaxed);
                },
                err_fn,
                None,
            )
            .ok(),
        _ => None,
    }?;
    stream.play().ok()?;
    Some(stream)
}

fn perform_speaker_signal_playback(
    output_name: Option<&str>,
    channel: SweepChannel,
    duration_sec: f64,
    volume: f32,
    synced_sweep: bool,
    ui_tx: &mpsc::UnboundedSender<DspUiEvent>,
) -> Result<(), String> {
    let out_dev = pick_output_device(output_name)
        .ok_or_else(|| "Không tìm thấy thiết bị phát âm thanh Windows".to_string())?;
    let out_cfg = out_dev
        .default_output_config()
        .map_err(|e| format!("Lỗi cấu hình loa: {e}"))?;
    let out_sr = out_cfg.sample_rate().0;
    let out_ch = out_cfg.channels() as usize;
    let out_fmt = out_cfg.sample_format();
    let out_stream_cfg: StreamConfig = out_cfg.into();

    let playback = if synced_sweep {
        let sig = generate_synced_farina_ess(
            out_sr,
            duration_sec.clamp(2.5, 8.0),
            20.0,
            20_000.0,
            volume.clamp(0.05, 0.85),
        );
        sig.playback
    } else {
        let lead = vec![0.0_f32; (0.25 * out_sr as f64).round() as usize];
        let noise = generate_pink_noise(out_sr, duration_sec.clamp(4.0, 15.0), volume.clamp(0.05, 0.70));
        let mut buf = Vec::with_capacity(lead.len() + noise.len());
        buf.extend_from_slice(&lead);
        buf.extend_from_slice(&noise);
        buf
    };

    let actual_dur = playback.len() as f64 / out_sr.max(8000) as f64;
    let _ = ui_tx.send(DspUiEvent::SpeakerPlaybackStarted {
        out_sample_rate: out_sr,
        duration_sec: actual_dur,
    });

    let total_frames = playback.len();
    let out_pos = Arc::new(AtomicUsize::new(0));
    let done_flag = Arc::new(AtomicBool::new(false));
    let buf_arc = Arc::new(playback);
    let out_pos_cb = Arc::clone(&out_pos);
    let done_cb = Arc::clone(&done_flag);
    let err_fn = |err| tracing::warn!("Speaker calibration output error: {err}");

    let out_stream = match out_fmt {
        SampleFormat::F32 => out_dev
            .build_output_stream(
                &out_stream_cfg,
                move |data: &mut [f32], _| {
                    let mut pos = out_pos_cb.load(Ordering::Relaxed);
                    for frame in data.chunks_mut(out_ch.max(1)) {
                        let s = buf_arc.get(pos).copied().unwrap_or(0.0);
                        write_mono_to_channel(frame, s, channel);
                        pos = pos.saturating_add(1);
                    }
                    out_pos_cb.store(pos, Ordering::Relaxed);
                    if pos >= total_frames {
                        done_cb.store(true, Ordering::Release);
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("Lỗi mở luồng phát đo phòng: {e}"))?,
        SampleFormat::I16 => out_dev
            .build_output_stream(
                &out_stream_cfg,
                move |data: &mut [i16], _| {
                    let mut pos = out_pos_cb.load(Ordering::Relaxed);
                    for frame in data.chunks_mut(out_ch.max(1)) {
                        let s = buf_arc.get(pos).copied().unwrap_or(0.0);
                        write_mono_to_channel(frame, s, channel);
                        pos = pos.saturating_add(1);
                    }
                    out_pos_cb.store(pos, Ordering::Relaxed);
                    if pos >= total_frames {
                        done_cb.store(true, Ordering::Release);
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("Lỗi mở luồng phát đo phòng: {e}"))?,
        _ => return Err("Định dạng âm thanh đầu ra chưa hỗ trợ".to_string()),
    };

    out_stream
        .play()
        .map_err(|e| format!("Không phát được tín hiệu đo phòng: {e}"))?;

    let start = Instant::now();
    let max_wait = Duration::from_secs_f64(actual_dur + 3.0);
    while !done_flag.load(Ordering::Acquire) && start.elapsed() < max_wait {
        let p = (out_pos.load(Ordering::Relaxed) as f32 / total_frames.max(1) as f32).clamp(0.0, 0.90);
        let stage = if synced_sweep {
            format!("Đang phát Farina ESS đồng bộ ({channel} · {:.0}%)…", p * 100.0)
        } else {
            format!("Đang phát Pink Noise MMM ({channel} · {:.0}%) — quơ iPhone quanh vùng tai…", p * 100.0)
        };
        let _ = ui_tx.send(DspUiEvent::SweepProgress { progress: p, stage });
        std::thread::sleep(Duration::from_millis(60));
    }
    std::thread::sleep(Duration::from_millis(120));
    drop(out_stream);
    Ok(())
}

fn perform_full_duplex_sweep(
    mic_name: Option<&str>,
    output_name: Option<&str>,
    channel: SweepChannel,
    duration_sec: f64,
    volume: f32,
    mic_cal: Option<&MicCalibration>,
    ui_tx: &mpsc::UnboundedSender<DspUiEvent>,
) -> Result<bs_dsp::MeasuredResponse, String> {
    let out_dev = pick_output_device(output_name)
        .ok_or_else(|| "Không tìm thấy thiết bị phát âm thanh Windows".to_string())?;
    let in_dev = pick_input_device(mic_name)
        .ok_or_else(|| "Không tìm thấy micro để đo phòng".to_string())?;

    let out_cfg = out_dev
        .default_output_config()
        .map_err(|e| format!("Lỗi cấu hình loa: {e}"))?;
    let in_cfg = in_dev
        .default_input_config()
        .map_err(|e| format!("Lỗi cấu hình micro: {e}"))?;

    let out_sr = out_cfg.sample_rate().0;
    let out_ch = out_cfg.channels() as usize;
    let in_sr = in_cfg.sample_rate().0;
    let in_ch = in_cfg.channels() as usize;

    let sweep_dur = duration_sec.clamp(2.5, 8.0);
    let lead_in_samples = (0.35 * out_sr as f64) as usize;
    let tail_samples = (0.65 * out_sr as f64) as usize;
    let (sweep, inv_filter) = generate_farina_ess(
        out_sr,
        sweep_dur,
        20.0,
        20_000.0,
        volume.clamp(0.05, 0.85),
    );

    let total_out_frames = lead_in_samples + sweep.len() + tail_samples;
    let out_pos = Arc::new(AtomicUsize::new(0));
    let done_flag = Arc::new(AtomicBool::new(false));
    let recorded = Arc::new(Mutex::new(Vec::<f32>::with_capacity(
        (total_out_frames as f64 * in_sr as f64 / out_sr as f64) as usize + 8192,
    )));

    let rec_clone = Arc::clone(&recorded);
    let in_stream = build_input_stream_mono(&in_dev, &in_cfg, in_ch, rec_clone)
        .ok_or_else(|| "Không mở được luồng thu micro WASAPI".to_string())?;

    let out_pos_cb = Arc::clone(&out_pos);
    let done_cb = Arc::clone(&done_flag);
    let sweep_arc = Arc::new(sweep);
    let sweep_len = sweep_arc.len();
    let out_fmt = out_cfg.sample_format();
    let out_stream_cfg: StreamConfig = out_cfg.into();
    let err_fn = |err| tracing::warn!("Sweep output error: {err}");

    let out_stream = match out_fmt {
        SampleFormat::F32 => out_dev
            .build_output_stream(
                &out_stream_cfg,
                move |data: &mut [f32], _| {
                    let mut pos = out_pos_cb.load(Ordering::Relaxed);
                    for frame in data.chunks_mut(out_ch.max(1)) {
                        let sample = if pos >= lead_in_samples && pos < lead_in_samples + sweep_len {
                            sweep_arc[pos - lead_in_samples]
                        } else {
                            0.0
                        };
                        match channel {
                            SweepChannel::Stereo => {
                                for s in frame.iter_mut() {
                                    *s = sample;
                                }
                            }
                            SweepChannel::Left => {
                                if !frame.is_empty() {
                                    frame[0] = sample;
                                }
                                for s in frame.iter_mut().skip(1) {
                                    *s = 0.0;
                                }
                            }
                            SweepChannel::Right => {
                                let flen = frame.len();
                                for (ci, s) in frame.iter_mut().enumerate() {
                                    *s = if ci == 1 || flen == 1 { sample } else { 0.0 };
                                }
                            }
                        }
                        pos = pos.saturating_add(1);
                    }
                    out_pos_cb.store(pos, Ordering::Relaxed);
                    if pos >= total_out_frames {
                        done_cb.store(true, Ordering::Release);
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("Lỗi mở luồng phát sweep: {e}"))?,
        SampleFormat::I16 => out_dev
            .build_output_stream(
                &out_stream_cfg,
                move |data: &mut [i16], _| {
                    let mut pos = out_pos_cb.load(Ordering::Relaxed);
                    for frame in data.chunks_mut(out_ch.max(1)) {
                        let sample = if pos >= lead_in_samples && pos < lead_in_samples + sweep_len {
                            sweep_arc[pos - lead_in_samples]
                        } else {
                            0.0
                        };
                        let q: i16 = Sample::from_sample(sample);
                        match channel {
                            SweepChannel::Stereo => frame.fill(q),
                            SweepChannel::Left => {
                                if !frame.is_empty() {
                                    frame[0] = q;
                                }
                                for s in frame.iter_mut().skip(1) {
                                    *s = 0;
                                }
                            }
                            SweepChannel::Right => {
                                let flen = frame.len();
                                for (ci, s) in frame.iter_mut().enumerate() {
                                    *s = if ci == 1 || flen == 1 { q } else { 0 };
                                }
                            }
                        }
                        pos = pos.saturating_add(1);
                    }
                    out_pos_cb.store(pos, Ordering::Relaxed);
                    if pos >= total_out_frames {
                        done_cb.store(true, Ordering::Release);
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("Lỗi mở luồng phát sweep: {e}"))?,
        _ => return Err("Định dạng âm thanh đầu ra chưa hỗ trợ cho quét sweep".to_string()),
    };

    let _ = ui_tx.send(DspUiEvent::SweepProgress {
        progress: 0.02,
        stage: format!("Đang phát tín hiệu quét {}…", channel),
    });
    out_stream
        .play()
        .map_err(|e| format!("Không phát được tín hiệu quét: {e}"))?;

    let start = Instant::now();
    let max_wait = Duration::from_secs_f64(sweep_dur + 3.5);
    while !done_flag.load(Ordering::Acquire) && start.elapsed() < max_wait {
        let p = (out_pos.load(Ordering::Relaxed) as f32 / total_out_frames as f32).clamp(0.0, 0.92);
        let _ = ui_tx.send(DspUiEvent::SweepProgress {
            progress: p,
            stage: format!("Đang quét 20 Hz – 20 kHz ({:.0}%)…", p * 100.0),
        });
        std::thread::sleep(Duration::from_millis(60));
    }
    std::thread::sleep(Duration::from_millis(120));
    drop(out_stream);
    drop(in_stream);

    let _ = ui_tx.send(DspUiEvent::SweepProgress {
        progress: 0.96,
        stage: "Đang giải chập FFT & phân tích cộng hưởng phòng…".to_string(),
    });

    let raw_mic = std::mem::take(&mut *recorded.lock().unwrap());
    // Linearly resample mic audio to `out_sr` if input and output sample rates differ
    let aligned_mic = if in_sr == out_sr || raw_mic.is_empty() {
        raw_mic
    } else {
        resample_mono_linear(&raw_mic, in_sr, out_sr)
    };

    analyze_sweep_rir(
        &aligned_mic,
        &inv_filter,
        out_sr,
        mic_cal,
        &channel.to_string(),
    )
    .map_err(|e| e.to_string())
}

fn resample_mono_linear(src: &[f32], in_sr: u32, out_sr: u32) -> Vec<f32> {
    if src.is_empty() || in_sr == 0 || out_sr == 0 {
        return Vec::new();
    }
    let ratio = out_sr as f64 / in_sr as f64;
    let out_len = ((src.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 / ratio;
        let i0 = (pos.floor() as usize).min(src.len() - 1);
        let i1 = (i0 + 1).min(src.len() - 1);
        let frac = (pos - i0 as f64) as f32;
        out.push(src[i0] * (1.0 - frac) + src[i1] * frac);
    }
    out
}
