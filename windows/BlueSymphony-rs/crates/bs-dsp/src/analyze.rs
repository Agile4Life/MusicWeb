use std::f64::consts::PI;

use rustfft::{FftPlanner, num_complex::Complex};

use crate::measure::{SyncedEssSignal, analyze_noise_floor, generate_pink_noise};
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

/// Analyzes an asynchronous Moving Microphone Method (MMM) recording of Pink Noise
/// using Welch averaged PSD relative to our deterministic reference Pink Noise generator.
/// Completely immune to wireless latency and ADC/DAC clock drift.
pub fn analyze_mmm_pink_noise(
    recorded: &[f32],
    sample_rate: u32,
    mic_cal: Option<&MicCalibration>,
    channel_label: &str,
) -> Result<MeasuredResponse, DspError> {
    let sr = sample_rate.max(8000);
    if recorded.len() < (sr as usize) * 2 {
        return Err(DspError::InvalidMeasurement(
            "Bản thu MMM quá ngắn (cần tối thiểu 2 giây)".to_string(),
        ));
    }

    let lead_trim = ((0.8 * sr as f64).round() as usize).min(recorded.len() / 6);
    let tail_trim = ((0.6 * sr as f64).round() as usize).min(recorded.len() / 6);
    let body = &recorded[lead_trim..recorded.len().saturating_sub(tail_trim)];
    if body.len() < 8192 {
        return Err(DspError::InvalidMeasurement(
            "Dữ liệu âm thanh MMM chưa đủ để phân tích FFT".to_string(),
        ));
    }

    let noise = analyze_noise_floor(body);
    if noise.rms_dbfs < -60.0 {
        return Err(DspError::InvalidMeasurement(
            "Tín hiệu Pink Noise thu từ micro iPhone quá nhỏ — kiểm tra âm lượng loa và quyền micro"
                .to_string(),
        ));
    }

    let fft_len = 8192;
    let rec_psd = welch_psd_bins(body, fft_len);
    let ref_pink = generate_pink_noise(sr, 6.0, 0.5);
    let ref_psd = welch_psd_bins(&ref_pink, fft_len);

    let bin_hz = sr as f64 / fft_len as f64;
    let half_bins = fft_len / 2;
    let grid = log_freq_grid();
    let mut raw_db = Vec::with_capacity(grid.len());

    for &f in &grid {
        let exact_bin = (f as f64 / bin_hz).clamp(1.0, (half_bins - 2) as f64);
        let b0 = exact_bin.floor() as usize;
        let frac = exact_bin - b0 as f64;
        let p_rec = rec_psd[b0] * (1.0 - frac) + rec_psd[b0 + 1] * frac;
        let p_ref = (ref_psd[b0] * (1.0 - frac) + ref_psd[b0 + 1] * frac).max(1e-18);
        let mut db = 10.0 * (p_rec / p_ref).max(1e-12).log10();
        if let Some(cal) = mic_cal {
            db -= cal.interpolate_db(f as f64);
        }
        raw_db.push(db as f32);
    }

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

    let schroeder_hz = 220.0_f32;
    let smoothed_db = smooth_psychoacoustic(&grid, &raw_db, schroeder_hz);

    Ok(MeasuredResponse {
        freqs: grid,
        raw_db,
        smoothed_db,
        rt60_sec: 0.35,
        schroeder_hz,
        points_count: 1,
        channel_label: channel_label.to_string(),
    })
}

