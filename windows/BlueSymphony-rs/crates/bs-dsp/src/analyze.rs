use std::f64::consts::PI;

use rustfft::{FftPlanner, num_complex::Complex};

use crate::types::{DspError, MeasuredResponse, MicCalibration};

pub const LOG_FREQ_COUNT: usize = 200;

/// Returns 200 log-spaced frequency points from 20 Hz to 20 kHz.
pub fn log_freq_grid() -> Vec<f32> {
    (0..LOG_FREQ_COUNT)
        .map(|i| {
            let t = i as f64 / (LOG_FREQ_COUNT - 1) as f64;
            (20.0 * (1000.0_f64).powf(t)) as f32
        })
        .collect()
}

/// Deconvolves a recorded Farina ESS against its inverse filter, extracts the Room Impulse
/// Response (RIR), estimates `RT60` & Schroeder frequency `fs`, and returns the raw +
/// psychoacoustic-smoothed frequency response normalized around 300 Hz–1.5 kHz.
pub fn analyze_sweep_rir(
    recorded: &[f32],
    inverse_filter: &[f32],
    sample_rate: u32,
    mic_cal: Option<&MicCalibration>,
    channel_label: &str,
) -> Result<MeasuredResponse, DspError> {
    if recorded.len() < inverse_filter.len() / 2 || inverse_filter.is_empty() {
        return Err(DspError::InvalidMeasurement(
            "Dữ liệu thu âm quá ngắn để phân tích".to_string(),
        ));
    }

    let rir = deconvolve_rir(recorded, inverse_filter);
    if rir.is_empty() {
        return Err(DspError::InvalidMeasurement(
            "Không tách được xung phản hồi phòng (RIR)".to_string(),
        ));
    }

    // Locate main direct arrival peak (exclude harmonic pre-echo by taking global abs max
    // around expected convolution alignment >= inverse_filter.len()/2 when padded, or anywhere
    // near end of sweep).
    let search_start = inverse_filter.len() / 2;
    let mut peak_idx = search_start.min(rir.len() - 1);
    let mut peak_val = 0.0_f32;
    for (idx, &v) in rir.iter().enumerate().skip(search_start) {
        let av = v.abs();
        if av > peak_val {
            peak_val = av;
            peak_idx = idx;
        }
    }
    if peak_val < 1e-6 {
        return Err(DspError::InvalidMeasurement(
            "Không thu được tín hiệu quét từ micro (kiểm tra lại micro hoặc âm lượng loa)".to_string(),
        ));
    }

    let sr = sample_rate.max(8000) as f64;
    let pre_samples = (0.012 * sr).round() as usize;
    let post_samples = (0.350 * sr).round() as usize;
    let win_start = peak_idx.saturating_sub(pre_samples);
    let win_end = (peak_idx + post_samples).min(rir.len());
    let ir_window = &rir[win_start..win_end];

    let rt60_sec = estimate_rt60(ir_window, sample_rate);
    // Home office / living room typical volume ~28 m^3 => Schroeder ~2000*sqrt(RT60/28)
    let schroeder_hz = (2000.0 * (rt60_sec as f64 / 28.0).sqrt()).clamp(120.0, 340.0) as f32;

    // FFT of windowed RIR with zero padding for ~1.5 Hz resolution
    let fft_len = (ir_window.len().max(16_384)).next_power_of_two().max(32_768);
    let mut planner = FftPlanner::<f64>::new();
    let fft = planner.plan_fft_forward(fft_len);
    let mut buf = vec![Complex::new(0.0, 0.0); fft_len];
    for (i, &s) in ir_window.iter().enumerate() {
        // Right-tail Tukey taper to avoid truncation ripples
        let taper = if i + 512 > ir_window.len() {
            let r = (ir_window.len() - i) as f64 / 512.0;
            0.5 * (1.0 - (PI * r).cos())
        } else {
            1.0
        };
        buf[i].re = (s as f64) * taper;
    }
    fft.process(&mut buf);

    let bin_hz = sr / fft_len as f64;
    let half_bins = fft_len / 2;
    let grid = log_freq_grid();
    let mut raw_db = Vec::with_capacity(grid.len());

    for &f in &grid {
        let exact_bin = (f as f64 / bin_hz).clamp(1.0, (half_bins - 2) as f64);
        let b0 = exact_bin.floor() as usize;
        let frac = exact_bin - b0 as f64;
        let m0 = buf[b0].norm();
        let m1 = buf[b0 + 1].norm();
        let mag = (m0 * (1.0 - frac) + m1 * frac).max(1e-12);
        let mut db = 20.0 * mag.log10();
        if let Some(cal) = mic_cal {
            db -= cal.interpolate_db(f as f64);
        }
        raw_db.push(db as f32);
    }

    // Anchor median 300 Hz - 1500 Hz around 0 dB
    let mut mid_vals: Vec<f32> = grid
        .iter()
        .zip(raw_db.iter())
        .filter(|&(&f, _)| (300.0..=1500.0).contains(&f))
        .map(|(_, &d)| d)
        .collect();
    if !mid_vals.is_empty() {
        mid_vals.sort_by(|a, b| a.total_cmp(b));
        let offset = mid_vals[mid_vals.len() / 2];
        for v in &mut raw_db {
            *v -= offset;
        }
    }

    let smoothed_db = smooth_psychoacoustic(&grid, &raw_db, schroeder_hz);

    Ok(MeasuredResponse {
        freqs: grid,
        raw_db,
        smoothed_db,
        rt60_sec,
        schroeder_hz,
        points_count: 1,
        channel_label: channel_label.to_string(),
    })
}

