use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use bs_dsp::{DspProcessor, SharedDspState};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat, StreamConfig};
use rubato::{FftFixedIn, Resampler};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{
    CODEC_TYPE_AAC, CODEC_TYPE_ALAC, CODEC_TYPE_FLAC, CODEC_TYPE_MP3, CODEC_TYPE_OPUS,
    CODEC_TYPE_PCM_ALAW, CODEC_TYPE_PCM_F32BE, CODEC_TYPE_PCM_F32LE, CODEC_TYPE_PCM_F64BE,
    CODEC_TYPE_PCM_F64LE, CODEC_TYPE_PCM_MULAW, CODEC_TYPE_PCM_S16BE, CODEC_TYPE_PCM_S16LE,
    CODEC_TYPE_PCM_S24BE, CODEC_TYPE_PCM_S24LE, CODEC_TYPE_PCM_S32BE, CODEC_TYPE_PCM_S32LE,
    CODEC_TYPE_PCM_U8, CODEC_TYPE_VORBIS, CodecType, DecoderOptions,
};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;
use tokio::sync::mpsc;

use crate::backend::{AudioEvent, DspUiEvent, SignalPathInfo};
use crate::ring::SpscRing;
use crate::wasapi_exclusive::{ExclusiveFeed, WasapiExclusiveStream};

#[derive(Debug, Clone)]
pub(crate) enum PcmPlayerCmd {
    Load {
        generation: u64,
        url: String,
    },
    Play,
    Pause,
    Stop,
    Seek(f64),
    SetVolume(f64),
    SetMuted(bool),
    SetBitPerfect {
        enabled: bool,
        device: Option<String>,
        lock_volume: bool,
    },
    PrepareOutput {
        generation: u64,
        in_sr: u32,
        src_bits: Option<u32>,
        codec_label: String,
        reply_tx: std::sync::mpsc::SyncSender<(u32, bool)>,
    },
    Shutdown,
}

#[derive(Debug, Clone)]
pub(crate) enum PcmOutcome {
    Event(AudioEvent),
    Fallback { generation: u64, reason: String },
}

pub(crate) struct PcmPlayerHandle {
    pub cmd_tx: mpsc::UnboundedSender<PcmPlayerCmd>,
}

pub(crate) fn spawn_pcm_player(
    http: reqwest::Client,
    shared_dsp: SharedDspState,
    playback_rms_bits: Arc<AtomicU32>,
    out_tx: mpsc::UnboundedSender<PcmOutcome>,
    ui_tx: mpsc::UnboundedSender<DspUiEvent>,
) -> PcmPlayerHandle {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    let loop_cmd_tx = cmd_tx.clone();
    std::thread::Builder::new()
        .name("bs-pcm-dsp-audio".to_string())
        .spawn(move || {
            run_pcm_loop(
                http,
                shared_dsp,
                playback_rms_bits,
                loop_cmd_tx,
                cmd_rx,
                out_tx,
                ui_tx,
            );
        })
        .expect("spawn pcm player thread");
    PcmPlayerHandle { cmd_tx }
}

struct SharedStreamState {
    data: Vec<u8>,
    total_len: Option<u64>,
    finished: bool,
    failed: Option<String>,
    cancelled: bool,
    mime_ext: Option<String>,
}

struct SharedMediaBuf {
    inner: Mutex<SharedStreamState>,
    cv: Condvar,
}

impl SharedMediaBuf {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(SharedStreamState {
                data: Vec::with_capacity(256 * 1024),
                total_len: None,
                finished: false,
                failed: None,
                cancelled: false,
                mime_ext: None,
            }),
            cv: Condvar::new(),
        })
    }

    fn cancel(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.cancelled = true;
            self.cv.notify_all();
        }
    }

    fn wait_initial(&self, min_bytes: usize) -> Result<Option<String>, String> {
        let mut g = self.inner.lock().unwrap();
        while !g.cancelled && g.failed.is_none() && !g.finished && g.data.len() < min_bytes {
            g = self.cv.wait(g).unwrap();
        }
        if g.cancelled {
            return Err("cancelled".to_string());
        }
        if let Some(ref err) = g.failed {
            return Err(err.clone());
        }
        Ok(g.mime_ext.clone())
    }
}

struct HttpMediaSource {
    buf: Arc<SharedMediaBuf>,
    pos: u64,
}

impl Read for HttpMediaSource {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let mut g = self.buf.inner.lock().unwrap();
        loop {
            if g.cancelled {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
            }
            if let Some(ref e) = g.failed {
                return Err(io::Error::other(e.clone()));
            }
            let pos = self.pos as usize;
            if pos < g.data.len() {
                let n = (g.data.len() - pos).min(out.len());
                out[..n].copy_from_slice(&g.data[pos..pos + n]);
                self.pos += n as u64;
                return Ok(n);
            }
            if g.finished {
                return Ok(0);
            }
            g = self.buf.cv.wait(g).unwrap();
        }
    }
}

