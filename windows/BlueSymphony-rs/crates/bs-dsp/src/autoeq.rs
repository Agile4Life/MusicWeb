use crate::biquad::{BiquadCoeffs, combined_response_db, compute_auto_preamp_db};
use crate::types::{EqBand, FilterKind, MeasuredResponse, TargetCurveKind};

#[derive(Debug, Clone)]
pub struct AutoEqOptions {
    pub target: TargetCurveKind,
    pub max_bands: usize,
    pub min_freq_hz: f64,
    pub max_freq_hz: f64,
    pub max_boost_db: f64,
    pub max_cut_db: f64,
    pub schroeder_hz: f64,
    pub uncalibrated_mic_safe_mode: bool,
    pub sample_rate: f64,
}

impl Default for AutoEqOptions {
    fn default() -> Self {
        Self {
            target: TargetCurveKind::HarmanInRoom,
            max_bands: 12,
            min_freq_hz: 28.0,
            max_freq_hz: 16_000.0,
            max_boost_db: 3.0,
            max_cut_db: 12.0,
            schroeder_hz: 220.0,
            uncalibrated_mic_safe_mode: false,
            sample_rate: 48_000.0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AutoEqResult {
    pub bands: Vec<EqBand>,
    pub preamp_db: f64,
    pub target_db: Vec<f32>,
    pub filter_db: Vec<f32>,
    pub after_db: Vec<f32>,
    pub rms_before_db: f32,
    pub rms_after_db: f32,
    pub usable_min_hz: f32,
    pub usable_max_hz: f32,
}

/// Optimizes a set of Minimum-Phase Biquad PEQ filters matching the measured room response
/// against a Target Curve, enforcing B&O/Dirac-inspired guardrails:
/// - Automatically detects speaker/mic usable passband (ignores extreme roll-off cliffs below woofer fs or above mic cutoff)
/// - Cuts resonant modal & tonal peaks cleanly across the usable passband (down to `-max_cut_db`)
/// - Never aggressively boosts deep cancellation nulls (capped at `+max_boost_db`)
/// - Safely caps correction ceiling at `6.5 kHz` when `uncalibrated_mic_safe_mode` is active.
pub fn optimize_autoeq(measured: &MeasuredResponse, opts: &AutoEqOptions) -> AutoEqResult {
    let freqs = &measured.freqs;
    let meas_db = if measured.smoothed_db.len() == freqs.len() {
        &measured.smoothed_db
    } else {
        &measured.raw_db
    };

    let (det_min, det_max) =
        detect_usable_passband(freqs, meas_db, opts.uncalibrated_mic_safe_mode);
    let min_hz = opts.min_freq_hz.max(det_min).max(20.0);
    let max_hz = opts
        .max_freq_hz
        .min(det_max)
        .max(min_hz + 40.0);
    let max_bands = opts.max_bands.clamp(4, 16);

    // Active indices inside usable speaker + mic passband
    let active_indices: Vec<usize> = freqs
        .iter()
        .enumerate()
        .filter(|&(_, &f)| (f as f64) >= min_hz && (f as f64) <= max_hz)
        .map(|(i, _)| i)
        .collect();

    // Align target curve vertically to the median level of the speaker's usable passband
    let raw_target_db: Vec<f32> = freqs
        .iter()
        .map(|&f| opts.target.target_db(f as f64) as f32)
        .collect();
    let meas_med = median_at_indices(meas_db, &active_indices);
    let targ_med = median_at_indices(&raw_target_db, &active_indices);
    let level_shift = meas_med - targ_med;

    let target_db: Vec<f32> = raw_target_db
        .iter()
        .map(|&t| t + level_shift)
        .collect();

    let eval_error = |bands: &[EqBand]| -> (Vec<f32>, f64) {
        let eq_resp = combined_response_db(bands, &[], freqs, opts.sample_rate);
        let mut sq_sum = 0.0_f64;
        for &idx in &active_indices {
            let err = (meas_db[idx] + eq_resp[idx] - target_db[idx]) as f64;
            let f = freqs[idx] as f64;
            let w = if f <= opts.schroeder_hz { 1.35 } else { 0.95 };
            let peak_pen = if err > 0.0 { 1.25 } else { 1.0 };
            sq_sum += w * peak_pen * err * err;
        }
        let rms = (sq_sum / active_indices.len().max(1) as f64).sqrt();
        (eq_resp, rms)
    };

    let mut bands: Vec<EqBand> = Vec::with_capacity(max_bands);

    // Stage 1: Greedy iterative peak/dip picking across usable passband
    for _ in 0..max_bands {
        let (cur_eq, _) = eval_error(&bands);
        let mut best_idx = None;
        let mut best_score = 0.50_f64;

        for &idx in &active_indices {
            let f = freqs[idx] as f64;
            let residual = (meas_db[idx] + cur_eq[idx] - target_db[idx]) as f64;

            // Null-guard ONLY applies when considering a BOOST (`residual < 0`).
            // Positive peaks (`residual > 0`) MUST ALWAYS be eligible for cutting!
            if residual < 0.0 && (residual < -5.5 || near_deep_null(freqs, meas_db, &target_db, idx))
            {
                continue;
            }

            let local_max_cut = opts.max_cut_db;
            let desired_gain = (-residual).clamp(-local_max_cut, opts.max_boost_db);
            let priority = if residual > 0.0 && f <= opts.schroeder_hz {
                1.35
            } else if residual > 0.0 {
                1.15
            } else {
                0.95
            };
            let score = desired_gain.abs() * priority;
            if score > best_score {
                let too_close = bands
                    .iter()
                    .any(|b| ((b.freq_hz / f).ln()).abs() < 0.12);
                if !too_close {
                    best_score = score;
                    best_idx = Some((idx, desired_gain));
                }
            }
        }

        let Some((idx, gain_init)) = best_idx else {
            break;
        };
        let fc = (freqs[idx] as f64).clamp(min_hz, max_hz);
        let is_modal = fc <= opts.schroeder_hz;
        let q_init = if is_modal { 2.6 } else { 1.3 };

        let q_est = estimate_peak_q(freqs, meas_db, &cur_eq, &target_db, idx, is_modal);
        let kind = if idx <= 2 && gain_init.abs() > 1.0 && fc < 85.0 {
            FilterKind::LowShelf
        } else {
            FilterKind::Peaking
        };
        let mut candidate = EqBand {
            enabled: true,
            kind,
            freq_hz: fc,
            gain_db: gain_init,
            q: if kind == FilterKind::LowShelf {
                0.71
            } else {
                q_est.unwrap_or(q_init)
            },
        };

        refine_single_band(
            &bands,
            &mut candidate,
            meas_db,
            &target_db,
            freqs,
            &active_indices,
            min_hz,
            max_hz,
            opts,
        );

        if candidate.gain_db.abs() >= 0.4 {
            bands.push(candidate);
        } else {
            break;
        }
    }

    // Stage 2: Joint coordinate-descent pass across all bands
    for _pass in 0..2 {
        for i in 0..bands.len() {
            let mut b = bands.remove(i);
            refine_single_band(
                &bands,
                &mut b,
                meas_db,
                &target_db,
                freqs,
                &active_indices,
                min_hz,
                max_hz,
                opts,
            );
            bands.insert(i, b);
        }
    }

    bands.retain(|b| b.gain_db.abs() >= 0.35);
    bands.sort_by(|a, b| a.freq_hz.total_cmp(&b.freq_hz));

    let preamp_db = compute_auto_preamp_db(&bands, &[], opts.sample_rate);
    let filter_db = combined_response_db(&bands, &[], freqs, opts.sample_rate);
    let after_db: Vec<f32> = meas_db
        .iter()
        .zip(filter_db.iter())
        .map(|(&m, &f)| m + f)
        .collect();

    let rms_before_db = rms_diff_in_range(meas_db, &target_db, &active_indices);
    let rms_after_db = rms_diff_in_range(&after_db, &target_db, &active_indices);

    AutoEqResult {
        bands,
        preamp_db,
        target_db,
        filter_db,
        after_db,
        rms_before_db,
        rms_after_db,
        usable_min_hz: min_hz as f32,
        usable_max_hz: max_hz as f32,
    }
}

/// Automatically detects the usable speaker + microphone passband `[min_hz, max_hz]` so
/// physical sub-bass roll-off on compact speakers (or high-frequency roll-off on voice mics)
/// is excluded from EQ optimization.
fn detect_usable_passband(freqs: &[f32], meas_db: &[f32], safe_mode: bool) -> (f64, f64) {
    if freqs.len() < 16 || meas_db.len() != freqs.len() {
        return (28.0, if safe_mode { 6500.0 } else { 16_000.0 });
    }

    // Reference vocal/midrange band 350 Hz - 3500 Hz
    let mut mid_vals: Vec<f32> = freqs
        .iter()
        .zip(meas_db.iter())
        .filter(|&(&f, _)| (350.0..=3500.0).contains(&f))
        .map(|(_, &d)| d)
        .collect();
    if mid_vals.is_empty() {
        return (28.0, if safe_mode { 6500.0 } else { 16_000.0 });
    }
    mid_vals.sort_by(|a, b| a.total_cmp(b));
    let ref_db = mid_vals[mid_vals.len() / 2];

    let low_thresh = ref_db - 13.0;
    let high_thresh = ref_db - 14.0;

    // Walk up from 20 Hz to find where woofer leaves deep roll-off cliff
    let mut usable_min = 28.0_f64;
    for (&f, &d) in freqs.iter().zip(meas_db.iter()) {
        if f >= 28.0 && d >= low_thresh {
            usable_min = (f as f64).clamp(28.0, 260.0);
            break;
        }
        if f > 260.0 {
            usable_min = 240.0;
            break;
        }
    }

    // Walk down from 20 kHz to find where tweeter / voice mic leaves upper roll-off cliff
    let ceiling = if safe_mode { 6500.0_f64 } else { 17_500.0_f64 };
    let mut usable_max = ceiling;
    for (&f, &d) in freqs.iter().zip(meas_db.iter()).rev() {
        if (f as f64) <= ceiling && d >= high_thresh {
            usable_max = (f as f64).clamp(2200.0, ceiling);
            break;
        }
    }

    if usable_max < usable_min + 200.0 {
        usable_max = (usable_min + 1000.0).min(ceiling);
    }

    (usable_min, usable_max)
}

fn median_at_indices(vals: &[f32], indices: &[usize]) -> f32 {
    if indices.is_empty() {
        return 0.0;
    }
    let mut slice: Vec<f32> = indices.iter().filter_map(|&i| vals.get(i).copied()).collect();
    if slice.is_empty() {
        return 0.0;
    }
    slice.sort_by(|a, b| a.total_cmp(b));
    slice[slice.len() / 2]
}

fn estimate_peak_q(
    freqs: &[f32],
    meas: &[f32],
    cur_eq: &[f32],
    target: &[f32],
    idx: usize,
    is_modal: bool,
) -> Option<f64> {
    let center_err = (meas[idx] + cur_eq[idx] - target[idx]).abs();
    if center_err < 1.0 {
        return None;
    }
    let half = center_err * 0.5;
    let mut left_f = freqs[idx];
    for j in (0..idx).rev() {
        if (meas[j] + cur_eq[j] - target[j]).abs() <= half {
            left_f = freqs[j];
            break;
        }
    }
    let mut right_f = freqs[idx];
    for j in (idx + 1)..freqs.len() {
        if (meas[j] + cur_eq[j] - target[j]).abs() <= half {
            right_f = freqs[j];
            break;
        }
    }
    let bw = (right_f - left_f).max(4.0) as f64;
    let q = freqs[idx] as f64 / bw;
    if is_modal {
        Some(q.clamp(1.2, 6.0))
    } else {
        Some(q.clamp(0.7, 2.6))
    }
}

#[allow(clippy::too_many_arguments)]
fn refine_single_band(
    other_bands: &[EqBand],
    cand: &mut EqBand,
    meas_db: &[f32],
    target_db: &[f32],
    freqs: &[f32],
    active_indices: &[usize],
    min_hz: f64,
    max_hz: f64,
    opts: &AutoEqOptions,
) {
    let base_eq = combined_response_db(other_bands, &[], freqs, opts.sample_rate);

    let (q_min, q_max) = if cand.kind == FilterKind::LowShelf {
        (0.55, 0.95)
    } else if cand.freq_hz <= opts.schroeder_hz {
        (1.0, 6.5)
    } else {
        (0.65, 2.8)
    };

    let score_fn = |b: &EqBand| -> f64 {
        let coeffs = BiquadCoeffs::from_band(b, opts.sample_rate);
        let mut sq = 0.0_f64;
        for &idx in active_indices {
            let f = freqs[idx] as f64;
            let eq_total = base_eq[idx] as f64 + coeffs.magnitude_db(f, opts.sample_rate);
            let after = meas_db[idx] as f64 + eq_total;
            let err = after - target_db[idx] as f64;
            let w = if f <= opts.schroeder_hz { 1.3 } else { 1.0 };
            let ceiling_pen = if eq_total > opts.max_boost_db + 0.05 {
                let over = eq_total - opts.max_boost_db;
                120.0 * over * over
            } else {
                0.0
            };
            let boost_null_pen =
                if b.gain_db > 0.3 && (meas_db[idx] as f64 - target_db[idx] as f64) < -5.5 {
                    3.0
                } else {
                    1.0
                };
            sq += w * boost_null_pen * err * err + ceiling_pen;
        }
        sq
    };

    let mut best_score = score_fn(cand);

    for scale in [1.0, 0.45, 0.18] {
        for dir in [-1.0_f64, 1.0] {
            let mut probe = cand.clone();
            probe.freq_hz = (probe.freq_hz * (1.0 + dir * 0.12 * scale)).clamp(min_hz, max_hz);
            let s = score_fn(&probe);
            if s < best_score {
                best_score = s;
                *cand = probe;
            }
        }
        for dir in [-1.0_f64, 1.0] {
            let mut probe = cand.clone();
            probe.gain_db = (probe.gain_db + dir * 2.0 * scale)
                .clamp(-opts.max_cut_db, opts.max_boost_db);
            let s = score_fn(&probe);
            if s < best_score {
                best_score = s;
                *cand = probe;
            }
        }
        for dir in [-1.0_f64, 1.0] {
            let mut probe = cand.clone();
            probe.q = (probe.q * (1.0 + dir * 0.35 * scale)).clamp(q_min, q_max);
            let s = score_fn(&probe);
            if s < best_score {
                best_score = s;
                *cand = probe;
            }
        }
    }
}

fn near_deep_null(freqs: &[f32], meas_db: &[f32], target_db: &[f32], idx: usize) -> bool {
    let f = freqs[idx];
    let lo = f * 0.80;
    let hi = f * 1.25;
    for (j, &fj) in freqs.iter().enumerate() {
        if fj < lo {
            continue;
        }
        if fj > hi {
            break;
        }
        if (meas_db[j] - target_db[j]) < -7.5 {
            return true;
        }
    }
    false
}

fn rms_diff_in_range(a: &[f32], b: &[f32], indices: &[usize]) -> f32 {
    if indices.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = indices
        .iter()
        .map(|&i| {
            let d = (a[i] - b[i]) as f64;
            d * d
        })
        .sum();
    (sum_sq / indices.len() as f64).sqrt() as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyze::log_freq_grid;

    #[test]
    fn autoeq_tames_room_peaks_without_overboosting_deep_null() {
        let freqs = log_freq_grid();
        let target = TargetCurveKind::StudioFlat;
        let raw_db: Vec<f32> = freqs
            .iter()
            .map(|&f| {
                let lf = f as f64;
                let p1 = 8.0 * (-((lf - 58.0) / 8.0).powi(2)).exp();
                let p2 = 7.0 * (-((lf - 112.0) / 14.0).powi(2)).exp();
                let p3 = 6.0 * (-((lf - 185.0) / 22.0).powi(2)).exp();
                let null = -15.0 * (-((lf - 82.0) / 7.0).powi(2)).exp();
                (p1 + p2 + p3 + null) as f32
            })
            .collect();

        let measured = MeasuredResponse {
            freqs: freqs.clone(),
            raw_db: raw_db.clone(),
            smoothed_db: raw_db,
            rt60_sec: 0.42,
            schroeder_hz: 245.0,
            points_count: 3,
            channel_label: "Stereo".to_string(),
        };

        let opts = AutoEqOptions {
            target,
            max_bands: 10,
            max_boost_db: 3.0,
            max_cut_db: 12.0,
            schroeder_hz: 245.0,
            uncalibrated_mic_safe_mode: true,
            ..Default::default()
        };

        let res = optimize_autoeq(&measured, &opts);
        assert!(res.rms_after_db < res.rms_before_db, "RMS did not improve");
        assert!(!res.bands.is_empty());

        for b in &res.bands {
            assert!(
                b.gain_db <= 3.05,
                "Filter @ {} Hz boosted {} dB (> +3 dB guardrail)",
                b.freq_hz,
                b.gain_db
            );
        }
        let null_idx = freqs.iter().position(|&f| f >= 82.0).unwrap();
        assert!(
            res.filter_db[null_idx] <= 3.2,
            "Combined EQ at 82 Hz null boosted {} dB",
            res.filter_db[null_idx]
        );
    }

    #[test]
    fn autoeq_fixes_real_laptop_speaker_and_voice_mic_rolloff() {
        let freqs = log_freq_grid();
        // Mirrors real Realtek laptop speaker + Intel voice mic curve shape:
        // -31 dB sub-bass roll-off (<130 Hz), +14 dB boxy peak @ 205 Hz, +13 dB @ 2.2 kHz,
        // +14 dB @ 6.1 kHz, -45 dB > 9.5 kHz
        let raw_db: Vec<f32> = freqs
            .iter()
            .map(|&f| {
                let lf = f as f64;
                let sub_roll = if lf < 140.0 {
                    -31.0 / (1.0 + (lf / 115.0).powf(5.0))
                } else {
                    0.0
                };
                let high_roll = if lf > 6800.0 {
                    -48.0 / (1.0 + (8200.0 / lf).powf(6.0))
                } else {
                    0.0
                };
                let box_peak = 13.5 * (-((lf - 205.0) / 28.0).powi(2)).exp();
                let dip_160 = -8.0 * (-((lf - 155.0) / 16.0).powi(2)).exp();
                let nasal_peak = 12.5 * (-((lf - 2200.0) / 420.0).powi(2)).exp();
                let harsh_peak = 13.0 * (-((lf - 6100.0) / 700.0).powi(2)).exp();
                (sub_roll + high_roll + box_peak + dip_160 + nasal_peak + harsh_peak) as f32
            })
            .collect();

        let measured = MeasuredResponse {
            freqs,
            raw_db: raw_db.clone(),
            smoothed_db: raw_db,
            rt60_sec: 0.24,
            schroeder_hz: 183.0,
            points_count: 2,
            channel_label: "Stereo (L+R)".to_string(),
        };

        let opts = AutoEqOptions {
            target: TargetCurveKind::HarmanInRoom,
            max_bands: 12,
            max_boost_db: 3.0,
            max_cut_db: 12.0,
            schroeder_hz: 183.0,
            uncalibrated_mic_safe_mode: true,
            ..Default::default()
        };

        let res = optimize_autoeq(&measured, &opts);
        assert!(
            res.usable_min_hz >= 100.0 && res.usable_min_hz <= 210.0,
            "usable_min_hz={}",
            res.usable_min_hz
        );
        assert!(
            res.usable_max_hz >= 5800.0 && res.usable_max_hz <= 6600.0,
            "usable_max_hz={}",
            res.usable_max_hz
        );
        assert!(
            res.bands.len() >= 3,
            "expected >= 3 active bands, got {}",
            res.bands.len()
        );
        assert!(
            res.bands.iter().any(|b| b.gain_db <= -3.0),
            "expected strong resonance cuts, got {:?}",
            res.bands
        );
        assert!(
            res.rms_after_db < res.rms_before_db * 0.70,
            "before={} after={}",
            res.rms_before_db,
            res.rms_after_db
        );
    }
}
