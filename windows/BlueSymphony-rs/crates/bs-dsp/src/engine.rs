use std::f64::consts::PI;
use std::sync::{Arc, Mutex};

use rustfft::{Fft, FftPlanner, num_complex::Complex};

use crate::biquad::{BiquadCoeffs, BiquadFilter, combined_response_db, compute_auto_preamp_db};
use crate::loudness::{SoftLimiter, compute_abl_bands};
use crate::types::DspStore;

pub const MAX_BIQUADS_PER_CH: usize = 24;
const FFT_SIZE: usize = 1024;
pub const SPECTRUM_BANDS: usize = 24;

#[derive(Debug, Clone)]
struct CompiledBank {
    coeffs_l: [BiquadCoeffs; MAX_BIQUADS_PER_CH],
    coeffs_r: [BiquadCoeffs; MAX_BIQUADS_PER_CH],
    count_l: usize,
    count_r: usize,
    preamp_lin: f64,
}

impl Default for CompiledBank {
    fn default() -> Self {
        Self {
            coeffs_l: [BiquadCoeffs::bypass(); MAX_BIQUADS_PER_CH],
            coeffs_r: [BiquadCoeffs::bypass(); MAX_BIQUADS_PER_CH],
            count_l: 0,
            count_r: 0,
            preamp_lin: 1.0,
        }
    }
}

#[derive(Debug, Clone)]
struct SharedControl {
    store: DspStore,
    app_volume: f64,
    ambient_gain_db: f32,
    duck_gain_db: f32,
    bypass_all_for_calibration: bool,
    version: u64,
}

/// Thread-safe handle shared between UI, Adaptive Mic thread, and the realtime audio callback.
/// Uses `try_lock()` in the audio thread so the realtime callback never blocks or allocates.
#[derive(Clone)]
pub struct SharedDspState {
    inner: Arc<Mutex<SharedControl>>,
}

impl SharedDspState {
    pub fn new(store: DspStore, app_volume: f64) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SharedControl {
                store,
                app_volume,
                ambient_gain_db: 0.0,
                duck_gain_db: 0.0,
                bypass_all_for_calibration: false,
                version: 1,
            })),
        }
    }

    pub fn set_store(&self, store: DspStore) {
        if let Ok(mut g) = self.inner.lock() {
            g.store = store;
            g.version = g.version.wrapping_add(1);
        }
    }

    pub fn set_app_volume(&self, volume: f64) {
        if let Ok(mut g) = self.inner.lock() {
            g.app_volume = volume.clamp(0.0, 1.0);
            g.version = g.version.wrapping_add(1);
        }
    }

    pub fn set_adaptive_gains(&self, ambient_db: f32, duck_db: f32) {
        if let Ok(mut g) = self.inner.lock() {
            if (g.ambient_gain_db - ambient_db).abs() > 0.03
                || (g.duck_gain_db - duck_db).abs() > 0.03
            {
                g.ambient_gain_db = ambient_db;
                g.duck_gain_db = duck_db;
                g.version = g.version.wrapping_add(1);
            }
        }
    }

    pub fn set_calibration_bypass(&self, bypass: bool) {
        if let Ok(mut g) = self.inner.lock() {
            g.bypass_all_for_calibration = bypass;
            g.version = g.version.wrapping_add(1);
        }
    }
}

/// Zero-allocation realtime stereo DSP processor with click-free crossfade when swapping filters,
/// B&O ABL loudness, true-peak SoftLimiter, and an integrated 24-band FFT spectrum tap.
pub struct DspProcessor {
    sample_rate: f64,
    shared: SharedDspState,
    last_version: u64,
    filters_l: [BiquadFilter; MAX_BIQUADS_PER_CH],
    filters_r: [BiquadFilter; MAX_BIQUADS_PER_CH],
    bank: CompiledBank,
    limiter: SoftLimiter,

    // Target / current scalar gain multipliers (crossfaded per-sample)
    target_master_lin: f64,
    current_master_lin: f64,
    gain_slew: f64,

    // FFT spectrum ring buffer + preallocated scratch
    fft_ring: [f32; FFT_SIZE],
    fft_pos: usize,
    fft_plan: Arc<dyn Fft<f64>>,
    fft_scratch: Vec<Complex<f64>>,
    fft_window: [f64; FFT_SIZE],
    spectrum_smooth: [f32; SPECTRUM_BANDS],
    rms_accum_sq: f64,
    rms_accum_n: usize,
    last_rms_dbfs: f32,
}

