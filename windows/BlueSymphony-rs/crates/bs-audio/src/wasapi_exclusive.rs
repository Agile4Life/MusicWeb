use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED, AUDCLNT_E_DEVICE_INVALIDATED, AUDCLNT_SHAREMODE_EXCLUSIVE,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, DEVICE_STATE_ACTIVE, IAudioClient, IAudioRenderClient,
    IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
    WAVEFORMATEXTENSIBLE_0, eConsole, eRender,
};
use windows::Win32::Media::KernelStreaming::KSDATAFORMAT_SUBTYPE_PCM;
use windows::Win32::System::Com::StructuredStorage::{
    PropVariantClear, PropVariantToStringAlloc,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize, STGM_READ,
};
use windows::Win32::System::Threading::{
    AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW, CreateEventW, SetEvent,
    WaitForSingleObject,
};
use windows::core::{GUID, HRESULT, w};

use crate::ring::SpscRing;

const RPC_E_CHANGED_MODE_HR: i32 = 0x8001_0106_u32 as i32;
const WAVE_FORMAT_EXTENSIBLE_TAG: u16 = 0xFFFE;
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT_GUID: GUID =
    GUID::from_u128(0x0000_0003_0000_0010_8000_00aa_0038_9b71);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireFormat {
    Pcm16,
    Pcm24Packed,
    Pcm24In32,
    Pcm32,
    Float32,
}

impl WireFormat {
    pub fn label(self) -> &'static str {
        match self {
            Self::Pcm16 => "16-bit PCM",
            Self::Pcm24Packed => "24-bit PCM",
            Self::Pcm24In32 => "24-in-32 PCM",
            Self::Pcm32 => "32-bit PCM",
            Self::Float32 => "32-bit Float",
        }
    }

    pub fn container_bits(self) -> u16 {
        match self {
            Self::Pcm16 => 16,
            Self::Pcm24Packed => 24,
            Self::Pcm24In32 | Self::Pcm32 | Self::Float32 => 32,
        }
    }

    pub fn valid_bits(self) -> u16 {
        match self {
            Self::Pcm16 => 16,
            Self::Pcm24Packed | Self::Pcm24In32 => 24,
            Self::Pcm32 | Self::Float32 => 32,
        }
    }

    pub fn bytes_per_sample(self) -> usize {
        (self.container_bits() / 8) as usize
    }

    pub fn is_float(self) -> bool {
        matches!(self, Self::Float32)
    }
}

#[derive(Debug, Clone)]
pub struct ExclusiveOpenInfo {
    pub sample_rate: u32,
    pub wire_format: WireFormat,
    pub channels: u16,
    pub device_name: String,
    pub resampled: bool,
}

pub struct ExclusiveFeed {
    pub ring: Arc<SpscRing<i32>>,
    pub playing: AtomicBool,
    pub muted: AtomicBool,
    pub lock_volume: AtomicBool,
    pub volume_bits: AtomicU64,
    pub played_frames: AtomicU64,
    pub playback_rms_bits: Arc<AtomicU32>,
}

struct SendEventHandle(HANDLE);
unsafe impl Send for SendEventHandle {}

pub struct WasapiExclusiveStream {
    pub info: ExclusiveOpenInfo,
    stop: Arc<AtomicBool>,
    wake_event: Arc<Mutex<Option<SendEventHandle>>>,
    thread: Option<JoinHandle<()>>,
}

impl WasapiExclusiveStream {
    pub fn open(
        preferred_device: Option<&str>,
        desired_sr: u32,
        source_bits: Option<u32>,
        feed: Arc<ExclusiveFeed>,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let wake_event: Arc<Mutex<Option<SendEventHandle>>> = Arc::new(Mutex::new(None));
        let (tx, rx) = std::sync::mpsc::sync_channel::<Result<ExclusiveOpenInfo, String>>(1);

        let dev_pref = preferred_device.map(str::to_string);
        let stop_t = Arc::clone(&stop);
        let evt_t = Arc::clone(&wake_event);

        let handle = std::thread::Builder::new()
            .name("bs-wasapi-exclusive".to_string())
            .spawn(move || {
                run_exclusive_thread(dev_pref.as_deref(), desired_sr, source_bits, feed, stop_t, evt_t, tx);
            })
            .map_err(|e| format!("Không tạo được luồng WASAPI Exclusive: {e}"))?;

        match rx.recv() {
            Ok(Ok(info)) => Ok(Self {
                info,
                stop,
                wake_event,
                thread: Some(handle),
            }),
            Ok(Err(err)) => {
                stop.store(true, Ordering::Release);
                let _ = handle.join();
                Err(err)
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                let _ = handle.join();
                Err("Luồng WASAPI Exclusive đóng bất ngờ khi khởi tạo".to_string())
            }
        }
    }
}