/// Aligns an asynchronously recorded sweep from an external device (e.g. iPhone) using
/// two bounding timing chirps to measure & remove clock drift, then runs Farina RIR analysis.
pub fn analyze_synced_sweep_rir(
    recorded: &[f32],
    rec_sample_rate: u32,
    signal: &SyncedEssSignal,
    out_sample_rate: u32,
    mic_cal: Option<&MicCalibration>,
    channel_label: &str,
) -> Result<MeasuredResponse, DspError> {
    if recorded.is_empty() || signal.sync_chirp.is_empty() || signal.inverse_filter.is_empty() {
        return Err(DspError::InvalidMeasurement(
            "Thiếu dữ liệu thu âm hoặc tín hiệu tham chiếu".to_string(),
        ));
    }

    let rec_sr = rec_sample_rate.max(8000);
    let out_sr = out_sample_rate.max(8000);
    let rec_at_out_sr = if rec_sr == out_sr {
        recorded.to_vec()
    } else {
        resample_lanczos4_ratio(recorded, out_sr as f64 / rec_sr as f64)
    };

    let chirp_len = signal.sync_chirp.len();
    if rec_at_out_sr.len() < signal.expected_chirp_gap_samples / 2 + chirp_len {
        return Err(DspError::InvalidMeasurement(
            "Bản thu âm từ iPhone quá ngắn để tìm hai xung đồng bộ".to_string(),
        ));
    }

    // Cross-correlate rec with chirp via time-reversed convolution:
    // corr[k + chirp_len - 1] == sum_m rec[k + m] * chirp[m]
    let chirp_rev: Vec<f32> = signal.sync_chirp.iter().rev().copied().collect();
    let corr = deconvolve_rir(&rec_at_out_sr, &chirp_rev);
    let lag_bias = (chirp_len - 1) as f64;

    let min_c1 = chirp_len - 1;
    let max_c1 = corr
        .len()
        .saturating_sub((signal.expected_chirp_gap_samples as f64 * 0.92) as usize)
        .max(min_c1 + 1);
    if max_c1 <= min_c1 {
        return Err(DspError::InvalidMeasurement(
            "Không đủ khung hình để định vị xung đồng bộ đầu tiên".to_string(),
        ));
    }

    let mut idx1 = min_c1;
    let mut best1 = 0.0_f32;
    let mut sum_sq = 0.0_f64;
    for (i, &v) in corr[min_c1..max_c1].iter().enumerate() {
        let av = v.abs();
        sum_sq += (v as f64) * (v as f64);
        if av > best1 {
            best1 = av;
            idx1 = min_c1 + i;
        }
    }

    let min_c2 = (idx1 + (signal.expected_chirp_gap_samples as f64 * 0.94) as usize)
        .min(corr.len().saturating_sub(1));
    let max_c2 = (idx1 + (signal.expected_chirp_gap_samples as f64 * 1.06) as usize)
        .min(corr.len())
        .max(min_c2 + 1);

    let mut idx2 = min_c2;
    let mut best2 = 0.0_f32;
    for (i, &v) in corr[min_c2..max_c2].iter().enumerate() {
        let av = v.abs();
        if av > best2 {
            best2 = av;
            idx2 = min_c2 + i;
        }
    }

    let corr_rms = ((sum_sq / (max_c1 - min_c1).max(1) as f64).sqrt()).max(1e-9) as f32;
    if best1 < corr_rms * 4.5 || best2 < corr_rms * 4.5 {
        return Err(DspError::InvalidMeasurement(
            "Không bắt được hai xung đồng bộ từ loa — thử tăng nhẹ âm lượng đo hoặc giữ iPhone gần vị trí nghe".to_string(),
        ));
    }

    let p1 = parabolic_abs_peak(&corr, idx1);
    let p2 = parabolic_abs_peak(&corr, idx2);
    let measured_gap = p2 - p1;
    let clock_ratio = measured_gap / signal.expected_chirp_gap_samples.max(1) as f64;
    if !(0.97..=1.03).contains(&clock_ratio) {
        return Err(DspError::InvalidMeasurement(format!(
            "Sai lệch xung đồng bộ bất thường ({clock_ratio:.4}x) — vui lòng đo lại trong không gian yên tĩnh"
        )));
    }

    let lag1 = p1 - lag_bias;
    let pre_margin = (0.15 * out_sr as f64).round() as usize;
    let post_margin = (0.55 * out_sr as f64).round() as usize;
    let rec_start = lag1 + signal.sweep_offset_from_chirp1 as f64 - pre_margin as f64;
    let out_len = pre_margin + signal.sweep_len + post_margin;

    let mut aligned_sweep = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = rec_start + (i as f64) * clock_ratio;
        aligned_sweep.push(sample_lanczos4(&rec_at_out_sr, pos));
    }

    analyze_sweep_rir(
        &aligned_sweep,
        &signal.inverse_filter,
        out_sr,
        mic_cal,
        channel_label,
    )
}