impl Seek for HttpMediaSource {
    fn seek(&mut self, style: SeekFrom) -> io::Result<u64> {
        let mut g = self.buf.inner.lock().unwrap();
        let target: i64 = match style {
            SeekFrom::Start(p) => p as i64,
            SeekFrom::Current(d) => self.pos as i64 + d,
            SeekFrom::End(d) => {
                // Wait for download completion if total_len unknown
                while !g.finished && g.total_len.is_none() && !g.cancelled && g.failed.is_none() {
                    g = self.buf.cv.wait(g).unwrap();
                }
                if g.cancelled {
                    return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
                }
                let end = g.total_len.unwrap_or(g.data.len() as u64) as i64;
                end + d
            }
        };
        if target < 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "negative seek position",
            ));
        }
        let target_u = target as u64;
        // Wait if seeking ahead of what's downloaded so far (e.g. MP4 moov atom at end)
        while (target_u as usize) > g.data.len() && !g.finished && !g.cancelled && g.failed.is_none()
        {
            g = self.buf.cv.wait(g).unwrap();
        }
        if g.cancelled {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        self.pos = target_u.min(g.data.len() as u64);
        Ok(self.pos)
    }
}

impl MediaSource for HttpMediaSource {
    fn is_seekable(&self) -> bool {
        let g = self.buf.inner.lock().unwrap();
        g.finished || g.total_len.is_some()
    }

    fn byte_len(&self) -> Option<u64> {
        let g = self.buf.inner.lock().unwrap();
        if g.finished {
            Some(g.data.len() as u64)
        } else {
            g.total_len
        }
    }
}

struct SharedOutputState {
    dsp: Option<DspProcessor>,
    ring_f32: Arc<SpscRing<f32>>,
    feed: Arc<ExclusiveFeed>,
    out_sr: AtomicU32,
}

enum ActiveOutput {
    None,
    Shared {
        _stream: cpal::Stream,
        sr: u32,
        device_name: String,
    },
    Exclusive(WasapiExclusiveStream),
}

impl ActiveOutput {
    fn is_exclusive(&self) -> bool {
        matches!(self, Self::Exclusive(_))
    }

    fn is_none(&self) -> bool {
        matches!(self, Self::None)
    }