impl Drop for WasapiExclusiveStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Ok(g) = self.wake_event.lock() {
            if let Some(ref ev) = *g {
                unsafe {
                    let _ = SetEvent(ev.0);
                }
            }
        }
        if let Some(h) = self.thread.take() {
            let _ = h.join();
        }
    }
}

pub fn build_wave_format(sample_rate: u32, channels: u16, wire: WireFormat) -> WAVEFORMATEXTENSIBLE {
    let ch = channels.max(1);
    let container_bits = wire.container_bits();
    let block_align = ch * (container_bits / 8);
    let avg_bytes = sample_rate.saturating_mul(block_align as u32);
    let channel_mask = match ch {
        1 => 0x4,  // SPEAKER_FRONT_CENTER
        2 => 0x3,  // SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT
        _ => 0x3,
    };
    let sub_format = if wire.is_float() {
        KSDATAFORMAT_SUBTYPE_IEEE_FLOAT_GUID
    } else {
        KSDATAFORMAT_SUBTYPE_PCM
    };

    WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_EXTENSIBLE_TAG,
            nChannels: ch,
            nSamplesPerSec: sample_rate,
            nAvgBytesPerSec: avg_bytes,
            nBlockAlign: block_align,
            wBitsPerSample: container_bits,
            cbSize: (core::mem::size_of::<WAVEFORMATEXTENSIBLE>()
                - core::mem::size_of::<WAVEFORMATEX>()) as u16,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 {
            wValidBitsPerSample: wire.valid_bits(),
        },
        dwChannelMask: channel_mask,
        SubFormat: sub_format,
    }
}

/// Converts left-aligned signed 32-bit stereo samples (`[L0, R0, L1, R1, ...]`) directly into
/// WASAPI hardware wire format bytes. When `gain_q16` is `None` and `!muted`, samples are mapped
/// bit-for-bit identically without floating-point rounding or dithering.
pub fn pack_i32_stereo_to_wire(
    src_stereo: &[i32],
    dst_bytes: &mut [u8],
    wire: WireFormat,
    channels: usize,
    gain_q16: Option<i64>,
    muted: bool,
) {
    if muted {
        dst_bytes.fill(0);
        return;
    }

    let ch = channels.max(1);
    let bps = wire.bytes_per_sample();
    let frame_bytes = ch * bps;
    let frames = (src_stereo.len() / 2).min(dst_bytes.len() / frame_bytes);

    for f in 0..frames {
        let mut l = src_stereo[f * 2];
        let mut r = src_stereo[f * 2 + 1];
        if let Some(g) = gain_q16 {
            l = ((l as i64 * g) >> 16).clamp(i32::MIN as i64, i32::MAX as i64) as i32;
            r = ((r as i64 * g) >> 16).clamp(i32::MIN as i64, i32::MAX as i64) as i32;
        }
        let base = f * frame_bytes;
        if ch == 1 {
            let mono = (l / 2).saturating_add(r / 2);
            write_sample(&mut dst_bytes[base..base + bps], mono, wire);
        } else {
            write_sample(&mut dst_bytes[base..base + bps], l, wire);
            write_sample(&mut dst_bytes[base + bps..base + 2 * bps], r, wire);
            if ch > 2 {
                dst_bytes[base + 2 * bps..base + frame_bytes].fill(0);
            }
        }
    }
    let written = frames * frame_bytes;
    if written < dst_bytes.len() {
        dst_bytes[written..].fill(0);
    }
}

