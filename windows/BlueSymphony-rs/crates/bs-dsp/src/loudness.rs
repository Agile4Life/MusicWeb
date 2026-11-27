use crate::types::EqBand;

/// B&O ABL-inspired ISO 226 equal-loudness dynamic compensation.
/// When app volume is low (`< 0.80`), smoothly boosts sub-bass and ultra-highs;
/// at high listening volume, returns completely flat to prevent boom/harshness.
pub fn compute_abl_bands(enabled: bool, strength: f32, volume_0_1: f64) -> Vec<EqBand> {
    if !enabled || strength <= 0.01 {
        return Vec::new();
    }
    let s = (strength as f64).clamp(0.0, 1.0);
    let v = volume_0_1.clamp(0.05, 1.0);
    // Above 80% volume, loudness contour fades cleanly to 0 dB
    let low_factor = ((0.80 - v) / 0.65).clamp(0.0, 1.0).powf(1.25) * s;
    if low_factor <= 0.01 {
        return Vec::new();
    }
    let bass_db = 6.2 * low_factor;
    let treble_db = 2.4 * low_factor;
    vec![
        EqBand::low_shelf(82.0, bass_db, 0.71),
        EqBand::high_shelf(9500.0, treble_db, 0.71),
    ]
}

/// True-peak look-less soft limiter with smooth knee starting around -1.0 dBFS.
/// Guarantees output magnitude never exceeds ~0.995 even under strong EQ boosts.
#[derive(Debug, Clone, Copy)]
pub struct SoftLimiter {
    env: f64,
    attack_coeff: f64,
    release_coeff: f64,
}

impl SoftLimiter {
    pub fn new(sample_rate: f64) -> Self {
        let sr = sample_rate.max(8000.0);
        Self {
            env: 0.0,
            attack_coeff: (-1.0 / (0.0005 * sr)).exp(),
            release_coeff: (-1.0 / (0.060 * sr)).exp(),
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f64) {
        let sr = sample_rate.max(8000.0);
        self.attack_coeff = (-1.0 / (0.0005 * sr)).exp();
        self.release_coeff = (-1.0 / (0.060 * sr)).exp();
    }

    #[inline]
    pub fn process_stereo(&mut self, l: f64, r: f64) -> (f64, f64) {
        let peak = l.abs().max(r.abs());
        if peak > self.env {
            self.env = self.attack_coeff * self.env + (1.0 - self.attack_coeff) * peak;
        } else {
            self.env = self.release_coeff * self.env + (1.0 - self.release_coeff) * peak;
        }

        const THRESHOLD: f64 = 0.891; // ~ -1.0 dBFS
        let gain = if self.env > THRESHOLD {
            // Smooth asymptotic compression towards 0.985 ceiling
            let excess = self.env - THRESHOLD;
            let compressed = THRESHOLD + 0.094 * (excess / (0.094 + excess));
            compressed / self.env
        } else {
            1.0
        };

        (soft_saturate(l * gain), soft_saturate(r * gain))
    }
}

#[inline]
fn soft_saturate(x: f64) -> f64 {
    const KNEE: f64 = 0.96;
    const CEIL: f64 = 0.995;
    let ax = x.abs();
    if ax <= KNEE {
        x
    } else {
        let span = CEIL - KNEE;
        let scaled = ((ax - KNEE) / span).tanh();
        x.signum() * (KNEE + span * scaled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limiter_prevents_clipping_on_heavy_overdrive() {
        let mut lim = SoftLimiter::new(48_000.0);
        for i in 0..4000 {
            let sig = 4.0 * (i as f64 * 0.05).sin(); // +12 dBFS overload
            let (l, r) = lim.process_stereo(sig, -sig);
            assert!(l.abs() <= 0.996, "left clipped: {l}");
            assert!(r.abs() <= 0.996, "right clipped: {r}");
        }
    }

    #[test]
    fn abl_boosts_only_at_lower_volumes() {
        let low = compute_abl_bands(true, 1.0, 0.25);
        assert_eq!(low.len(), 2);
        assert!(low[0].gain_db > 3.0);

        let high = compute_abl_bands(true, 1.0, 0.95);
        assert!(high.is_empty());
    }
}