    fn device_name(&self) -> Option<&str> {
        match self {
            Self::None => None,
            Self::Shared { device_name, .. } => Some(device_name.as_str()),
            Self::Exclusive(s) => Some(s.info.device_name.as_str()),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_pcm_loop(
    http: reqwest::Client,
    shared_dsp: SharedDspState,
    playback_rms_bits: Arc<AtomicU32>,
    loop_cmd_tx: mpsc::UnboundedSender<PcmPlayerCmd>,
    mut cmd_rx: mpsc::UnboundedReceiver<PcmPlayerCmd>,
    out_tx: mpsc::UnboundedSender<PcmOutcome>,
    ui_tx: mpsc::UnboundedSender<DspUiEvent>,
) {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("pcm async runtime");

    let ring_f32 = Arc::new(SpscRing::<f32>::new(131_072)); // ~1.36s @ 48kHz stereo
    let ring_i32 = Arc::new(SpscRing::<i32>::new(131_072));
    let feed = Arc::new(ExclusiveFeed {
        ring: Arc::clone(&ring_i32),
        playing: AtomicBool::new(false),
        muted: AtomicBool::new(false),
        lock_volume: AtomicBool::new(true),
        volume_bits: AtomicU64::new(0.85_f64.to_bits()),
        played_frames: AtomicU64::new(0),
        playback_rms_bits: Arc::clone(&playback_rms_bits),
    });

    let output_state = Arc::new(Mutex::new(SharedOutputState {
        dsp: None,
        ring_f32: Arc::clone(&ring_f32),
        feed: Arc::clone(&feed),
        out_sr: AtomicU32::new(48_000),
    }));

    let mut active_output = ActiveOutput::None;
    let mut active_gen: u64 = 0;
    let mut active_duration: f64 = 0.0;
    let mut active_url = String::new();
    let mut active_track_spec: Option<(u32, Option<u32>, String)> = None;
    let mut active_buf: Option<Arc<SharedMediaBuf>> = None;
    let mut active_dl_task: Option<tokio::task::JoinHandle<()>> = None;
    let mut active_decode_seek: Option<mpsc::UnboundedSender<f64>> = None;
    let mut active_decode_stop: Option<Arc<AtomicBool>> = None;
    let mut last_output_name: Option<String> = None;

    let mut bp_enabled = false;
    let mut bp_device: Option<String> = None;
    let mut bp_lock_vol = true;

    let open_shared_stream =
        |out_slot: &mut ActiveOutput,
         out_state: &Arc<Mutex<SharedOutputState>>,
         last_dev: &mut Option<String>,
         preferred_dev: Option<&str>|
         -> Result<(u32, String), String> {
            let host = cpal::default_host();
            let dev = if let Some(target) = preferred_dev {
                host.output_devices()
                    .ok()
                    .and_then(|mut it| it.find(|d| d.name().ok().as_deref() == Some(target)))
                    .or_else(|| host.default_output_device())
            } else {
                host.default_output_device()
            }
            .ok_or_else(|| "Không có thiết bị phát âm thanh Windows".to_string())?;
            let dev_name = dev.name().unwrap_or_else(|_| "Default Output".to_string());
            let device_changed = last_dev.as_deref() != Some(dev_name.as_str());
            if device_changed {
                *last_dev = Some(dev_name.clone());
                let _ = ui_tx.send(DspUiEvent::OutputDeviceChanged(dev_name.clone()));
            }
            if let ActiveOutput::Shared { sr, device_name, .. } = out_slot {
                if device_name == &dev_name {
                    return Ok((*sr, device_name.clone()));
                }
            }
            *out_slot = ActiveOutput::None;

            let supported = dev
                .default_output_config()
                .map_err(|e| format!("Lỗi cấu hình thiết bị phát: {e}"))?;
            let sr = supported.sample_rate().0;
            let ch = supported.channels() as usize;
            let fmt = supported.sample_format();
            let cfg: StreamConfig = supported.into();

            {
                let mut g = out_state.lock().unwrap();
                g.out_sr.store(sr, Ordering::Relaxed);
                match g.dsp.as_mut() {
                    Some(d) => d.set_sample_rate(sr as f64),
                    None => g.dsp = Some(DspProcessor::new(sr as f64, shared_dsp.clone())),
                }
            }

            let state_cb = Arc::clone(out_state);
            let err_fn = |e| tracing::warn!("WASAPI output error: {e}");
            let stream = match fmt {
                SampleFormat::F32 => dev
                    .build_output_stream(
                        &cfg,
                        move |data: &mut [f32], _| {
                            render_callback_f32(&state_cb, data, ch);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Lỗi build output stream: {e}"))?,
                SampleFormat::I16 => dev
                    .build_output_stream(
                        &cfg,
                        move |data: &mut [i16], _| {
                            let mut tmp = [0.0_f32; 4096];
                            for chunk in data.chunks_mut(4096) {
                                let slice = &mut tmp[..chunk.len()];
                                render_callback_f32(&state_cb, slice, ch);
                                for (dst, &src) in chunk.iter_mut().zip(slice.iter()) {
                                    *dst = Sample::from_sample(src);
                                }
                            }
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Lỗi build output stream i16: {e}"))?,
                _ => {
                    return Err("Định dạng WASAPI output chưa hỗ trợ".to_string());
                }
            };
            stream
                .play()
                .map_err(|e| format!("Không chạy được stream âm thanh: {e}"))?;
            *out_slot = ActiveOutput::Shared {
                _stream: stream,
                sr,
                device_name: dev_name.clone(),
            };
            Ok((sr, dev_name))
        };

    let open_output_for_spec = |out_slot: &mut ActiveOutput,
                                out_state: &Arc<Mutex<SharedOutputState>>,
                                last_dev: &mut Option<String>,
                                bp_on: bool,
                                bp_dev: Option<&str>,
                                bp_lock: bool,
                                in_sr: u32,
                                src_bits: Option<u32>,
                                codec_label: &str|
     -> Result<(u32, bool), String> {
        // Release previous exclusive/shared output before acquiring the next one
        *out_slot = ActiveOutput::None;

        if bp_on {
            feed.lock_volume.store(bp_lock, Ordering::Relaxed);
            match WasapiExclusiveStream::open(bp_dev, in_sr, src_bits, Arc::clone(&feed)) {
                Ok(ex) => {
                    let info = ex.info.clone();
                    {
                        let g = out_state.lock().unwrap();
                        g.out_sr.store(info.sample_rate, Ordering::Relaxed);
                    }
                    *last_dev = Some(info.device_name.clone());
                    let _ = ui_tx.send(DspUiEvent::OutputDeviceChanged(info.device_name.clone()));
                    let _ = ui_tx.send(DspUiEvent::SignalPath(SignalPathInfo {
                        codec_label: codec_label.to_string(),
                        source_sample_rate: in_sr,
                        source_bits: src_bits,
                        output_sample_rate: info.sample_rate,
                        output_format: info.wire_format.label().to_string(),
                        exclusive: true,
                        bit_exact: !info.resampled && bp_lock,
                        resampled: info.resampled,
                        software_volume_locked: bp_lock,
                        device_name: info.device_name,
                        fallback_note: None,
                    }));
                    *out_slot = ActiveOutput::Exclusive(ex);
                    return Ok((info.sample_rate, true));
                }
                Err(reason) => {
                    tracing::warn!("WASAPI Exclusive unavailable ({reason}); falling back to Shared");
                    let (sr, dev_name) =
                        open_shared_stream(out_slot, out_state, last_dev, bp_dev)?;
                    let _ = ui_tx.send(DspUiEvent::SignalPath(SignalPathInfo {
                        codec_label: codec_label.to_string(),
                        source_sample_rate: in_sr,
                        source_bits: src_bits,
                        output_sample_rate: sr,
                        output_format: "64-bit DSP · WASAPI Shared".to_string(),
                        exclusive: false,
                        bit_exact: false,
                        resampled: in_sr != sr,
                        software_volume_locked: false,
                        device_name: dev_name,
                        fallback_note: Some(reason),
                    }));
                    return Ok((sr, false));
                }
            }
        }

        let (sr, dev_name) = open_shared_stream(out_slot, out_state, last_dev, None)?;
        let _ = ui_tx.send(DspUiEvent::SignalPath(SignalPathInfo {
            codec_label: codec_label.to_string(),
            source_sample_rate: in_sr,
            source_bits: src_bits,
            output_sample_rate: sr,
            output_format: "64-bit DSP · WASAPI Shared".to_string(),
            exclusive: false,
            bit_exact: false,
            resampled: in_sr != sr,
            software_volume_locked: false,
            device_name: dev_name,
            fallback_note: None,
        }));
        Ok((sr, false))
    };

    // Initial device announcement
    let _ = open_shared_stream(&mut active_output, &output_state, &mut last_output_name, None);

    let mut last_fft_tick = Instant::now();
    let mut last_pos_tick = Instant::now();
    let mut last_dev_poll = Instant::now();

    loop {
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                PcmPlayerCmd::Shutdown => {
                    if let Some(s) = active_decode_stop.take() {
                        s.store(true, Ordering::SeqCst);
                    }
                    if let Some(b) = active_buf.take() {
                        b.cancel();
                    }
                    if let Some(h) = active_dl_task.take() {
                        h.abort();
                    }
                    drop(active_output);
                    return;
                }
                PcmPlayerCmd::Stop => {
                    if let Some(s) = active_decode_stop.take() {
                        s.store(true, Ordering::SeqCst);
                    }
                    if let Some(b) = active_buf.take() {
                        b.cancel();
                    }
                    if let Some(h) = active_dl_task.take() {
                        h.abort();
                    }
                    active_decode_seek = None;
                    active_track_spec = None;
                    feed.playing.store(false, Ordering::SeqCst);
                    ring_f32.clear();
                    ring_i32.clear();
                    feed.played_frames.store(0, Ordering::SeqCst);
                    if active_output.is_exclusive() {
                        active_output = ActiveOutput::None;
                    }
                }
                PcmPlayerCmd::Play => {
                    if active_output.is_none() {
                        if let Some((sr, bits, ref label)) = active_track_spec {
                            let _ = open_output_for_spec(
                                &mut active_output,
                                &output_state,
                                &mut last_output_name,
                                bp_enabled,
                                bp_device.as_deref(),
                                bp_lock_vol,
                                sr,
                                bits,
                                label,
                            );
                        } else {
                            let _ = open_shared_stream(
                                &mut active_output,
                                &output_state,
                                &mut last_output_name,
                                None,
                            );
                        }
                    }
                    feed.playing.store(true, Ordering::SeqCst);
                    let _ = out_tx.send(PcmOutcome::Event(AudioEvent::StateChanged {
                        generation: active_gen,
                        playing: true,
                        buffering: false,
                    }));
                }
                PcmPlayerCmd::Pause => {
                    feed.playing.store(false, Ordering::SeqCst);
                    // Release exclusive hardware handle on pause so other Windows apps can use it
                    if active_output.is_exclusive() {
                        active_output = ActiveOutput::None;
                    }
                    let _ = out_tx.send(PcmOutcome::Event(AudioEvent::StateChanged {
                        generation: active_gen,
                        playing: false,
                        buffering: false,
                    }));
                }
                PcmPlayerCmd::SetVolume(v) => {
                    feed.volume_bits
                        .store(v.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
                }
                PcmPlayerCmd::SetMuted(m) => {
                    feed.muted.store(m, Ordering::Relaxed);
                }
                PcmPlayerCmd::Seek(secs) => {
                    if let Some(ref stx) = active_decode_seek {
                        let _ = stx.send(secs.max(0.0));
                    }
                }
                PcmPlayerCmd::SetBitPerfect {
                    enabled,
                    device,
                    lock_volume,
                } => {
                    let mode_changed = bp_enabled != enabled || bp_device != device;
                    let lock_changed = bp_lock_vol != lock_volume;
                    bp_enabled = enabled;
                    bp_device = device;
                    bp_lock_vol = lock_volume;
                    feed.lock_volume.store(lock_volume, Ordering::Relaxed);

                    if mode_changed && active_gen > 0 {
                        if let Some(ref buf) = active_buf {
                            let sr_prev = output_state
                                .lock()
                                .unwrap()
                                .out_sr
                                .load(Ordering::Relaxed)
                                .max(1) as f64;
                            let resume_pos = feed.played_frames.load(Ordering::Relaxed) as f64 / sr_prev;
                            let was_playing = feed.playing.load(Ordering::Acquire);

                            if let Some(s) = active_decode_stop.take() {
                                s.store(true, Ordering::SeqCst);
                            }
                            feed.playing.store(false, Ordering::SeqCst);
                            active_output = ActiveOutput::None;
                            ring_f32.clear();
                            ring_i32.clear();

                            let stop_flag = Arc::new(AtomicBool::new(false));
                            active_decode_stop = Some(Arc::clone(&stop_flag));
                            let (seek_tx, seek_rx) = mpsc::unbounded_channel();
                            active_decode_seek = Some(seek_tx);

                            let out_tx_d = out_tx.clone();
                            let cmd_tx_d = loop_cmd_tx.clone();
                            let ring_f_d = Arc::clone(&ring_f32);
                            let ring_i_d = Arc::clone(&ring_i32);
                            let out_state_d = Arc::clone(&output_state);
                            let stop_d = Arc::clone(&stop_flag);
                            let buf_d = Arc::clone(buf);
                            let url_d = active_url.clone();
                            let gen_d = active_gen;

                            std::thread::Builder::new()
                                .name(format!("bs-decode-switch-{gen_d}"))
                                .spawn(move || {
                                    decode_track_loop(
                                        gen_d,
                                        &url_d,
                                        buf_d,
                                        resume_pos,
                                        was_playing,
                                        cmd_tx_d,
                                        ring_f_d,
                                        ring_i_d,
                                        out_state_d,
                                        stop_d,
                                        seek_rx,
                                        out_tx_d,
                                    );
                                })
                                .ok();
                        }
                    } else if lock_changed {
                        if let ActiveOutput::Exclusive(ref ex) = active_output {
                            if let Some((sr, bits, ref label)) = active_track_spec {
                                let info = &ex.info;
                                let _ = ui_tx.send(DspUiEvent::SignalPath(SignalPathInfo {
                                    codec_label: label.clone(),
                                    source_sample_rate: sr,
                                    source_bits: bits,
                                    output_sample_rate: info.sample_rate,
                                    output_format: info.wire_format.label().to_string(),
                                    exclusive: true,
                                    bit_exact: !info.resampled && bp_lock_vol,
                                    resampled: info.resampled,
                                    software_volume_locked: bp_lock_vol,
                                    device_name: info.device_name.clone(),
                                    fallback_note: None,
                                }));
                            }
                        }
                    }
                }
                PcmPlayerCmd::PrepareOutput {
                    generation,
                    in_sr,
                    src_bits,
                    codec_label,
                    reply_tx,
                } => {
                    if generation != active_gen {
                        continue;
                    }
                    active_track_spec = Some((in_sr, src_bits, codec_label.clone()));
                    match open_output_for_spec(
                        &mut active_output,
                        &output_state,
                        &mut last_output_name,
                        bp_enabled,
                        bp_device.as_deref(),
                        bp_lock_vol,
                        in_sr,
                        src_bits,
                        &codec_label,
                    ) {
                        Ok(res) => {
                            let _ = reply_tx.send(res);
                        }
                        Err(err) => {
                            let _ = out_tx.send(PcmOutcome::Fallback {
                                generation,
                                reason: err,
                            });
                        }
                    }
                }
                PcmPlayerCmd::Load { generation, url } => {
                    if let Some(s) = active_decode_stop.take() {
                        s.store(true, Ordering::SeqCst);
                    }
                    if let Some(b) = active_buf.take() {
                        b.cancel();
                    }
                    if let Some(h) = active_dl_task.take() {
                        h.abort();
                    }

                    active_gen = generation;
                    active_duration = 0.0;
                    active_url = url.clone();
                    active_track_spec = None;

                    feed.playing.store(false, Ordering::SeqCst);
                    ring_f32.clear();
                    ring_i32.clear();
                    feed.played_frames.store(0, Ordering::SeqCst);

                    let buf = SharedMediaBuf::new();
                    let stop_flag = Arc::new(AtomicBool::new(false));
                    active_buf = Some(Arc::clone(&buf));
                    active_decode_stop = Some(Arc::clone(&stop_flag));

                    // Spawn async HTTP downloader
                    let http_c = http.clone();
                    let buf_dl = Arc::clone(&buf);
                    let url_c = url.clone();
                    active_dl_task = Some(rt.spawn(async move {
                        download_to_buffer(http_c, url_c, buf_dl).await;
                    }));

                    // Spawn decoder thread (probes source sample rate/bits before acquiring Exclusive/Shared stream)
                    let (seek_tx, seek_rx) = mpsc::unbounded_channel();
                    active_decode_seek = Some(seek_tx);

                    let out_tx_d = out_tx.clone();
                    let cmd_tx_d = loop_cmd_tx.clone();
                    let ring_f_d = Arc::clone(&ring_f32);
                    let ring_i_d = Arc::clone(&ring_i32);
                    let out_state_d = Arc::clone(&output_state);
                    let stop_d = Arc::clone(&stop_flag);

                    std::thread::Builder::new()
                        .name(format!("bs-decode-{generation}"))
                        .spawn(move || {
                            decode_track_loop(
                                generation,
                                &url,
                                buf,
                                0.0,
                                true,
                                cmd_tx_d,
                                ring_f_d,
                                ring_i_d,
                                out_state_d,
                                stop_d,
                                seek_rx,
                                out_tx_d,
                            );
                        })
                        .ok();
                }
            }
        }

        // Poll FFT & RMS telemetry (~25 Hz while playing)
        if last_fft_tick.elapsed() >= Duration::from_millis(40) {
            last_fft_tick = Instant::now();
            if active_output.is_exclusive() {
                if feed.playing.load(Ordering::Relaxed) {
                    let _ = ui_tx.send(DspUiEvent::Spectrum([0.0; 24]));
                }
            } else {
                let mut g = output_state.lock().unwrap();
                let is_playing = g.feed.playing.load(Ordering::Relaxed);
                let muted = g.feed.muted.load(Ordering::Relaxed);
                let vol = if muted {
                    0.0_f32
                } else {
                    f64::from_bits(g.feed.volume_bits.load(Ordering::Relaxed)) as f32
                };
                if let Some(ref mut dsp) = g.dsp {
                    let (bars, rms) = dsp.sample_telemetry();
                    let scaled_rms = if is_playing && vol > 0.005 {
                        rms + 20.0 * vol.log10()
                    } else {
                        -90.0
                    };
                    playback_rms_bits.store(scaled_rms.to_bits(), Ordering::Relaxed);
                    if is_playing {
                        let _ = ui_tx.send(DspUiEvent::Spectrum(bars));
                    }
                }
            }
        }

        // Position tick (~250 ms)
        if last_pos_tick.elapsed() >= Duration::from_millis(250) {
            last_pos_tick = Instant::now();
            let g = output_state.lock().unwrap();
            if active_gen > 0 && g.feed.playing.load(Ordering::Relaxed) {
                let sr = g.out_sr.load(Ordering::Relaxed).max(1) as f64;
                let frames = g.feed.played_frames.load(Ordering::Relaxed);
                let pos = frames as f64 / sr;
                let _ = out_tx.send(PcmOutcome::Event(AudioEvent::Position {
                    generation: active_gen,
                    current: pos,
                    duration: active_duration,
                }));
            }
        }

        // Device hot-plug polling (~2s) for Shared output mode
        if last_dev_poll.elapsed() >= Duration::from_secs(2) {
            last_dev_poll = Instant::now();
            if matches!(active_output, ActiveOutput::Shared { .. }) {
                if let Some(dev) = cpal::default_host().default_output_device() {
                    if let Ok(name) = dev.name() {
                        if active_output.device_name() != Some(name.as_str()) {
                            let was_playing = feed.playing.load(Ordering::Relaxed);
                            let _ = open_shared_stream(
                                &mut active_output,
                                &output_state,
                                &mut last_output_name,
                                None,
                            );
                            if was_playing {
                                feed.playing.store(true, Ordering::Relaxed);
                            }
                        }
                    }
                }
            }
        }

        std::thread::sleep(Duration::from_millis(12));
    }
}

fn render_callback_f32(state_cb: &Arc<Mutex<SharedOutputState>>, data: &mut [f32], channels: usize) {
    let ch = channels.max(1);
    let frames = data.len() / ch;
    let Ok(mut g) = state_cb.try_lock() else {
        data.fill(0.0);
        return;
    };

    if !g.feed.playing.load(Ordering::Relaxed) {
        data.fill(0.0);
        return;
    }

    let mut stereo_buf = [0.0_f32; 4096];
    let needed = (frames * 2).min(stereo_buf.len());
    let popped = g.ring_f32.pop_slice(&mut stereo_buf[..needed]);
    if popped == 0 {
        data.fill(0.0);
        return;
    }
    let valid_frames = popped / 2;

    if let Some(ref mut dsp) = g.dsp {
        dsp.process_interleaved(&mut stereo_buf[..needed]);
    }

    let muted = g.feed.muted.load(Ordering::Relaxed);
    let vol = if muted {
        0.0_f32
    } else {
        f64::from_bits(g.feed.volume_bits.load(Ordering::Relaxed)) as f32
    };

    for f in 0..frames {
        let l = stereo_buf[f * 2] * vol;
        let r = stereo_buf[f * 2 + 1] * vol;
        let base = f * ch;
        if ch == 1 {
            data[base] = (l + r) * 0.5;
        } else {
            data[base] = l;
            data[base + 1] = r;
            for c in 2..ch {
                data[base + c] = 0.0;
            }
        }
    }

    g.feed
        .played_frames
        .fetch_add(valid_frames as u64, Ordering::Relaxed);
}

async fn download_to_buffer(http: reqwest::Client, url: String, buf: Arc<SharedMediaBuf>) {
    let resp = match http.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            let mut g = buf.inner.lock().unwrap();
            g.failed = Some(format!("Lỗi kết nối stream: {e}"));
            buf.cv.notify_all();
            return;
        }
    };

    if !resp.status().is_success() {
        let code = resp.status();
        let mut g = buf.inner.lock().unwrap();
        g.failed = Some(format!("HTTP {code}"));
        buf.cv.notify_all();
        return;
    }

    let mime_ext = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(ext_from_content_type);
    let total_len = resp.content_length();

    {
        let mut g = buf.inner.lock().unwrap();
        g.total_len = total_len;
        g.mime_ext = mime_ext;
    }

    let mut resp = resp;
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                let mut g = buf.inner.lock().unwrap();
                if g.cancelled {
                    buf.cv.notify_all();
                    return;
                }
                g.data.extend_from_slice(&chunk);
                buf.cv.notify_all();
            }
            Ok(None) => {
                let mut g = buf.inner.lock().unwrap();
                g.finished = true;
                buf.cv.notify_all();
                return;
            }
            Err(e) => {
                let mut g = buf.inner.lock().unwrap();
                g.failed = Some(format!("Đứt kết nối tải nhạc: {e}"));
                buf.cv.notify_all();
                return;
            }
        }
    }
}

fn ext_from_content_type(ct: &str) -> Option<String> {
    let lower = ct.to_ascii_lowercase();
    if lower.contains("mpeg") || lower.contains("mp3") {
        Some("mp3".to_string())
    } else if lower.contains("mp4") || lower.contains("aac") || lower.contains("m4a") {
        Some("m4a".to_string())
    } else if lower.contains("flac") {
        Some("flac".to_string())
    } else if lower.contains("ogg") || lower.contains("vorbis") {
        Some("ogg".to_string())
    } else if lower.contains("wav") {
        Some("wav".to_string())
    } else if lower.contains("webm") || lower.contains("mpegurl") || lower.contains("hls") {
        Some("unsupported".to_string())
    } else {
        None
    }
}

fn codec_label_from(codec: CodecType, mime_ext: Option<&str>) -> String {
    match codec {
        CODEC_TYPE_FLAC => "FLAC".to_string(),
        CODEC_TYPE_ALAC => "ALAC".to_string(),
        CODEC_TYPE_MP3 => "MP3".to_string(),
        CODEC_TYPE_AAC => "AAC".to_string(),
        CODEC_TYPE_VORBIS => "Vorbis".to_string(),
        CODEC_TYPE_OPUS => "Opus".to_string(),
        CODEC_TYPE_PCM_S16LE
        | CODEC_TYPE_PCM_S16BE
        | CODEC_TYPE_PCM_S24LE
        | CODEC_TYPE_PCM_S24BE
        | CODEC_TYPE_PCM_S32LE
        | CODEC_TYPE_PCM_S32BE
        | CODEC_TYPE_PCM_U8
        | CODEC_TYPE_PCM_F32LE
        | CODEC_TYPE_PCM_F32BE
        | CODEC_TYPE_PCM_F64LE
        | CODEC_TYPE_PCM_F64BE
        | CODEC_TYPE_PCM_ALAW
        | CODEC_TYPE_PCM_MULAW => "WAV/PCM".to_string(),
        _ => match mime_ext {
            Some("flac") => "FLAC".to_string(),
            Some("m4a") => "AAC/M4A".to_string(),
            Some("mp3") => "MP3".to_string(),
            Some("ogg") => "Ogg".to_string(),
            Some("wav") => "WAV".to_string(),
            _ => "Audio".to_string(),
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn decode_track_loop(
    generation: u64,
    url: &str,
    buf: Arc<SharedMediaBuf>,
    initial_seek_secs: f64,
    auto_play: bool,
    cmd_tx: mpsc::UnboundedSender<PcmPlayerCmd>,
    ring_f32: Arc<SpscRing<f32>>,
    ring_i32: Arc<SpscRing<i32>>,
    out_state: Arc<Mutex<SharedOutputState>>,
    stop_flag: Arc<AtomicBool>,
    mut seek_rx: mpsc::UnboundedReceiver<f64>,
    out_tx: mpsc::UnboundedSender<PcmOutcome>,
) {
    let mime_ext = match buf.wait_initial(48 * 1024) {
        Ok(ext) => ext,
        Err(reason) => {
            if reason != "cancelled" {
                let _ = out_tx.send(PcmOutcome::Fallback { generation, reason });
            }
            return;
        }
    };

    if mime_ext.as_deref() == Some("unsupported") || url.contains(".m3u8") {
        let _ = out_tx.send(PcmOutcome::Fallback {
            generation,
            reason: "Định dạng stream (HLS/WebM) chuyển sang WinRT".to_string(),
        });
        return;
    }

    let mut hint = Hint::new();
    if let Some(ref ext) = mime_ext {
        hint.with_extension(ext);
    }

    let src = Box::new(HttpMediaSource {
        buf: Arc::clone(&buf),
        pos: 0,
    }) as Box<dyn MediaSource>;
    let mss = MediaSourceStream::new(src, Default::default());

    let probed = match symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions {
            enable_gapless: true,
            ..Default::default()
        },
        &MetadataOptions::default(),
    ) {
        Ok(p) => p,
        Err(e) => {
            if !stop_flag.load(Ordering::Relaxed) {
                let _ = out_tx.send(PcmOutcome::Fallback {
                    generation,
                    reason: format!("Symphonia probe: {e}"),
                });
            }
            return;
        }
    };

    let mut format = probed.format;
    let Some(track) = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
    else {
        let _ = out_tx.send(PcmOutcome::Fallback {
            generation,
            reason: "Không tìm thấy audio track hợp lệ".to_string(),
        });
        return;
    };

    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let in_sr = codec_params.sample_rate.unwrap_or(44_100);
    let src_bits = codec_params.bits_per_sample;
    let codec_label = codec_label_from(codec_params.codec, mime_ext.as_deref());
    let duration_secs = codec_params
        .n_frames
        .zip(codec_params.time_base)
        .map(|(n, tb)| tb.calc_time(n))
        .map(|t| t.seconds as f64 + t.frac)
        .unwrap_or(0.0);

    let mut decoder = match symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
    {
        Ok(d) => d,
        Err(e) => {
            let _ = out_tx.send(PcmOutcome::Fallback {
                generation,
                reason: format!("Codec không hỗ trợ ({e}) — dùng WinRT"),
            });
            return;
        }
    };

    // Ask pcm loop to configure WASAPI Exclusive (exact native SR) or Shared output
    let (reply_tx, reply_rx) = std::sync::mpsc::sync_channel::<(u32, bool)>(1);
    if cmd_tx
        .send(PcmPlayerCmd::PrepareOutput {
            generation,
            in_sr,
            src_bits,
            codec_label,
            reply_tx,
        })
        .is_err()
    {
        return;
    }

    let (target_sr, use_i32) = loop {
        if stop_flag.load(Ordering::Acquire) {
            return;
        }
        match reply_rx.recv_timeout(Duration::from_millis(40)) {
            Ok(pair) => break pair,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
        }
    };

    if initial_seek_secs > 0.05 {
        let secs_u = initial_seek_secs.trunc() as u64;
        let frac = initial_seek_secs.fract();
        let _ = format.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time: Time::new(secs_u, frac),
                track_id: Some(track_id),
            },
        );
        decoder.reset();
    }

    let start_frames = if initial_seek_secs > 0.05 {
        (initial_seek_secs * target_sr as f64).round() as u64
    } else {
        let _ = out_tx.send(PcmOutcome::Event(AudioEvent::Opened {
            generation,
            duration: duration_secs,
        }));
        0
    };

    {
        let mut g = out_state.lock().unwrap();
        g.feed.played_frames.store(start_frames, Ordering::SeqCst);
        g.feed.playing.store(auto_play, Ordering::SeqCst);
        if let Some(d) = g.dsp.as_mut() {
            d.reset_filters();
        }
    }
    let _ = out_tx.send(PcmOutcome::Event(AudioEvent::StateChanged {
        generation,
        playing: auto_play,
        buffering: false,
    }));

    let mut sample_buf_f32: Option<SampleBuffer<f32>> = None;
    let mut sample_buf_i32: Option<SampleBuffer<i32>> = None;
    let mut resampler = if in_sr != target_sr {
        FftFixedIn::<f32>::new(in_sr as usize, target_sr as usize, 1024, 2, 2).ok()
    } else {
        None
    };
    let mut resamp_in_l = Vec::<f32>::with_capacity(2048);
    let mut resamp_in_r = Vec::<f32>::with_capacity(2048);

    loop {
        if stop_flag.load(Ordering::Acquire) {
            return;
        }

        while let Ok(target_secs) = seek_rx.try_recv() {
            let secs_u = target_secs.max(0.0).trunc() as u64;
            let frac = target_secs.max(0.0).fract();
            if format
                .seek(
                    SeekMode::Accurate,
                    SeekTo::Time {
                        time: Time::new(secs_u, frac),
                        track_id: Some(track_id),
                    },
                )
                .is_ok()
            {
                decoder.reset();
                resamp_in_l.clear();
                resamp_in_r.clear();
                ring_f32.clear();
                ring_i32.clear();
                let frames_pos = (target_secs.max(0.0) * target_sr as f64).round() as u64;
                out_state
                    .lock()
                    .unwrap()
                    .feed
                    .played_frames
                    .store(frames_pos, Ordering::SeqCst);
            }
        }

        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(ref io_err))
                if io_err.kind() == io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(_) => break,
        };

