use std::f64::consts::PI;

use crate::types::AdaptiveConfig;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AdaptiveTelemetry {
    pub raw_mic_dbfs: f32,
    pub room_dbfs: f32,
    pub applied_ambient_db: f32,
    pub ducking_active: bool,
    pub applied_duck_db: f32,
    pub mic_active: bool,
}

impl Default for AdaptiveTelemetry {
    fn default() -> Self {
        Self {
            raw_mic_dbfs: -80.0,
            room_dbfs: -75.0,
            applied_ambient_db: 0.0,
            ducking_active: false,
            applied_duck_db: 0.0,
            mic_active: false,
        }
    }
}

/// Echo-compensated Apple Adaptive Audio engine:
/// 1) Ambient Auto-Volume (Personalized Volume): learns preferred gain vs ambient noise.
/// 2) Conversation Ducking: bandpass speech-band VAD (300–3400 Hz) comparing mic energy
///    against estimated speaker echo leakage so music vocals don't false-trigger.
#[derive(Debug, Clone)]
pub struct AdaptiveEngine {
    sample_rate: f64,
    ambient_ema_pow: f64,
    speech_floor_pow: f64,
    echo_leakage_coeff: f64,
    speech_hold_frames: u32,
    silence_frames: u32,
    ducking_active: bool,
    applied_ambient_db: f32,
    applied_duck_db: f32,
    last_room_dbfs: f32,
    // 2nd-order cascade HP/LP for 300..3400 Hz speech band
    hp_z1: f64,
    hp_z2: f64,
    lp_z1: f64,
    lp_z2: f64,
}

impl AdaptiveEngine {
    pub fn new(sample_rate: f64) -> Self {
        Self {
            sample_rate: sample_rate.max(8000.0),
            ambient_ema_pow: 1e-6,
            speech_floor_pow: 3e-7,
            echo_leakage_coeff: 0.0005,
            speech_hold_frames: 0,
            silence_frames: 0,
            ducking_active: false,
            applied_ambient_db: 0.0,
            applied_duck_db: 0.0,
            last_room_dbfs: -65.0,
            hp_z1: 0.0,
            hp_z2: 0.0,
            lp_z1: 0.0,
            lp_z2: 0.0,
        }
    }

    pub fn set_sample_rate(&mut self, sr: f64) {
        self.sample_rate = sr.max(8000.0);
    }

    pub fn reset(&mut self) {
        self.ambient_ema_pow = 1e-6;
        self.speech_floor_pow = 3e-7;
        self.echo_leakage_coeff = 0.0005;
        self.speech_hold_frames = 0;
        self.silence_frames = 0;
        self.ducking_active = false;
        self.applied_ambient_db = 0.0;
        self.applied_duck_db = 0.0;
    }

