use std::f64::consts::PI;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NoiseCheck {
    pub rms_dbfs: f32,
    pub peak_dbfs: f32,
    pub clipping: bool,
    pub noisy: bool,
}

#[derive(Debug, Clone)]
pub struct SyncedEssSignal {
    pub playback: Vec<f32>,
    pub inverse_filter: Vec<f32>,
    pub sync_chirp: Vec<f32>,
    pub expected_chirp_gap_samples: usize,
    pub sweep_offset_from_chirp1: usize,
    pub sweep_len: usize,
}

/// Generates a short Hann-tapered exponential chirp used as an acoustic timing marker.
pub fn generate_sync_chirp(
    sample_rate: u32,
    duration_sec: f64,
    f_start: f64,
    f_end: f64,
    amplitude: f32,
) -> Vec<f32> {
    let sr = sample_rate.max(8000) as f64;
    let t_dur = duration_sec.clamp(0.02, 0.5);
    let n = (t_dur * sr).round() as usize;
    let f1 = f_start.max(200.0);
    let f2 = f_end.min(sr * 0.45).max(f1 + 200.0);
    let r = (f2 / f1).ln();
    let k = (2.0 * PI * f1 * t_dur) / r;
    let fade = ((0.15 * t_dur * sr).round() as usize).clamp(8, n / 3);
    let amp = amplitude.clamp(0.02, 0.90) as f64;

    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let t = i as f64 / sr;
        let phase = k * (((t / t_dur) * r).exp() - 1.0);
        let mut s = phase.sin() * amp;
        if i < fade {
            let w = 0.5 * (1.0 - (PI * i as f64 / fade as f64).cos());
            s *= w;
        } else if i >= n - fade {
            let rem = n - 1 - i;
            let w = 0.5 * (1.0 - (PI * rem as f64 / fade as f64).cos());
            s *= w;
        }
        out.push(s as f32);
    }
    out
}

/// Wraps a Farina ESS between two identical acoustic timing chirps so an asynchronous
/// external microphone (e.g. an iPhone over LAN) can measure and compensate clock drift.
pub fn generate_synced_farina_ess(
    sample_rate: u32,
    duration_sec: f64,
    f_start: f64,
    f_end: f64,
    amplitude: f32,
) -> SyncedEssSignal {
    let sr = sample_rate.max(8000) as f64;
    let lead_silence = (0.35 * sr).round() as usize;
    let pre_gap = (0.35 * sr).round() as usize;
    let post_gap = (0.45 * sr).round() as usize;
    let tail_silence = (0.40 * sr).round() as usize;

    let sync_chirp = generate_sync_chirp(
        sample_rate,
        0.080,
        1200.0,
        6000.0,
        (amplitude * 0.9).clamp(0.05, 0.85),
    );
    let (sweep, inverse_filter) =
        generate_farina_ess(sample_rate, duration_sec, f_start, f_end, amplitude);

    let chirp_len = sync_chirp.len();
    let sweep_len = sweep.len();
    let total =
        lead_silence + chirp_len + pre_gap + sweep_len + post_gap + chirp_len + tail_silence;

    let mut playback = vec![0.0_f32; total];
    let chirp1_start = lead_silence;
    let sweep_start = chirp1_start + chirp_len + pre_gap;
    let chirp2_start = sweep_start + sweep_len + post_gap;

    playback[chirp1_start..chirp1_start + chirp_len].copy_from_slice(&sync_chirp);
    playback[sweep_start..sweep_start + sweep_len].copy_from_slice(&sweep);
    playback[chirp2_start..chirp2_start + chirp_len].copy_from_slice(&sync_chirp);

    SyncedEssSignal {
        playback,
        inverse_filter,
        sync_chirp,
        expected_chirp_gap_samples: chirp2_start - chirp1_start,
        sweep_offset_from_chirp1: sweep_start - chirp1_start,
        sweep_len,
    }
}