        let spec = *decoded.spec();
        let ch_count = spec.channels.count().max(1);

        if use_i32 && resampler.is_none() {
            // Bit-exact integer PCM path: zero float conversion, zero resampling
            let sbuf = sample_buf_i32
                .get_or_insert_with(|| SampleBuffer::<i32>::new(decoded.capacity() as u64, spec));
            sbuf.copy_interleaved_ref(decoded);
            let raw = sbuf.samples();
            let mut stereo = Vec::with_capacity((raw.len() / ch_count) * 2);
            for frame in raw.chunks(ch_count) {
                let l = frame[0];
                let r = if ch_count > 1 { frame[1] } else { l };
                stereo.push(l);
                stereo.push(r);
            }
            push_with_backpressure(&ring_i32, &stereo, &stop_flag);
            continue;
        }

        let sbuf = sample_buf_f32
            .get_or_insert_with(|| SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
        sbuf.copy_interleaved_ref(decoded);
        let raw = sbuf.samples();

        if let Some(ref mut rs) = resampler {
            for frame in raw.chunks(ch_count) {
                let l = frame[0];
                let r = if ch_count > 1 { frame[1] } else { l };
                resamp_in_l.push(l);
                resamp_in_r.push(r);
            }
            let chunk_req = rs.input_frames_next();
            while resamp_in_l.len() >= chunk_req {
                if stop_flag.load(Ordering::Acquire) {
                    return;
                }
                let in_slice = [&resamp_in_l[..chunk_req], &resamp_in_r[..chunk_req]];
                if let Ok(out_vecs) = rs.process(&in_slice, None) {
                    if use_i32 {
                        let mut stereo = Vec::with_capacity(out_vecs[0].len() * 2);
                        for (&l, &r) in out_vecs[0].iter().zip(out_vecs[1].iter()) {
                            stereo.push((l.clamp(-1.0, 1.0) as f64 * 2_147_483_647.0).round() as i32);
                            stereo.push((r.clamp(-1.0, 1.0) as f64 * 2_147_483_647.0).round() as i32);
                        }
                        push_with_backpressure(&ring_i32, &stereo, &stop_flag);
                    } else {
                        let mut stereo = Vec::with_capacity(out_vecs[0].len() * 2);
                        for (&l, &r) in out_vecs[0].iter().zip(out_vecs[1].iter()) {
                            stereo.push(l);
                            stereo.push(r);
                        }
                        push_with_backpressure(&ring_f32, &stereo, &stop_flag);
                    }
                }
                resamp_in_l.drain(..chunk_req);
                resamp_in_r.drain(..chunk_req);
            }
        } else {
            let mut stereo = Vec::with_capacity((raw.len() / ch_count) * 2);
            for frame in raw.chunks(ch_count) {
                let l = frame[0];
                let r = if ch_count > 1 { frame[1] } else { l };
                stereo.push(l);
                stereo.push(r);
            }
            push_with_backpressure(&ring_f32, &stereo, &stop_flag);
        }
    }