    /// Processes a chunk of microphone audio (`1024` samples typical) given the current
    /// volume-scaled digital playback RMS level in dBFS (`playback_rms_dbfs`).
    pub fn process_mic_frame(
        &mut self,
        mic_samples: &[f32],
        playback_rms_dbfs: f32,
        cfg: &AdaptiveConfig,
    ) -> AdaptiveTelemetry {
        if mic_samples.is_empty() || (!cfg.ambient_enabled && !cfg.ducking_enabled) {
            self.applied_ambient_db = 0.0;
            self.applied_duck_db = 0.0;
            self.ducking_active = false;
            return AdaptiveTelemetry::default();
        }

        let mut total_pow = 0.0_f64;
        let mut speech_pow = 0.0_f64;
        for &s in mic_samples {
            let x = s as f64;
            total_pow += x * x;
            let bp = self.bandpass_speech(x);
            speech_pow += bp * bp;
        }
        let n = mic_samples.len() as f64;
        let mic_pow = (total_pow / n).max(1e-10);
        let speech_band_pow = (speech_pow / n).max(1e-10);
        let raw_mic_dbfs = (10.0 * mic_pow.max(1e-9).log10()) as f32;
        let speech_dbfs = 10.0 * speech_band_pow.max(1e-9).log10();

        // Conservative echo-level compensation:
        // Never blindly subtract more than 45% of mic energy, and shrink coupling if mic is quieter
        // than playback (prevents collapsing real room readings down to -80 dBFS).
        let playback_pow = if cfg.headphone_mode || playback_rms_dbfs <= -72.0 {
            0.0
        } else {
            10.0_f64.powf(playback_rms_dbfs as f64 / 10.0)
        };

        let expected_echo_pow = if playback_pow > 1e-7 {
            let observed_ratio = (mic_pow / playback_pow).clamp(0.0, 0.05);
            if mic_pow < playback_pow * self.echo_leakage_coeff {
                self.echo_leakage_coeff = (observed_ratio * 0.25).clamp(0.0, 0.015);
            } else if !self.ducking_active {
                // Slowly track acoustic leakage below quiet floor
                let target_c = (observed_ratio * 0.30).clamp(0.0, 0.015);
                self.echo_leakage_coeff += 0.01 * (target_c - self.echo_leakage_coeff);
            }
            (playback_pow * self.echo_leakage_coeff).min(mic_pow * 0.45)
        } else {
            0.0
        };

        let residual_pow = (mic_pow - expected_echo_pow).max(1e-9);
        let frame_sec = (n / self.sample_rate).clamp(0.005, 0.2);

        // Update baseline slowly (freeze upward drift while speech ducking is active)
        let alpha_amb = 1.0 - (-frame_sec / 1.2).exp();
        if !self.ducking_active || residual_pow < self.ambient_ema_pow {
            self.ambient_ema_pow += alpha_amb * (residual_pow - self.ambient_ema_pow);
        }
        let alpha_sp = 1.0 - (-frame_sec / 2.2).exp();
        if !self.ducking_active || speech_band_pow < self.speech_floor_pow {
            self.speech_floor_pow += alpha_sp * (speech_band_pow - self.speech_floor_pow);
        }

        let room_dbfs = (10.0 * self.ambient_ema_pow.max(1e-9).log10()) as f32;
        self.last_room_dbfs = room_dbfs;

        // 1) Ambient Auto-Volume (Personalized Volume)
        if cfg.ambient_enabled {
            let target_db = compute_ambient_gain_db(room_dbfs, cfg);
            let alpha_g = (1.0 - (-frame_sec / 1.0).exp()) as f32;
            self.applied_ambient_db += alpha_g * (target_db - self.applied_ambient_db);
        } else {
            self.applied_ambient_db = 0.0;
        }

        // 2) Conversation Ducking (Bandpass speech burst above baseline + residual echo)
        if cfg.ducking_enabled {
            let speech_ratio = speech_band_pow / mic_pow.max(1e-9);
            let baseline = (self.speech_floor_pow + expected_echo_pow * 0.9).max(1e-9);
            let speech_excess_db = 10.0 * (speech_band_pow / baseline).max(1e-6).log10();

            let sens = cfg.ducking_sensitivity.clamp(0.1, 1.0) as f64;
            let trigger_db = 10.5 - 6.0 * sens; // +4.5 dB at 100%, +6.9 dB at 60%, +9.9 dB at 10%
            let is_speech =
                speech_ratio > 0.26 && speech_excess_db > trigger_db && speech_dbfs > -54.0;

            if is_speech {
                self.speech_hold_frames = self.speech_hold_frames.saturating_add(1);
                self.silence_frames = 0;
                // ~100 ms sustained speech before triggering duck
                let onset_frames = ((0.10 / frame_sec).round() as u32).max(2);
                if self.speech_hold_frames >= onset_frames {
                    self.ducking_active = true;
                }
            } else {
                self.speech_hold_frames = 0;
                if self.ducking_active {
                    self.silence_frames = self.silence_frames.saturating_add(1);
                    let release_frames =
                        ((cfg.ducking_release_sec.clamp(1.0, 8.0) as f64 / frame_sec).round() as u32)
                            .max(10);
                    if self.silence_frames >= release_frames {
                        self.ducking_active = false;
                        self.silence_frames = 0;
                    }
                }
            }

            let target_duck = if self.ducking_active {
                -cfg.ducking_depth_db.clamp(3.0, 28.0)
            } else {
                0.0
            };
            let tau = if self.ducking_active { 0.11 } else { 0.22 };
            let alpha_d = (1.0 - (-frame_sec / tau).exp()) as f32;
            self.applied_duck_db += alpha_d * (target_duck - self.applied_duck_db);
        } else {
            self.ducking_active = false;
            self.applied_duck_db = 0.0;
        }

        AdaptiveTelemetry {
            raw_mic_dbfs,
            room_dbfs,
            applied_ambient_db: self.applied_ambient_db,
            ducking_active: self.ducking_active,
            applied_duck_db: self.applied_duck_db,
            mic_active: true,
        }
    }

    pub fn last_room_dbfs(&self) -> f32 {
        self.last_room_dbfs
    }

