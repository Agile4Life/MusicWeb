use std::f64::consts::PI;

use crate::types::{EqBand, FilterKind};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BiquadCoeffs {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
}

impl Default for BiquadCoeffs {
    fn default() -> Self {
        Self::bypass()
    }
}

impl BiquadCoeffs {
    pub const fn bypass() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    /// RBJ Audio EQ Cookbook formulas in double precision (`f64`).
    pub fn from_band(band: &EqBand, sample_rate: f64) -> Self {
        if !band.enabled || sample_rate <= 100.0 {
            return Self::bypass();
        }
        if matches!(
            band.kind,
            FilterKind::Peaking | FilterKind::LowShelf | FilterKind::HighShelf
        ) && band.gain_db.abs() < 1e-4
        {
            return Self::bypass();
        }

        let nyquist = sample_rate * 0.49;
        let fc = band.freq_hz.clamp(10.0, nyquist.max(20.0));
        let q = band.q.clamp(0.15, 20.0);
        let w0 = 2.0 * PI * fc / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let a = 10.0_f64.powf(band.gain_db / 40.0);

        let (b0, b1, b2, a0, a1, a2) = match band.kind {
            FilterKind::Peaking => {
                let alpha = sin_w0 / (2.0 * q);
                (
                    1.0 + alpha * a,
                    -2.0 * cos_w0,
                    1.0 - alpha * a,
                    1.0 + alpha / a,
                    -2.0 * cos_w0,
                    1.0 - alpha / a,
                )
            }
            FilterKind::LowShelf => {
                let alpha = sin_w0 / 2.0 * ((a + 1.0 / a) * (1.0 / q - 1.0) + 2.0).max(0.0).sqrt();
                let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0),
                    a * ((a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha),
                    (a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0),
                    (a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha,
                )
            }
            FilterKind::HighShelf => {
                let alpha = sin_w0 / 2.0 * ((a + 1.0 / a) * (1.0 / q - 1.0) + 2.0).max(0.0).sqrt();
                let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0),
                    a * ((a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha),
                    (a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha,
                    2.0 * ((a - 1.0) - (a + 1.0) * cos_w0),
                    (a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha,
                )
            }
            FilterKind::LowPass => {
                let alpha = sin_w0 / (2.0 * q);
                (
                    (1.0 - cos_w0) * 0.5,
                    1.0 - cos_w0,
                    (1.0 - cos_w0) * 0.5,
                    1.0 + alpha,
                    -2.0 * cos_w0,
                    1.0 - alpha,
                )
            }
            FilterKind::HighPass => {
                let alpha = sin_w0 / (2.0 * q);
                (
                    (1.0 + cos_w0) * 0.5,
                    -(1.0 + cos_w0),
                    (1.0 + cos_w0) * 0.5,
                    1.0 + alpha,
                    -2.0 * cos_w0,
                    1.0 - alpha,
                )
            }
        };

        if a0.abs() < 1e-18 {
            return Self::bypass();
        }
        let inv_a0 = 1.0 / a0;
        Self {
            b0: b0 * inv_a0,
            b1: b1 * inv_a0,
            b2: b2 * inv_a0,
            a1: a1 * inv_a0,
            a2: a2 * inv_a0,
        }
    }

    /// Exact steady-state frequency magnitude response in dB at `freq_hz`.
    pub fn magnitude_db(&self, freq_hz: f64, sample_rate: f64) -> f64 {
        let w = 2.0 * PI * freq_hz / sample_rate;
        let cos1 = w.cos();
        let sin1 = w.sin();
        let cos2 = (2.0 * w).cos();
        let sin2 = (2.0 * w).sin();

        let num_re = self.b0 + self.b1 * cos1 + self.b2 * cos2;
        let num_im = -(self.b1 * sin1 + self.b2 * sin2);
        let den_re = 1.0 + self.a1 * cos1 + self.a2 * cos2;
        let den_im = -(self.a1 * sin1 + self.a2 * sin2);

        let num_sq = num_re * num_re + num_im * num_im;
        let den_sq = (den_re * den_re + den_im * den_im).max(1e-24);
        10.0 * (num_sq / den_sq).max(1e-24).log10()
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct BiquadFilter {
    coeffs: BiquadCoeffs,
    z1: f64,
    z2: f64,
}

impl BiquadFilter {
    pub const fn new() -> Self {
        Self {
            coeffs: BiquadCoeffs::bypass(),
            z1: 0.0,
            z2: 0.0,
        }
    }

    pub fn set_coeffs(&mut self, coeffs: BiquadCoeffs) {
        self.coeffs = coeffs;
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    #[inline]
    pub fn process(&mut self, input: f64) -> f64 {
        let c = &self.coeffs;
        let mut out = c.b0 * input + self.z1;
        let mut next_z1 = c.b1 * input - c.a1 * out + self.z2;
        let mut next_z2 = c.b2 * input - c.a2 * out;

        if next_z1.abs() < 1e-24 {
            next_z1 = 0.0;
        }
        if next_z2.abs() < 1e-24 {
            next_z2 = 0.0;
        }
        if !out.is_finite() {
            self.reset();
            out = input;
        } else {
            self.z1 = next_z1;
            self.z2 = next_z2;
        }
        out
    }
}

/// Evaluates the combined dB frequency response of `bands` + `extra_bands` over `freqs`.
pub fn combined_response_db(
    bands: &[EqBand],
    extra_bands: &[EqBand],
    freqs: &[f32],
    sample_rate: f64,
) -> Vec<f32> {
    let coeffs: Vec<BiquadCoeffs> = bands
        .iter()
        .chain(extra_bands.iter())
        .filter(|b| b.enabled)
        .map(|b| BiquadCoeffs::from_band(b, sample_rate))
        .collect();

    freqs
        .iter()
        .map(|&f| {
            let mut db = 0.0_f64;
            for c in &coeffs {
                db += c.magnitude_db(f as f64, sample_rate);
            }
            db as f32
        })
        .collect()
}

/// Computes safe negative preamp (`<= 0.0 dB`) so peak positive EQ boost does not clip at 0 dBFS.
pub fn compute_auto_preamp_db(bands: &[EqBand], extra_bands: &[EqBand], sample_rate: f64) -> f64 {
    let coeffs: Vec<BiquadCoeffs> = bands
        .iter()
        .chain(extra_bands.iter())
        .filter(|b| b.enabled)
        .map(|b| BiquadCoeffs::from_band(b, sample_rate))
        .collect();
    if coeffs.is_empty() {
        return 0.0;
    }
    let mut max_boost = 0.0_f64;
    for i in 0..96 {
        let t = i as f64 / 95.0;
        let freq = 20.0 * (1000.0_f64).powf(t);
        let mut db = 0.0;
        for c in &coeffs {
            db += c.magnitude_db(freq, sample_rate);
        }
        if db > max_boost {
            max_boost = db;
        }
    }
    if max_boost > 0.1 {
        -((max_boost + 0.5).min(24.0))
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rbj_peaking_and_shelves_match_exact_target_gain() {
        let sr = 48_000.0;
        let pk = EqBand::peaking(1000.0, 6.0, 2.0);
        let pk_c = BiquadCoeffs::from_band(&pk, sr);
        assert!((pk_c.magnitude_db(1000.0, sr) - 6.0).abs() < 0.05);
        assert!(pk_c.magnitude_db(100.0, sr).abs() < 0.15);

        let ls = EqBand::low_shelf(100.0, -4.5, 0.71);
        let ls_c = BiquadCoeffs::from_band(&ls, sr);
        assert!((ls_c.magnitude_db(20.0, sr) - (-4.5)).abs() < 0.15);
        assert!(ls_c.magnitude_db(10_000.0, sr).abs() < 0.05);

        let hs = EqBand::high_shelf(8000.0, 3.0, 0.71);
        let hs_c = BiquadCoeffs::from_band(&hs, sr);
        assert!((hs_c.magnitude_db(18_000.0, sr) - 3.0).abs() < 0.35);
    }

    #[test]
    fn auto_preamp_offsets_positive_peak_boost() {
        let bands = vec![EqBand::low_shelf(90.0, 5.5, 0.71)];
        let preamp = compute_auto_preamp_db(&bands, &[], 48_000.0);
        assert!(preamp <= -5.5);
        assert!(preamp >= -7.0);
    }
}