impl DspProcessor {
    pub fn new(sample_rate: f64, shared: SharedDspState) -> Self {
        let sr = sample_rate.max(8000.0);
        let mut planner = FftPlanner::<f64>::new();
        let fft_plan = planner.plan_fft_forward(FFT_SIZE);
        let mut fft_window = [0.0_f64; FFT_SIZE];
        for (i, w) in fft_window.iter_mut().enumerate() {
            *w = 0.5 * (1.0 - (2.0 * PI * i as f64 / (FFT_SIZE - 1) as f64).cos());
        }

        let mut proc = Self {
            sample_rate: sr,
            shared,
            last_version: 0,
            filters_l: [BiquadFilter::new(); MAX_BIQUADS_PER_CH],
            filters_r: [BiquadFilter::new(); MAX_BIQUADS_PER_CH],
            bank: CompiledBank::default(),
            limiter: SoftLimiter::new(sr),
            target_master_lin: 1.0,
            current_master_lin: 1.0,
            gain_slew: 1.0 - (-1.0 / (0.025 * sr)).exp(),
            fft_ring: [0.0; FFT_SIZE],
            fft_pos: 0,
            fft_plan,
            fft_scratch: vec![Complex::new(0.0, 0.0); FFT_SIZE],
            fft_window,
            spectrum_smooth: [0.0; SPECTRUM_BANDS],
            rms_accum_sq: 0.0,
            rms_accum_n: 0,
            last_rms_dbfs: -90.0,
        };
        proc.sync_if_changed();
        proc
    }

    pub fn set_sample_rate(&mut self, sample_rate: f64) {
        self.sample_rate = sample_rate.max(8000.0);
        self.limiter.set_sample_rate(self.sample_rate);
        self.gain_slew = 1.0 - (-1.0 / (0.025 * self.sample_rate)).exp();
        self.last_version = 0;
        self.sync_if_changed();
    }

    pub fn reset_filters(&mut self) {
        for f in &mut self.filters_l {
            f.reset();
        }
        for f in &mut self.filters_r {
            f.reset();
        }
    }

    /// Processes interleaved stereo `f32` samples in-place with zero heap allocations.
    pub fn process_interleaved(&mut self, stereo: &mut [f32]) {
        self.sync_if_changed();

        for frame in stereo.chunks_exact_mut(2) {
            self.current_master_lin +=
                self.gain_slew * (self.target_master_lin - self.current_master_lin);

            let in_l = frame[0] as f64;
            let in_r = frame[1] as f64;

            let mut l = in_l * self.bank.preamp_lin;
            let mut r = in_r * self.bank.preamp_lin;

            for i in 0..self.bank.count_l {
                l = self.filters_l[i].process(l);
            }
            for i in 0..self.bank.count_r {
                r = self.filters_r[i].process(r);
            }

            l *= self.current_master_lin;
            r *= self.current_master_lin;

            let (out_l, out_r) = self.limiter.process_stereo(l, r);
            frame[0] = out_l as f32;
            frame[1] = out_r as f32;

            let mono = ((out_l + out_r) * 0.5) as f32;
            self.fft_ring[self.fft_pos] = mono;
            self.fft_pos = (self.fft_pos + 1) % FFT_SIZE;
            self.rms_accum_sq += (mono as f64) * (mono as f64);
            self.rms_accum_n += 1;
        }
    }

    /// Computes latest 24 log-spaced spectrum bars (`[0.0, 1.0]`) & returns instantaneous RMS dBFS.
    pub fn sample_telemetry(&mut self) -> ([f32; SPECTRUM_BANDS], f32) {
        if self.rms_accum_n > 0 {
            let rms = (self.rms_accum_sq / self.rms_accum_n as f64).sqrt().max(1e-6);
            self.last_rms_dbfs = (20.0 * rms.log10()) as f32;
            self.rms_accum_sq = 0.0;
            self.rms_accum_n = 0;
        }

        for i in 0..FFT_SIZE {
            let idx = (self.fft_pos + i) % FFT_SIZE;
            self.fft_scratch[i] = Complex::new(self.fft_ring[idx] as f64 * self.fft_window[i], 0.0);
        }
        self.fft_plan.process(&mut self.fft_scratch);

        let bin_hz = self.sample_rate / FFT_SIZE as f64;
        let max_bin = FFT_SIZE / 2 - 1;
        let scale = 2.0 / FFT_SIZE as f64;

        for b in 0..SPECTRUM_BANDS {
            let f_lo = 32.0 * (16_000.0 / 32.0_f64).powf(b as f64 / SPECTRUM_BANDS as f64);
            let f_hi = 32.0 * (16_000.0 / 32.0_f64).powf((b + 1) as f64 / SPECTRUM_BANDS as f64);
            let bin_lo = ((f_lo / bin_hz).floor() as usize).clamp(1, max_bin);
            let bin_hi = ((f_hi / bin_hz).ceil() as usize).clamp(bin_lo, max_bin);

            let mut peak = 0.0_f64;
            for c in &self.fft_scratch[bin_lo..=bin_hi] {
                let mag = c.norm() * scale;
                if mag > peak {
                    peak = mag;
                }
            }
            let db = 20.0 * peak.max(1e-5).log10();
            // Map [-62 dB .. -4 dB] -> [0.0 .. 1.0]
            let norm = ((db + 62.0) / 58.0).clamp(0.0, 1.0) as f32;
            let prev = self.spectrum_smooth[b];
            self.spectrum_smooth[b] = if norm > prev {
                prev + 0.55 * (norm - prev)
            } else {
                prev + 0.24 * (norm - prev)
            };
        }

        (self.spectrum_smooth, self.last_rms_dbfs)
    }