#[inline]
fn write_sample(dst: &mut [u8], s: i32, wire: WireFormat) {
    match wire {
        WireFormat::Pcm16 => {
            let v = (s >> 16) as i16;
            dst[..2].copy_from_slice(&v.to_le_bytes());
        }
        WireFormat::Pcm24Packed => {
            let b = s.to_le_bytes();
            dst[0] = b[1];
            dst[1] = b[2];
            dst[2] = b[3];
        }
        WireFormat::Pcm24In32 => {
            let masked = s & !0xFF_i32;
            dst[..4].copy_from_slice(&masked.to_le_bytes());
        }
        WireFormat::Pcm32 => {
            dst[..4].copy_from_slice(&s.to_le_bytes());
        }
        WireFormat::Float32 => {
            let f = (s as f64 / 2_147_483_648.0) as f32;
            dst[..4].copy_from_slice(&f.to_le_bytes());
        }
    }
}

fn candidate_formats(desired_sr: u32, source_bits: Option<u32>) -> Vec<(u32, WireFormat, bool)> {
    let primary_order: [WireFormat; 5] = match source_bits {
        Some(b) if b <= 16 => [
            WireFormat::Pcm16,
            WireFormat::Pcm24In32,
            WireFormat::Pcm24Packed,
            WireFormat::Pcm32,
            WireFormat::Float32,
        ],
        Some(b) if b <= 24 => [
            WireFormat::Pcm24In32,
            WireFormat::Pcm24Packed,
            WireFormat::Pcm32,
            WireFormat::Float32,
            WireFormat::Pcm16,
        ],
        _ => [
            WireFormat::Pcm32,
            WireFormat::Pcm24In32,
            WireFormat::Pcm24Packed,
            WireFormat::Float32,
            WireFormat::Pcm16,
        ],
    };

    let mut out = Vec::with_capacity(20);
    for &wf in &primary_order {
        out.push((desired_sr, wf, false));
    }
    let fallback_order = [
        WireFormat::Pcm24In32,
        WireFormat::Pcm16,
        WireFormat::Pcm32,
        WireFormat::Pcm24Packed,
        WireFormat::Float32,
    ];
    for sr in [48_000_u32, 44_100, 96_000] {
        if sr == desired_sr {
            continue;
        }
        for &wf in &fallback_order {
            out.push((sr, wf, true));
        }
    }
    out
}

struct ComGuard(bool);
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

fn friendly_name(dev: &IMMDevice) -> String {
    unsafe {
        let Ok(store) = dev.OpenPropertyStore(STGM_READ) else {
            return String::new();
        };
        let Ok(mut prop) = store.GetValue(&PKEY_Device_FriendlyName) else {
            return String::new();
        };
        let name = match PropVariantToStringAlloc(&prop) {
            Ok(pwstr) => {
                let s = pwstr.to_string().unwrap_or_default();
                CoTaskMemFree(Some(pwstr.0 as *const _));
                s
            }
            Err(_) => String::new(),
        };
        let _ = PropVariantClear(&mut prop);
        name
    }
}

fn resolve_render_device(
    enumerator: &IMMDeviceEnumerator,
    preferred: Option<&str>,
) -> Result<(IMMDevice, String), String> {
    unsafe {
        if let Some(target) = preferred {
            if let Ok(col) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                let count = col.GetCount().unwrap_or(0);
                for idx in 0..count {
                    if let Ok(dev) = col.Item(idx) {
                        let name = friendly_name(&dev);
                        if !name.is_empty() && name == target {
                            return Ok((dev, name));
                        }
                    }
                }
            }
        }

        let dev = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Không tìm thấy thiết bị phát Windows: {e}"))?;
        let mut name = friendly_name(&dev);
        if name.is_empty() {
            name = "Default Output".to_string();
        }
        Ok((dev, name))
    }
}