fn deconvolve_rir(recorded: &[f32], inverse: &[f32]) -> Vec<f32> {
    let total = recorded.len() + inverse.len() - 1;
    let fft_len = total.next_power_of_two();
    let mut planner = FftPlanner::<f64>::new();
    let fwd = planner.plan_fft_forward(fft_len);
    let inv = planner.plan_fft_inverse(fft_len);

    let mut a = vec![Complex::new(0.0, 0.0); fft_len];
    let mut b = vec![Complex::new(0.0, 0.0); fft_len];
    for (i, &v) in recorded.iter().enumerate() {
        a[i].re = v as f64;
    }
    for (i, &v) in inverse.iter().enumerate() {
        b[i].re = v as f64;
    }

    fwd.process(&mut a);
    fwd.process(&mut b);
    for (ca, cb) in a.iter_mut().zip(b.iter()) {
        *ca *= *cb;
    }
    inv.process(&mut a);

    let scale = 1.0 / fft_len as f64;
    a.into_iter().take(total).map(|c| (c.re * scale) as f32).collect()
}

fn estimate_rt60(ir: &[f32], sample_rate: u32) -> f32 {
    if ir.is_empty() {
        return 0.35;
    }
    // Schroeder backward integration from end to start
    let mut edc = vec![0.0_f64; ir.len()];
    let mut acc = 0.0_f64;
    for i in (0..ir.len()).rev() {
        let e = (ir[i] as f64) * (ir[i] as f64);
        acc += e;
        edc[i] = acc;
    }
    let total_e = edc[0].max(1e-18);
    let mut t_m5 = None;
    let mut t_m25 = None;
    for (i, &e) in edc.iter().enumerate() {
        let db = 10.0 * (e / total_e).max(1e-12).log10();
        if t_m5.is_none() && db <= -5.0 {
            t_m5 = Some(i as f64 / sample_rate as f64);
        }
        if t_m25.is_none() && db <= -25.0 {
            t_m25 = Some(i as f64 / sample_rate as f64);
            break;
        }
    }
    match (t_m5, t_m25) {
        (Some(t1), Some(t2)) if t2 > t1 => ((t2 - t1) * 3.0).clamp(0.15, 1.8) as f32,
        _ => 0.35,
    }
}