fn welch_psd_bins(samples: &[f32], fft_len: usize) -> Vec<f64> {
    let hop = (fft_len / 2).max(1);
    let half = fft_len / 2 + 1;
    let mut acc = vec![0.0_f64; half];
    if samples.len() < fft_len {
        return acc;
    }

    let window: Vec<f64> = (0..fft_len)
        .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f64 / fft_len as f64).cos()))
        .collect();
    let mut planner = FftPlanner::<f64>::new();
    let fft = planner.plan_fft_forward(fft_len);
    let mut buf = vec![Complex::new(0.0, 0.0); fft_len];

    let mut segments = 0usize;
    let mut start = 0usize;
    while start + fft_len <= samples.len() {
        for (i, slot) in buf.iter_mut().enumerate() {
            slot.re = (samples[start + i] as f64) * window[i];
            slot.im = 0.0;
        }
        fft.process(&mut buf);
        for (k, slot) in acc.iter_mut().enumerate() {
            *slot += buf[k].norm_sqr();
        }
        segments += 1;
        start += hop;
    }

    if segments > 0 {
        let norm = 1.0 / (segments as f64);
        for slot in &mut acc {
            *slot *= norm;
        }
    }
    acc
}

fn parabolic_abs_peak(corr: &[f32], idx: usize) -> f64 {
    if idx == 0 || idx + 1 >= corr.len() {
        return idx as f64;
    }
    let y0 = corr[idx - 1].abs() as f64;
    let y1 = corr[idx].abs() as f64;
    let y2 = corr[idx + 1].abs() as f64;
    let denom = y0 - 2.0 * y1 + y2;
    if denom.abs() < 1e-12 {
        return idx as f64;
    }
    let delta = (0.5 * (y0 - y2) / denom).clamp(-0.5, 0.5);
    idx as f64 + delta
}

fn sample_lanczos4(src: &[f32], pos: f64) -> f32 {
    if src.is_empty() || pos < 0.0 || pos > (src.len() - 1) as f64 {
        return 0.0;
    }
    let center = pos.floor() as isize;
    if (pos - center as f64).abs() < 1e-9 {
        return src[center as usize];
    }
    let mut sum = 0.0_f64;
    let mut w_sum = 0.0_f64;
    let len = src.len() as isize;
    for k in (center - 3)..=(center + 4) {
        if k < 0 || k >= len {
            continue;
        }
        let d = pos - k as f64;
        let x = d.abs();
        let w = if x < 1e-9 {
            1.0
        } else if x < 4.0 {
            let px = PI * x;
            let px4 = px / 4.0;
            (px.sin() / px) * (px4.sin() / px4)
        } else {
            0.0
        };
        sum += (src[k as usize] as f64) * w;
        w_sum += w;
    }
    if w_sum > 1e-12 {
        (sum / w_sum) as f32
    } else {
        0.0
    }
}

fn resample_lanczos4_ratio(src: &[f32], ratio: f64) -> Vec<f32> {
    if src.is_empty() || ratio <= 0.0 {
        return Vec::new();
    }
    let out_len = ((src.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        out.push(sample_lanczos4(src, i as f64 / ratio));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::measure::{generate_farina_ess, generate_synced_farina_ess};

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

    #[test]
    fn mmm_pink_noise_loopback_recovers_flat_response() {
        let sr = 48_000;
        let pink = generate_pink_noise(sr, 8.0, 0.4);
        let res = analyze_mmm_pink_noise(&pink, sr, None, "Stereo").expect("mmm ok");
        let max_err: f32 = res
            .freqs
            .iter()
            .zip(res.smoothed_db.iter())
            .filter(|&(&f, _)| (40.0..=16_000.0).contains(&f))
            .map(|(_, &d)| d.abs())
            .fold(0.0_f32, f32::max);
        assert!(max_err < 2.0, "MMM loopback max deviation was {max_err} dB");
    }

    #[test]
    fn synced_farina_ess_compensates_clock_drift() {
        let sr = 48_000;
        let sig = generate_synced_farina_ess(sr, 2.5, 20.0, 20_000.0, 0.5);
        let mut raw = vec![0.0_f32; 18_000];
        raw.extend_from_slice(&sig.playback);
        raw.extend(std::iter::repeat_n(0.0_f32, 12_000));
        // Simulate +300 ppm clock drift between PC DAC and iPhone ADC
        let drifted = resample_lanczos4_ratio(&raw, 1.0003);
        let res = analyze_synced_sweep_rir(&drifted, sr, &sig, sr, None, "Stereo")
            .expect("synced rir ok");
        let max_err: f32 = res
            .freqs
            .iter()
            .zip(res.smoothed_db.iter())
            .filter(|&(&f, _)| (60.0..=14_000.0).contains(&f))
            .map(|(_, &d)| d.abs())
            .fold(0.0_f32, f32::max);
        assert!(
            max_err < 2.0,
            "synced ESS clock-drift max deviation was {max_err} dB"
        );
    }
}