    // Drain active ring buffer cleanly before reporting natural Ended
    let active_ring_len = || if use_i32 { ring_i32.len() } else { ring_f32.len() };
    while !stop_flag.load(Ordering::Acquire) && active_ring_len() > 256 {
        if let Ok(target_secs) = seek_rx.try_recv() {
            let secs_u = target_secs.max(0.0).trunc() as u64;
            let frac = target_secs.max(0.0).fract();
            if format
                .seek(
                    SeekMode::Accurate,
                    SeekTo::Time {
                        time: Time::new(secs_u, frac),
                        track_id: Some(track_id),
                    },
                )
                .is_ok()
            {
                decoder.reset();
                ring_f32.clear();
                ring_i32.clear();
                let frames_pos = (target_secs.max(0.0) * target_sr as f64).round() as u64;
                out_state
                    .lock()
                    .unwrap()
                    .feed
                    .played_frames
                    .store(frames_pos, Ordering::SeqCst);
                continue;
            }
        }
        std::thread::sleep(Duration::from_millis(25));
    }

    if !stop_flag.load(Ordering::Acquire) {
        let _ = out_tx.send(PcmOutcome::Event(AudioEvent::Ended { generation }));
    }
}

fn push_with_backpressure<T: Copy + Default>(
    ring: &Arc<SpscRing<T>>,
    mut slice: &[T],
    stop_flag: &AtomicBool,
) {
    while !slice.is_empty() && !stop_flag.load(Ordering::Acquire) {
        let pushed = ring.push_slice(slice);
        slice = &slice[pushed..];
        if !slice.is_empty() && ring.available_write() < 256 {
            std::thread::sleep(Duration::from_millis(12));
        }
    }
}