/// Generates a Farina Exponential Sine Sweep (ESS) and its normalized time-reversed inverse filter.
/// Harmonic distortion components deconvolve to negative time offsets before the main impulse peak,
/// yielding an ultra-clean linear Room Impulse Response.
pub fn generate_farina_ess(
    sample_rate: u32,
    duration_sec: f64,
    f_start: f64,
    f_end: f64,
    amplitude: f32,
) -> (Vec<f32>, Vec<f32>) {
    let sr = sample_rate.max(8000) as f64;
    let t_dur = duration_sec.clamp(1.0, 20.0);
    let n = (t_dur * sr).round() as usize;
    let f1 = f_start.max(10.0);
    let f2 = f_end.min(sr * 0.45).max(f1 + 10.0);
    let r = (f2 / f1).ln();
    let k = (2.0 * PI * f1 * t_dur) / r;

    let fade_samples = ((0.03 * sr).round() as usize).min(n / 8);
    let amp = amplitude.clamp(0.01, 0.95) as f64;

    let mut sweep = Vec::with_capacity(n);
    for i in 0..n {
        let t = i as f64 / sr;
        let phase = k * (((t / t_dur) * r).exp() - 1.0);
        let mut s = phase.sin() * amp;
        if i < fade_samples {
            let w = 0.5 * (1.0 - (PI * i as f64 / fade_samples as f64).cos());
            s *= w;
        } else if i >= n - fade_samples {
            let rem = n - 1 - i;
            let w = 0.5 * (1.0 - (PI * rem as f64 / fade_samples as f64).cos());
            s *= w;
        }
        sweep.push(s as f32);
    }

    // Time-reversed inverse filter with +6 dB/octave frequency compensation:
    // Farina ESS power spectrum scales as 1/f, so weighting by f(t_rev)/f2 flattens
    // the deconvolved impulse response to 0 dB across the entire sweep band.
    let mut inverse = vec![0.0_f32; n];
    let gain_scale = 2.0 * r / (n as f64 * amp);
    for (i, slot) in inverse.iter_mut().enumerate().take(n) {
        let rev_idx = n - 1 - i;
        let t_rev = rev_idx as f64 / sr;
        let weight = ((t_rev - t_dur) * r / t_dur).exp();
        *slot = (sweep[rev_idx] as f64 * weight * gain_scale) as f32;
    }

    (sweep, inverse)
}

/// Generates pink noise (-3 dB/octave spectrum) using Paul Kellet's 7-pole approximation.
pub fn generate_pink_noise(sample_rate: u32, duration_sec: f64, amplitude: f32) -> Vec<f32> {
    let n = ((sample_rate.max(8000) as f64) * duration_sec.clamp(0.1, 15.0)).round() as usize;
    let amp = amplitude.clamp(0.01, 0.8);
    let mut out = Vec::with_capacity(n);

    let mut state: u64 = 0x5EED_CAFE_BABE_1234;
    let (mut b0, mut b1, mut b2, mut b3, mut b4, mut b5, mut b6) =
        (0.0_f32, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);

    for i in 0..n {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let white = (((state >> 32) as u32) as f32 / (u32::MAX as f32)) * 2.0 - 1.0;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.153_852;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        let pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;

        let mut env = 1.0_f32;
        if i < 512 {
            env = i as f32 / 512.0;
        } else if i + 512 > n {
            env = (n - i) as f32 / 512.0;
        }
        out.push((pink * amp * env).clamp(-0.98, 0.98));
    }
    out
}

pub fn analyze_noise_floor(samples: &[f32]) -> NoiseCheck {
    if samples.is_empty() {
        return NoiseCheck {
            rms_dbfs: -90.0,
            peak_dbfs: -90.0,
            clipping: false,
            noisy: false,
        };
    }
    let mut sum_sq = 0.0_f64;
    let mut peak = 0.0_f32;
    let mut clip_count = 0usize;
    for &s in samples {
        let a = s.abs();
        if a > peak {
            peak = a;
        }
        if a >= 0.985 {
            clip_count += 1;
        }
        sum_sq += (s as f64) * (s as f64);
    }
    let rms = (sum_sq / samples.len() as f64).sqrt().max(1e-6);
    let rms_dbfs = (20.0 * rms.log10()) as f32;
    let peak_dbfs = (20.0 * (peak.max(1e-6) as f64).log10()) as f32;

    NoiseCheck {
        rms_dbfs,
        peak_dbfs,
        clipping: clip_count > 2 || peak_dbfs > -0.3,
        noisy: rms_dbfs > -32.0,
    }
}