    #[inline]
    fn bandpass_speech(&mut self, x: f64) -> f64 {
        let hp_rc = 1.0 / (2.0 * PI * 300.0);
        let dt = 1.0 / self.sample_rate;
        let a_hp = hp_rc / (hp_rc + dt);
        let hp = a_hp * (self.hp_z1 + x - self.hp_z2);
        self.hp_z2 = x;
        self.hp_z1 = hp;

        let lp_rc = 1.0 / (2.0 * PI * 3400.0);
        let a_lp = dt / (lp_rc + dt);
        let lp = self.lp_z1 + a_lp * (hp - self.lp_z1);
        self.lp_z1 = lp;
        self.lp_z2 = lp;
        lp
    }
}

fn compute_ambient_gain_db(room_dbfs: f32, cfg: &AdaptiveConfig) -> f32 {
    let strength = cfg.ambient_strength.clamp(0.0, 1.0);
    let max_boost = cfg.ambient_max_boost_db.clamp(0.0, 9.0);
    // Quiet Windows mic <= -58 dBFS -> 0 dB, noisy -28 dBFS -> +max_boost
    let norm = ((room_dbfs + 58.0) / 30.0).clamp(0.0, 1.0);
    let base_db = norm * max_boost * strength;

    if cfg.learned_points.is_empty() {
        return base_db;
    }
    let mut w_sum = 0.0_f32;
    let mut pref_sum = 0.0_f32;
    for &(pt_db, pt_vol) in &cfg.learned_points {
        let dist = ((pt_db - room_dbfs) / 8.0).powi(2);
        let w = (-dist).exp();
        let delta_db = (pt_vol.clamp(0.05, 1.0) - 0.70) * 10.0;
        w_sum += w;
        pref_sum += w * delta_db;
    }
    let learned_nudge = if w_sum > 0.05 {
        (pref_sum / w_sum) * 0.5 * strength
    } else {
        0.0
    };
    (base_db + learned_nudge).clamp(-4.0, max_boost)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adaptive_engine_ducks_on_quiet_room_speech_and_recovers() {
        let mut eng = AdaptiveEngine::new(48_000.0);
        let cfg = AdaptiveConfig {
            ambient_enabled: true,
            ducking_enabled: true,
            ducking_sensitivity: 0.75,
            ducking_depth_db: 14.0,
            ducking_release_sec: 1.0,
            ..Default::default()
        };

        // Quiet room ~ -68 dBFS (still below old -62 dBFS broken gate!)
        let quiet = vec![0.0004_f32; 1024];
        for _ in 0..45 {
            let t = eng.process_mic_frame(&quiet, -25.0, &cfg);
            assert!(!t.ducking_active);
        }

        // Moderate speech-band voice ~ -24 dBFS
        let speech: Vec<f32> = (0..1024)
            .map(|i| 0.08 * (2.0 * std::f32::consts::PI * 950.0 * i as f32 / 48_000.0).sin())
            .collect();
        let mut ducked = false;
        for _ in 0..30 {
            let t = eng.process_mic_frame(&speech, -25.0, &cfg);
            if t.ducking_active && t.applied_duck_db < -5.0 {
                ducked = true;
            }
        }
        assert!(ducked, "Expected speech burst in quiet room to activate ducking");

        for _ in 0..110 {
            eng.process_mic_frame(&quiet, -25.0, &cfg);
        }
        let end = eng.process_mic_frame(&quiet, -25.0, &cfg);
        assert!(!end.ducking_active);
        assert!(end.applied_duck_db > -1.0);
    }

    #[test]
    fn loud_playback_does_not_crush_room_dbfs_reading() {
        let mut eng = AdaptiveEngine::new(48_000.0);
        let cfg = AdaptiveConfig {
            ambient_enabled: true,
            ambient_strength: 0.8,
            ..Default::default()
        };
        // -40 dBFS ambient room signal while digital playback is loud (-10 dBFS)
        let room: Vec<f32> = (0..1024)
            .map(|i| 0.014 * (2.0 * std::f32::consts::PI * 180.0 * i as f32 / 48_000.0).sin())
            .collect();
        let mut last = AdaptiveTelemetry::default();
        for _ in 0..80 {
            last = eng.process_mic_frame(&room, -10.0, &cfg);
        }
        assert!(
            last.room_dbfs > -50.0,
            "room_dbfs collapsed to {}",
            last.room_dbfs
        );
        assert!(
            last.applied_ambient_db > 0.3,
            "expected positive ambient boost, got {}",
            last.applied_ambient_db
        );
    }
}