/// Variable / psychoacoustic smoothing:
/// ~1/12 octave below Schroeder `fs`, ~1/3 octave above `fs`.
pub fn smooth_psychoacoustic(freqs: &[f32], db: &[f32], schroeder_hz: f32) -> Vec<f32> {
    let n = freqs.len().min(db.len());
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let f = freqs[i];
        // Blend octave width smoothly across Schroeder transition
        let ratio = ((f / schroeder_hz.max(80.0)).ln() / 1.0).clamp(-1.0, 1.0) * 0.5 + 0.5;
        let oct_width = (1.0 / 12.0) * (1.0 - ratio) + (1.0 / 3.0) * ratio;
        let half_oct = oct_width * 0.5;

        let f_min = f * 2.0_f32.powf(-half_oct);
        let f_max = f * 2.0_f32.powf(half_oct);

        let mut power_sum = 0.0_f64;
        let mut weight_sum = 0.0_f64;
        for j in 0..n {
            if freqs[j] < f_min {
                continue;
            }
            if freqs[j] > f_max {
                break;
            }
            let dist = ((freqs[j] / f).log2() / half_oct).abs();
            let w = 0.5 * (1.0 + (PI as f32 * dist).cos()) as f64;
            let linear_pow = 10.0_f64.powf(db[j] as f64 / 10.0);
            power_sum += w * linear_pow;
            weight_sum += w;
        }
        if weight_sum > 0.0 {
            out.push((10.0 * (power_sum / weight_sum).max(1e-12).log10()) as f32);
        } else {
            out.push(db[i]);
        }
    }
    out
}

/// Power-domain spatial average of multi-point room measurements.
pub fn average_responses(list: &[MeasuredResponse]) -> Option<MeasuredResponse> {
    let first = list.first()?;
    if list.len() == 1 {
        return Some(first.clone());
    }
    let n = first.freqs.len();
    let mut avg_raw = vec![0.0_f32; n];
    for (i, slot) in avg_raw.iter_mut().enumerate().take(n) {
        let mut p_sum = 0.0_f64;
        for m in list {
            if let Some(&v) = m.raw_db.get(i) {
                p_sum += 10.0_f64.powf(v as f64 / 10.0);
            }
        }
        *slot = (10.0 * (p_sum / list.len() as f64).max(1e-12).log10()) as f32;
    }
    let avg_rt60 = list.iter().map(|m| m.rt60_sec).sum::<f32>() / list.len() as f32;
    let avg_fs = list.iter().map(|m| m.schroeder_hz).sum::<f32>() / list.len() as f32;
    let smoothed_db = smooth_psychoacoustic(&first.freqs, &avg_raw, avg_fs);

    Some(MeasuredResponse {
        freqs: first.freqs.clone(),
        raw_db: avg_raw,
        smoothed_db,
        rt60_sec: avg_rt60,
        schroeder_hz: avg_fs,
        points_count: list.len() as u8,
        channel_label: first.channel_label.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::measure::generate_farina_ess;

    #[test]
    fn farina_loopback_recovers_flat_response() {
        let sr = 48_000;
        let (sweep, inv) = generate_farina_ess(sr, 2.0, 20.0, 20_000.0, 0.5);
        // Simulate pure delay + attenuation through room air
        let mut rec = vec![0.0_f32; 2400];
        rec.extend_from_slice(&sweep);
        rec.extend(std::iter::repeat_n(0.0_f32, 4800));
        let res = analyze_sweep_rir(&rec, &inv, sr, None, "Stereo").expect("rir ok");
        let mid_err: f32 = res
            .freqs
            .iter()
            .zip(res.smoothed_db.iter())
            .filter(|&(&f, _)| (60.0..=14_000.0).contains(&f))
            .map(|(_, &d)| d.abs())
            .fold(0.0_f32, f32::max);
        assert!(mid_err < 2.0, "loopback max deviation was {mid_err} dB");
    }
}