    fn sync_if_changed(&mut self) {
        let Ok(guard) = self.shared.inner.try_lock() else {
            return;
        };
        if guard.version == self.last_version {
            return;
        }
        self.last_version = guard.version;

        let sr = self.sample_rate;
        let bypass = guard.bypass_all_for_calibration || guard.store.bypass;
        let active_opt = guard.store.active_profile();

        let mut next_bank = CompiledBank::default();
        let mut level_match_db = 0.0_f64;

        if !bypass {
            if let Some(prof) = active_opt {
                if prof.enabled {
                    let boundary_bands = prof.boundary.bands();
                    let abl_bands =
                        compute_abl_bands(prof.abl_enabled, prof.abl_strength, guard.app_volume);

                    let right_src = if prof.dual_mono {
                        &prof.right
                    } else {
                        &prof.left
                    };

                    let mut idx_l = 0usize;
                    for b in prof
                        .left
                        .bands
                        .iter()
                        .chain(boundary_bands.iter())
                        .chain(abl_bands.iter())
                    {
                        if b.enabled && idx_l < MAX_BIQUADS_PER_CH {
                            next_bank.coeffs_l[idx_l] = BiquadCoeffs::from_band(b, sr);
                            idx_l += 1;
                        }
                    }
                    next_bank.count_l = idx_l;

                    let mut idx_r = 0usize;
                    for b in right_src
                        .bands
                        .iter()
                        .chain(boundary_bands.iter())
                        .chain(abl_bands.iter())
                    {
                        if b.enabled && idx_r < MAX_BIQUADS_PER_CH {
                            next_bank.coeffs_r[idx_r] = BiquadCoeffs::from_band(b, sr);
                            idx_r += 1;
                        }
                    }
                    next_bank.count_r = idx_r;

                    let extra: Vec<_> = boundary_bands.into_iter().chain(abl_bands).collect();
                    let preamp_db = if prof.auto_preamp {
                        let p_l = compute_auto_preamp_db(&prof.left.bands, &extra, sr);
                        let p_r = if prof.dual_mono {
                            compute_auto_preamp_db(&prof.right.bands, &extra, sr)
                        } else {
                            p_l
                        };
                        p_l.min(p_r)
                    } else {
                        prof.left.preamp_db.min(right_src.preamp_db)
                    };
                    next_bank.preamp_lin = 10.0_f64.powf(preamp_db / 20.0);

                    if guard.store.level_match_bypass {
                        // Compensate average loudness drop/boost so toggling A/B feels volume-matched
                        let probe_freqs = [125.0_f32, 250.0, 500.0, 1000.0, 2000.0, 4000.0];
                        let avg_eq = combined_response_db(&prof.left.bands, &extra, &probe_freqs, sr)
                            .into_iter()
                            .sum::<f32>() as f64
                            / probe_freqs.len() as f64;
                        let net_shift = preamp_db + avg_eq;
                        level_match_db = (-net_shift).clamp(-3.0, 9.0);
                    }
                }
            }
        }

        for i in 0..MAX_BIQUADS_PER_CH {
            self.filters_l[i].set_coeffs(next_bank.coeffs_l[i]);
            self.filters_r[i].set_coeffs(next_bank.coeffs_r[i]);
        }
        self.bank = next_bank;

        let adaptive_db = if guard.bypass_all_for_calibration {
            0.0
        } else {
            guard.ambient_gain_db as f64 + guard.duck_gain_db as f64
        };

        let total_master_db = level_match_db + adaptive_db;
        self.target_master_lin = 10.0_f64.powf(total_master_db / 20.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::DspStore;

    #[test]
    fn dsp_processor_runs_without_nans_and_produces_spectrum() {
        let store = DspStore::default();
        let shared = SharedDspState::new(store, 0.5);
        let mut proc = DspProcessor::new(48_000.0, shared);

        let mut buf = vec![0.0_f32; 2048 * 2];
        for (i, frame) in buf.chunks_exact_mut(2).enumerate() {
            let s = 0.5 * (2.0 * std::f32::consts::PI * 100.0 * i as f32 / 48_000.0).sin();
            frame[0] = s;
            frame[1] = s;
        }
        proc.process_interleaved(&mut buf);
        assert!(buf.iter().all(|v| v.is_finite() && v.abs() <= 1.0));
        let (bars, rms) = proc.sample_telemetry();
        assert!(rms > -30.0);
        assert!(bars.iter().any(|&b| b > 0.1));
    }
}