fn run_exclusive_thread(
    preferred_device: Option<&str>,
    desired_sr: u32,
    source_bits: Option<u32>,
    feed: Arc<ExclusiveFeed>,
    stop: Arc<AtomicBool>,
    wake_slot: Arc<Mutex<Option<SendEventHandle>>>,
    tx: std::sync::mpsc::SyncSender<Result<ExclusiveOpenInfo, String>>,
) {
    let init_hr: HRESULT = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let com_should_uninit = init_hr.is_ok();
    if init_hr.is_err() && init_hr.0 != RPC_E_CHANGED_MODE_HR {
        let _ = tx.send(Err(format!("COM init thất bại: {init_hr:?}")));
        return;
    }
    let _com_guard = ComGuard(com_should_uninit);

    let setup = (|| -> Result<
        (
            IAudioClient,
            IAudioRenderClient,
            HANDLE,
            u32,
            ExclusiveOpenInfo,
        ),
        String,
    > {
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|e| format!("MMDeviceEnumerator thất bại: {e}"))?;
        let (device, device_name) = resolve_render_device(&enumerator, preferred_device)?;

        let mut audio_client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
            .map_err(|e| format!("Không mở được IAudioClient cho {device_name}: {e}"))?;

        let candidates = candidate_formats(desired_sr, source_bits);
        let mut chosen: Option<(u32, WireFormat, bool, WAVEFORMATEXTENSIBLE)> = None;
        for (sr, wf_kind, resampled) in candidates {
            let wf = build_wave_format(sr, 2, wf_kind);
            let wf_ptr = (&wf as *const WAVEFORMATEXTENSIBLE).cast::<WAVEFORMATEX>();
            let hr = unsafe { audio_client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, wf_ptr, None) };
            if hr.0 == 0 {
                chosen = Some((sr, wf_kind, resampled, wf));
                break;
            }
        }

        let (chosen_sr, chosen_wire, resampled, wf) = chosen.ok_or_else(|| {
            format!("Thiết bị \"{device_name}\" không hỗ trợ WASAPI Exclusive cho {desired_sr} Hz")
        })?;
        let wf_ptr = (&wf as *const WAVEFORMATEXTENSIBLE).cast::<WAVEFORMATEX>();

        let mut default_period: i64 = 100_000;
        let mut min_period: i64 = 100_000;
        unsafe {
            let _ = audio_client.GetDevicePeriod(Some(&mut default_period), Some(&mut min_period));
        }
        let mut hns_period = default_period.max(100_000);

        let init_res = unsafe {
            audio_client.Initialize(
                AUDCLNT_SHAREMODE_EXCLUSIVE,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                hns_period,
                hns_period,
                wf_ptr,
                None,
            )
        };
        if let Err(e) = init_res {
            if e.code() == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED {
                let aligned_frames = unsafe { audio_client.GetBufferSize() }
                    .map_err(|err| format!("GetBufferSize thất bại: {err}"))?;
                hns_period = ((10_000_000.0 * aligned_frames as f64 / chosen_sr as f64) + 0.5) as i64;
                drop(audio_client);
                audio_client = unsafe { device.Activate(CLSCTX_ALL, None) }
                    .map_err(|err| format!("Re-activate IAudioClient thất bại: {err}"))?;
                unsafe {
                    audio_client.Initialize(
                        AUDCLNT_SHAREMODE_EXCLUSIVE,
                        AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                        hns_period,
                        hns_period,
                        wf_ptr,
                        None,
                    )
                }
                .map_err(|err| format!("WASAPI Exclusive bị từ chối hoặc đang bận: {err}"))?;
            } else {
                return Err(format!(
                    "Không chiếm quyền Exclusive trên \"{device_name}\" (đang bận hoặc bị tắt quyền Exclusive): {e}"
                ));
            }
        }

        let event = unsafe { CreateEventW(None, false, false, None) }
            .map_err(|e| format!("CreateEventW thất bại: {e}"))?;
        if let Err(e) = unsafe { audio_client.SetEventHandle(event) } {
            unsafe {
                let _ = CloseHandle(event);
            }
            return Err(format!("SetEventHandle thất bại: {e}"));
        }

        let buffer_frames = match unsafe { audio_client.GetBufferSize() } {
            Ok(n) if n > 0 => n,
            Ok(_) => {
                unsafe {
                    let _ = CloseHandle(event);
                }
                return Err("Buffer size WASAPI Exclusive bằng 0".to_string());
            }
            Err(e) => {
                unsafe {
                    let _ = CloseHandle(event);
                }
                return Err(format!("GetBufferSize thất bại: {e}"));
            }
        };

        let render_client: IAudioRenderClient = match unsafe { audio_client.GetService() } {
            Ok(rc) => rc,
            Err(e) => {
                unsafe {
                    let _ = CloseHandle(event);
                }
                return Err(format!("IAudioRenderClient thất bại: {e}"));
            }
        };

        // Pre-fill initial buffer with digital zero silence
        if let Ok(ptr) = unsafe { render_client.GetBuffer(buffer_frames) } {
            let total_bytes = buffer_frames as usize * wf.Format.nBlockAlign as usize;
            unsafe {
                std::ptr::write_bytes(ptr, 0, total_bytes);
                let _ = render_client.ReleaseBuffer(buffer_frames, 0);
            }
        }

        if let Err(e) = unsafe { audio_client.Start() } {
            unsafe {
                let _ = CloseHandle(event);
            }
            return Err(format!("Không Start được WASAPI Exclusive: {e}"));
        }

        Ok((
            audio_client,
            render_client,
            event,
            buffer_frames,
            ExclusiveOpenInfo {
                sample_rate: chosen_sr,
                wire_format: chosen_wire,
                channels: 2,
                device_name,
                resampled,
            },
        ))
    })();

    let (audio_client, render_client, event, buffer_frames, info) = match setup {
        Ok(ok) => ok,
        Err(e) => {
            let _ = tx.send(Err(e));
            return;
        }
    };

    if let Ok(mut g) = wake_slot.lock() {
        *g = Some(SendEventHandle(event));
    }

    let mut mmcss_task = 0u32;
    let mmcss_handle = unsafe { AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut mmcss_task) }.ok();

    let _ = tx.send(Ok(info.clone()));

    let ch = info.channels as usize;
    let frame_bytes = ch * info.wire_format.bytes_per_sample();
    let buf_bytes_len = buffer_frames as usize * frame_bytes;
    let mut stereo_scratch = vec![0_i32; buffer_frames as usize * 2];

    while !stop.load(Ordering::Acquire) {
        let wait = unsafe { WaitForSingleObject(event, 150) };
        if stop.load(Ordering::Acquire) {
            break;
        }
        if wait != WAIT_OBJECT_0 {
            continue;
        }

        let ptr = match unsafe { render_client.GetBuffer(buffer_frames) } {
            Ok(p) => p,
            Err(e) if e.code() == AUDCLNT_E_DEVICE_INVALIDATED => break,
            Err(_) => continue,
        };

        let dst_bytes = unsafe { std::slice::from_raw_parts_mut(ptr, buf_bytes_len) };

        if !feed.playing.load(Ordering::Acquire) {
            dst_bytes.fill(0);
            feed.playback_rms_bits.store((-90.0_f32).to_bits(), Ordering::Relaxed);
            let _ = unsafe { render_client.ReleaseBuffer(buffer_frames, 0) };
            continue;
        }

        let popped = feed.ring.pop_slice(&mut stereo_scratch);
        if popped == 0 {
            dst_bytes.fill(0);
            feed.playback_rms_bits.store((-90.0_f32).to_bits(), Ordering::Relaxed);
            let _ = unsafe { render_client.ReleaseBuffer(buffer_frames, 0) };
            continue;
        }

        let valid_frames = popped / 2;
        let muted = feed.muted.load(Ordering::Relaxed);
        let lock_vol = feed.lock_volume.load(Ordering::Relaxed);
        let vol = f64::from_bits(feed.volume_bits.load(Ordering::Relaxed)).clamp(0.0, 1.0);
        let gain_q16 = if lock_vol {
            None
        } else {
            Some((vol * 65_536.0).round() as i64)
        };

        pack_i32_stereo_to_wire(
            &stereo_scratch,
            dst_bytes,
            info.wire_format,
            ch,
            gain_q16,
            muted,
        );

        feed.played_frames
            .fetch_add(valid_frames as u64, Ordering::Relaxed);

        // Lightweight playback telemetry for VU meters
        if !muted {
            let mut sum_sq = 0.0_f64;
            let step = (popped / 64).max(1);
            let mut count = 0_usize;
            for i in (0..popped).step_by(step) {
                let s = stereo_scratch[i] as f64 / 2_147_483_648.0;
                sum_sq += s * s;
                count += 1;
            }
            let raw_rms = (sum_sq / count.max(1) as f64).sqrt() as f32;
            let gain_lin = if lock_vol { 1.0_f32 } else { vol as f32 };
            let scaled_db = if raw_rms * gain_lin > 1e-6 {
                20.0 * (raw_rms * gain_lin).log10()
            } else {
                -90.0
            };
            feed.playback_rms_bits
                .store(scaled_db.to_bits(), Ordering::Relaxed);
        }

        if let Err(e) = unsafe { render_client.ReleaseBuffer(buffer_frames, 0) } {
            if e.code() == AUDCLNT_E_DEVICE_INVALIDATED {
                break;
            }
        }
    }

    unsafe {
        let _ = audio_client.Stop();
        if let Some(h) = mmcss_handle {
            let _ = AvRevertMmThreadCharacteristics(h);
        }
    }
    if let Ok(mut g) = wake_slot.lock() {
        if let Some(ev) = g.take() {
            unsafe {
                let _ = CloseHandle(ev.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bit_exact_i16_roundtrip_zero_error() {
        let orig: Vec<i16> = vec![0, 1, -1, 12_345, -23_456, i16::MAX, i16::MIN, 512];
        let src_i32: Vec<i32> = orig.iter().map(|&s| (s as i32) << 16).collect();
        let mut wire = vec![0u8; orig.len() * 2];

        pack_i32_stereo_to_wire(&src_i32, &mut wire, WireFormat::Pcm16, 2, None, false);

        let decoded: Vec<i16> = wire
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&c| i16::from_le_bytes(c))
            .collect();
        assert_eq!(decoded, orig);
    }

    #[test]
    fn bit_exact_i24_roundtrip_zero_error() {
        let orig_i24: Vec<i32> = vec![
            0,
            1,
            -1,
            0x0012_3456,
            -0x0023_4567,
            0x007F_FFFF,
            -0x0080_0000,
            0x0055_AA01,
        ];
        let src_i32: Vec<i32> = orig_i24.iter().map(|&s| s << 8).collect();

        // Packed 24-bit (3 bytes per sample)
        let mut wire_packed = vec![0u8; orig_i24.len() * 3];
        pack_i32_stereo_to_wire(
            &src_i32,
            &mut wire_packed,
            WireFormat::Pcm24Packed,
            2,
            None,
            false,
        );
        let decoded_packed: Vec<i32> = wire_packed
            .as_chunks::<3>()
            .0
            .iter()
            .map(|&c| {
                let raw = [0u8, c[0], c[1], c[2]];
                i32::from_le_bytes(raw) >> 8
            })
            .collect();
        assert_eq!(decoded_packed, orig_i24);

        // 24-in-32 container (4 bytes per sample, top 24 valid bits)
        let mut wire_in32 = vec![0u8; orig_i24.len() * 4];
        pack_i32_stereo_to_wire(
            &src_i32,
            &mut wire_in32,
            WireFormat::Pcm24In32,
            2,
            None,
            false,
        );
        let decoded_in32: Vec<i32> = wire_in32
            .as_chunks::<4>()
            .0
            .iter()
            .map(|&c| i32::from_le_bytes(c) >> 8)
            .collect();
        assert_eq!(decoded_in32, orig_i24);
    }

    #[test]
    fn wave_format_extensible_layout_valid() {
        let wf = build_wave_format(96_000, 2, WireFormat::Pcm24In32);
        let tag = wf.Format.wFormatTag;
        let ch = wf.Format.nChannels;
        let sr = wf.Format.nSamplesPerSec;
        let align = wf.Format.nBlockAlign;
        let bps = wf.Format.wBitsPerSample;
        let cb = wf.Format.cbSize;
        let valid = unsafe { wf.Samples.wValidBitsPerSample };
        let mask = wf.dwChannelMask;
        let sub = wf.SubFormat;

        assert_eq!(tag, WAVE_FORMAT_EXTENSIBLE_TAG);
        assert_eq!(ch, 2);
        assert_eq!(sr, 96_000);
        assert_eq!(align, 8);
        assert_eq!(bps, 32);
        assert_eq!(cb, 22);
        assert_eq!(valid, 24);
        assert_eq!(mask, 0x3);
        assert_eq!(sub, KSDATAFORMAT_SUBTYPE_PCM);
    }
}
