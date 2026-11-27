use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DspError {
    #[error("Không đọc được định dạng bộ lọc: {0}")]
    ParseError(String),
    #[error("Dữ liệu đo không hợp lệ: {0}")]
    InvalidMeasurement(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum FilterKind {
    #[default]
    Peaking,
    LowShelf,
    HighShelf,
    LowPass,
    HighPass,
}

impl FilterKind {
    pub const ALL: [Self; 5] = [
        Self::Peaking,
        Self::LowShelf,
        Self::HighShelf,
        Self::LowPass,
        Self::HighPass,
    ];

    pub fn short_label(self) -> &'static str {
        match self {
            Self::Peaking => "PK",
            Self::LowShelf => "LS",
            Self::HighShelf => "HS",
            Self::LowPass => "LP",
            Self::HighPass => "HP",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Peaking => "Peak",
            Self::LowShelf => "Low Shelf",
            Self::HighShelf => "High Shelf",
            Self::LowPass => "Low Pass",
            Self::HighPass => "High Pass",
        }
    }

    pub fn next(self) -> Self {
        match self {
            Self::Peaking => Self::LowShelf,
            Self::LowShelf => Self::HighShelf,
            Self::HighShelf => Self::LowPass,
            Self::LowPass => Self::HighPass,
            Self::HighPass => Self::Peaking,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EqBand {
    pub enabled: bool,
    pub kind: FilterKind,
    pub freq_hz: f64,
    pub gain_db: f64,
    pub q: f64,
}

impl EqBand {
    pub fn peaking(freq_hz: f64, gain_db: f64, q: f64) -> Self {
        Self {
            enabled: true,
            kind: FilterKind::Peaking,
            freq_hz: freq_hz.clamp(16.0, 22_000.0),
            gain_db: gain_db.clamp(-24.0, 24.0),
            q: q.clamp(0.2, 16.0),
        }
    }

    pub fn low_shelf(freq_hz: f64, gain_db: f64, q: f64) -> Self {
        Self {
            enabled: true,
            kind: FilterKind::LowShelf,
            freq_hz: freq_hz.clamp(16.0, 22_000.0),
            gain_db: gain_db.clamp(-24.0, 24.0),
            q: q.clamp(0.2, 16.0),
        }
    }

    pub fn high_shelf(freq_hz: f64, gain_db: f64, q: f64) -> Self {
        Self {
            enabled: true,
            kind: FilterKind::HighShelf,
            freq_hz: freq_hz.clamp(16.0, 22_000.0),
            gain_db: gain_db.clamp(-24.0, 24.0),
            q: q.clamp(0.2, 16.0),
        }
    }
}

/// Devialet ASC-inspired speaker boundary placement presets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum BoundaryPreset {
    #[default]
    None,
    FreeSpace,
    NearWall,
    Corner,
    DeskWood,
    Headphones,
}

impl BoundaryPreset {
    pub const ALL: [Self; 6] = [
        Self::None,
        Self::FreeSpace,
        Self::NearWall,
        Self::Corner,
        Self::DeskWood,
        Self::Headphones,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::None => "Tắt",
            Self::FreeSpace => "Giữa phòng",
            Self::NearWall => "Sát tường",
            Self::Corner => "Góc tường",
            Self::DeskWood => "Trên bàn gỗ",
            Self::Headphones => "Tai nghe",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::None => "Không bù cộng hưởng vị trí",
            Self::FreeSpace => "Loa đặt thoáng xa tường (+1.5 dB trầm sâu)",
            Self::NearWall => "Cắt ù phản xạ tường sau (-3.5 dB < 115 Hz)",
            Self::Corner => "Giảm mạnh cộng hưởng góc tường (-6 dB < 110 Hz)",
            Self::DeskWood => "Khử cộng hưởng mặt bàn 160 Hz & 380 Hz",
            Self::Headphones => "Bù nhẹ sub-bass 45 Hz & mở rộng độ thoáng",
        }
    }

    pub fn bands(self) -> Vec<EqBand> {
        match self {
            Self::None => Vec::new(),
            Self::FreeSpace => vec![EqBand::low_shelf(70.0, 1.5, 0.71)],
            Self::NearWall => vec![
                EqBand::low_shelf(115.0, -3.5, 0.71),
                EqBand::peaking(85.0, -1.2, 2.0),
            ],
            Self::Corner => vec![
                EqBand::low_shelf(110.0, -6.0, 0.71),
                EqBand::peaking(65.0, -2.5, 2.5),
                EqBand::peaking(140.0, -1.5, 2.2),
            ],
            Self::DeskWood => vec![
                EqBand::peaking(160.0, -3.2, 1.6),
                EqBand::peaking(380.0, -1.6, 2.0),
            ],
            Self::Headphones => vec![
                EqBand::low_shelf(55.0, 1.8, 0.75),
                EqBand::high_shelf(10_500.0, 1.0, 0.71),
            ],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum TargetCurveKind {
    #[default]
    HarmanInRoom,
    BkHouse,
    StudioFlat,
    WarmVocal,
}

impl TargetCurveKind {
    pub const ALL: [Self; 4] = [
        Self::HarmanInRoom,
        Self::BkHouse,
        Self::StudioFlat,
        Self::WarmVocal,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::HarmanInRoom => "Harman In-Room",
            Self::BkHouse => "B&K House",
            Self::StudioFlat => "Studio Flat",
            Self::WarmVocal => "Ấm áp / Vocal",
        }
    }

    /// Desired relative response in dB anchored at 1 kHz = 0 dB.
    pub fn target_db(self, freq_hz: f64) -> f64 {
        let f = freq_hz.clamp(20.0, 20_000.0);
        let log_1k = (f / 1000.0).log2();
        match self {
            Self::HarmanInRoom => {
                // Smooth +4.5 dB bass shelf below ~120 Hz and ~-0.8 dB/octave above 200 Hz
                let bass = 4.5 / (1.0 + (f / 105.0).powf(2.4));
                let tilt = if f > 200.0 { -0.75 * (f / 200.0).log2() } else { 0.0 };
                let ref_at_1k = 4.5 / (1.0 + (1000.0 / 105.0_f64).powf(2.4))
                    - 0.75 * (1000.0 / 200.0_f64).log2();
                (bass + tilt) - ref_at_1k
            }
            Self::BkHouse => {
                // Bruel & Kjaer 1974 room curve: smooth ~-1.0 dB/oct from 100 Hz upward, gentle bass warmth
                let raw = if f < 200.0 {
                    2.0 - 0.5 * (f / 200.0).log2()
                } else {
                    2.0 - 0.9 * (f / 200.0).log2()
                };
                let ref_at_1k = 2.0 - 0.9 * (1000.0 / 200.0_f64).log2();
                raw - ref_at_1k
            }
            Self::StudioFlat => {
                // Reference flat with very mild ultra-high roll-off above 12 kHz
                if f > 12_000.0 {
                    -1.2 * (f / 12_000.0).log2()
                } else {
                    0.0
                }
            }
            Self::WarmVocal => {
                let bass = 3.5 / (1.0 + (f / 135.0).powf(2.0));
                let vocal = 1.6 * (-((f.ln() - 1800.0_f64.ln()) / 0.65).powi(2)).exp();
                let highs = if log_1k > 0.0 { -1.1 * log_1k } else { 0.0 };
                let ref_at_1k = 3.5 / (1.0 + (1000.0 / 135.0_f64).powf(2.0))
                    + 1.6 * (-((1000.0_f64.ln() - 1800.0_f64.ln()) / 0.65).powi(2)).exp();
                (bass + vocal + highs) - ref_at_1k
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChannelEq {
    pub bands: Vec<EqBand>,
    pub preamp_db: f64,
}

impl Default for ChannelEq {
    fn default() -> Self {
        Self {
            bands: default_10_band_peq(),
            preamp_db: 0.0,
        }
    }
}

pub fn default_10_band_peq() -> Vec<EqBand> {
    const FREQS: [f64; 10] = [
        32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
    ];
    FREQS
        .iter()
        .enumerate()
        .map(|(i, &f)| {
            if i == 0 {
                EqBand::low_shelf(f, 0.0, 0.71)
            } else if i == FREQS.len() - 1 {
                EqBand::high_shelf(f, 0.0, 0.71)
            } else {
                EqBand::peaking(f, 0.0, 1.41)
            }
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MeasuredResponse {
    pub freqs: Vec<f32>,
    pub raw_db: Vec<f32>,
    pub smoothed_db: Vec<f32>,
    pub rt60_sec: f32,
    pub schroeder_hz: f32,
    pub points_count: u8,
    pub channel_label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MicCalibration {
    pub name: String,
    pub points: Vec<(f64, f64)>,
}

impl MicCalibration {
    pub fn interpolate_db(&self, freq_hz: f64) -> f64 {
        if self.points.is_empty() {
            return 0.0;
        }
        if freq_hz <= self.points[0].0 {
            return self.points[0].1;
        }
        let last = self.points[self.points.len() - 1];
        if freq_hz >= last.0 {
            return last.1;
        }
        let idx = self.points.partition_point(|&(f, _)| f < freq_hz);
        if idx == 0 {
            return self.points[0].1;
        }
        let (f0, g0) = self.points[idx - 1];
        let (f1, g1) = self.points[idx];
        if (f1 - f0).abs() < 1e-9 || f0 <= 0.0 || f1 <= 0.0 {
            return g0;
        }
        let t = ((freq_hz.ln() - f0.ln()) / (f1.ln() - f0.ln())).clamp(0.0, 1.0);
        g0 + (g1 - g0) * t
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct DspProfile {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub dual_mono: bool,
    pub left: ChannelEq,
    pub right: ChannelEq,
    pub auto_preamp: bool,
    pub boundary: BoundaryPreset,
    pub abl_enabled: bool,
    pub abl_strength: f32,
    pub target_curve: TargetCurveKind,
    pub measured_curve: Option<MeasuredResponse>,
}

impl Default for DspProfile {
    fn default() -> Self {
        Self {
            id: "default-harman".to_string(),
            name: "Mặc định (Harman nhẹ)".to_string(),
            enabled: true,
            dual_mono: false,
            left: ChannelEq {
                bands: vec![
                    EqBand::low_shelf(85.0, 2.5, 0.71),
                    EqBand::peaking(250.0, -0.8, 1.2),
                    EqBand::peaking(1000.0, 0.0, 1.41),
                    EqBand::peaking(3200.0, 1.0, 1.3),
                    EqBand::high_shelf(10_000.0, 0.8, 0.71),
                ],
                preamp_db: -3.0,
            },
            right: ChannelEq::default(),
            auto_preamp: true,
            boundary: BoundaryPreset::None,
            abl_enabled: true,
            abl_strength: 0.65,
            target_curve: TargetCurveKind::HarmanInRoom,
            measured_curve: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AdaptiveConfig {
    pub ambient_enabled: bool,
    pub ambient_strength: f32,
    pub ambient_max_boost_db: f32,
    pub ducking_enabled: bool,
    pub ducking_sensitivity: f32,
    pub ducking_depth_db: f32,
    pub ducking_release_sec: f32,
    pub mic_name: Option<String>,
    pub headphone_mode: bool,
    /// `(room_ambient_dbfs, preferred_volume_0_1)` pairs recorded from manual slider adjustments.
    pub learned_points: Vec<(f32, f32)>,
}

impl Default for AdaptiveConfig {
    fn default() -> Self {
        Self {
            ambient_enabled: false,
            ambient_strength: 0.65,
            ambient_max_boost_db: 5.0,
            ducking_enabled: false,
            ducking_sensitivity: 0.60,
            ducking_depth_db: 14.0,
            ducking_release_sec: 3.5,
            mic_name: None,
            headphone_mode: false,
            learned_points: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct DspStore {
    pub profiles: Vec<DspProfile>,
    pub active_profile_id: String,
    pub device_map: HashMap<String, String>,
    pub bypass: bool,
    pub level_match_bypass: bool,
    pub dsp_engine_enabled: bool,
    pub bit_perfect_enabled: bool,
    pub bit_perfect_device: Option<String>,
    pub bit_perfect_lock_volume: bool,
    pub adaptive: AdaptiveConfig,
}

impl Default for DspStore {
    fn default() -> Self {
        let harman = DspProfile::default();
        let flat = DspProfile {
            id: "studio-flat".to_string(),
            name: "Studio Flat".to_string(),
            enabled: true,
            dual_mono: false,
            left: ChannelEq {
                bands: default_10_band_peq(),
                preamp_db: 0.0,
            },
            right: ChannelEq::default(),
            auto_preamp: true,
            boundary: BoundaryPreset::None,
            abl_enabled: false,
            abl_strength: 0.5,
            target_curve: TargetCurveKind::StudioFlat,
            measured_curve: None,
        };
        let warm = DspProfile {
            id: "warm-vinyl".to_string(),
            name: "Bass Ấm / Đĩa Than".to_string(),
            enabled: true,
            dual_mono: false,
            left: ChannelEq {
                bands: vec![
                    EqBand::low_shelf(95.0, 3.8, 0.71),
                    EqBand::peaking(220.0, 0.8, 1.1),
                    EqBand::peaking(2200.0, 1.2, 1.2),
                    EqBand::high_shelf(9500.0, -1.2, 0.71),
                ],
                preamp_db: -4.3,
            },
            right: ChannelEq::default(),
            auto_preamp: true,
            boundary: BoundaryPreset::None,
            abl_enabled: true,
            abl_strength: 0.75,
            target_curve: TargetCurveKind::WarmVocal,
            measured_curve: None,
        };
        Self {
            profiles: vec![harman, flat, warm],
            active_profile_id: "default-harman".to_string(),
            device_map: HashMap::new(),
            bypass: false,
            level_match_bypass: true,
            dsp_engine_enabled: true,
            bit_perfect_enabled: false,
            bit_perfect_device: None,
            bit_perfect_lock_volume: true,
            adaptive: AdaptiveConfig::default(),
        }
    }
}

impl DspStore {
    pub fn active_profile(&self) -> Option<&DspProfile> {
        self.profiles
            .iter()
            .find(|p| p.id == self.active_profile_id)
            .or_else(|| self.profiles.first())
    }

    pub fn active_profile_mut(&mut self) -> Option<&mut DspProfile> {
        let id = self.active_profile_id.clone();
        if let Some(pos) = self.profiles.iter().position(|p| p.id == id) {
            self.profiles.get_mut(pos)
        } else {
            self.profiles.first_mut()
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum SweepChannel {
    #[default]
    Stereo,
    Left,
    Right,
}

impl fmt::Display for SweepChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Stereo => write!(f, "Stereo (L+R)"),
            Self::Left => write!(f, "Kênh Trái (L)"),
            Self::Right => write!(f, "Kênh Phải (R)"),
        }
    }
}

