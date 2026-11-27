use std::fmt::Write;

use crate::biquad::compute_auto_preamp_db;
use crate::types::{ChannelEq, DspError, DspProfile, EqBand, FilterKind, MicCalibration};

/// Parses Equalizer APO / AutoEQ / Oratory1990 / REW `.txt` PEQ filter files.
pub fn parse_equalizer_apo(text: &str) -> Result<ChannelEq, DspError> {
    let mut preamp_db = 0.0_f64;
    let mut bands = Vec::new();

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('*') {
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("preamp:") {
            if let Some(val) = extract_first_number(&line["preamp:".len()..]) {
                preamp_db = val.clamp(-24.0, 24.0);
            }
            continue;
        }
        if lower.starts_with("filter") {
            if let Some(band) = parse_filter_line(line) {
                bands.push(band);
            }
        }
    }

    if bands.is_empty() {
        return Err(DspError::ParseError(
            "Không tìm thấy dòng `Filter ...` chuẩn Equalizer APO / AutoEQ".to_string(),
        ));
    }

    Ok(ChannelEq { bands, preamp_db })
}

fn parse_filter_line(line: &str) -> Option<EqBand> {
    // Examples:
    // Filter 1: ON PK Fc 105 Hz Gain -4.2 dB Q 1.80
    // Filter: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.71
    // Filter 2: OFF PEQ Fc 500 Hz Gain 0 dB Q 1.4
    let after_colon = line.split_once(':').map(|(_, rhs)| rhs).unwrap_or(line);
    let tokens: Vec<&str> = after_colon.split_whitespace().collect();
    if tokens.is_empty() {
        return None;
    }

    let mut idx = 0usize;
    let mut enabled = true;
    if tokens[idx].eq_ignore_ascii_case("ON") {
        enabled = true;
        idx += 1;
    } else if tokens[idx].eq_ignore_ascii_case("OFF") {
        enabled = false;
        idx += 1;
    }

    if idx >= tokens.len() {
        return None;
    }

    let kind_tok = tokens[idx].to_ascii_uppercase();
    let kind = match kind_tok.as_str() {
        "PK" | "PEQ" => FilterKind::Peaking,
        "LS" | "LSC" => FilterKind::LowShelf,
        "HS" | "HSC" => FilterKind::HighShelf,
        "LP" | "LPQ" => FilterKind::LowPass,
        "HP" | "HPQ" => FilterKind::HighPass,
        _ => return None,
    };
    idx += 1;

    let mut freq_hz = None;
    let mut gain_db = 0.0_f64;
    let mut q = 0.71_f64;

    while idx < tokens.len() {
        let key = tokens[idx].to_ascii_uppercase();
        match key.as_str() {
            "FC" => {
                if idx + 1 < tokens.len() {
                    if let Ok(v) = tokens[idx + 1].trim_end_matches("Hz").parse::<f64>() {
                        freq_hz = Some(v);
                    }
                    idx += 2;
                } else {
                    idx += 1;
                }
            }
            "GAIN" => {
                if idx + 1 < tokens.len() {
                    if let Ok(v) = tokens[idx + 1].trim_end_matches("dB").parse::<f64>() {
                        gain_db = v;
                    }
                    idx += 2;
                } else {
                    idx += 1;
                }
            }
            "Q" => {
                if idx + 1 < tokens.len() {
                    if let Ok(v) = tokens[idx + 1].parse::<f64>() {
                        q = v;
                    }
                    idx += 2;
                } else {
                    idx += 1;
                }
            }
            _ => idx += 1,
        }
    }

    let freq = freq_hz?.clamp(16.0, 22_000.0);
    Some(EqBand {
        enabled,
        kind,
        freq_hz: freq,
        gain_db: gain_db.clamp(-24.0, 24.0),
        q: q.clamp(0.15, 20.0),
    })
}

fn extract_first_number(s: &str) -> Option<f64> {
    s.split_whitespace().find_map(|tok| {
        tok.trim_end_matches("dB")
            .trim_end_matches("Hz")
            .parse::<f64>()
            .ok()
    })
}

/// Exports a `DspProfile` into system-wide Equalizer APO `config.txt` format.
pub fn export_equalizer_apo(profile: &DspProfile, sample_rate: f64) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "# BlueSymphony Acoustic Suite — Equalizer APO Export");
    let _ = writeln!(out, "# Profile: {}", profile.name);
    let _ = writeln!(out, "# Boundary Preset: {}", profile.boundary.label());

    let boundary_bands = profile.boundary.bands();
    let preamp_l = if profile.auto_preamp {
        compute_auto_preamp_db(&profile.left.bands, &boundary_bands, sample_rate)
    } else {
        profile.left.preamp_db
    };

    if !profile.dual_mono {
        let _ = writeln!(out, "Preamp: {preamp_l:.2} dB");
        write_apo_bands(&mut out, &profile.left.bands, &boundary_bands);
    } else {
        let preamp_r = if profile.auto_preamp {
            compute_auto_preamp_db(&profile.right.bands, &boundary_bands, sample_rate)
        } else {
            profile.right.preamp_db
        };
        let min_preamp = preamp_l.min(preamp_r);
        let _ = writeln!(out, "Preamp: {min_preamp:.2} dB");
        let _ = writeln!(out, "Channel: L");
        write_apo_bands(&mut out, &profile.left.bands, &boundary_bands);
        let _ = writeln!(out, "Channel: R");
        write_apo_bands(&mut out, &profile.right.bands, &boundary_bands);
    }

    out
}

fn write_apo_bands(out: &mut String, bands: &[EqBand], extra: &[EqBand]) {
    for (idx, band) in bands.iter().chain(extra.iter()).enumerate() {
        let state = if band.enabled { "ON" } else { "OFF" };
        let kind = match band.kind {
            FilterKind::Peaking => "PK",
            FilterKind::LowShelf => "LSC",
            FilterKind::HighShelf => "HSC",
            FilterKind::LowPass => "LPQ",
            FilterKind::HighPass => "HPQ",
        };
        let _ = writeln!(
            out,
            "Filter {}: {} {} Fc {:.1} Hz Gain {:.2} dB Q {:.3}",
            idx + 1,
            state,
            kind,
            band.freq_hz,
            band.gain_db,
            band.q
        );
    }
}

/// Parses UMIK-1 / REW `.txt` or `.cal` microphone calibration curve (`freq_hz offset_db`).
pub fn parse_mic_cal(name: &str, text: &str) -> Result<MicCalibration, DspError> {
    let mut points = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('*')
            || trimmed.starts_with('#')
            || trimmed.starts_with('"')
        {
            continue;
        }
        let mut parts = trimmed.split(|c: char| c.is_whitespace() || c == ',' || c == ';');
        let Some(f_str) = parts.next().filter(|s| !s.is_empty()) else {
            continue;
        };
        let Some(g_str) = parts.next().filter(|s| !s.is_empty()) else {
            continue;
        };
        if let (Ok(f), Ok(g)) = (f_str.parse::<f64>(), g_str.parse::<f64>()) {
            if f > 0.0 && f.is_finite() && g.is_finite() {
                points.push((f, g));
            }
        }
    }

    if points.len() < 4 {
        return Err(DspError::ParseError(
            "File hiệu chuẩn mic cần tối thiểu 4 điểm (tần số, dB)".to_string(),
        ));
    }

    points.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok(MicCalibration {
        name: name.to_string(),
        points,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equalizer_apo_round_trip_preserves_filters() {
        let profile = DspProfile::default();
        let exported = export_equalizer_apo(&profile, 48_000.0);
        let reparsed = parse_equalizer_apo(&exported).expect("reparse");
        assert_eq!(reparsed.bands.len(), profile.left.bands.len());
        for (a, b) in profile.left.bands.iter().zip(reparsed.bands.iter()) {
            assert_eq!(a.kind, b.kind);
            assert!((a.freq_hz - b.freq_hz).abs() < 0.2);
            assert!((a.gain_db - b.gain_db).abs() < 0.02);
            assert!((a.q - b.q).abs() < 0.01);
        }
        assert!(reparsed.preamp_db <= -2.5);
    }

    #[test]
    fn mic_cal_parser_reads_umik_format() {
        let raw = "* Sens Factor =-1.23dB\n\"90Deg calibration\"\n10.0 -2.1\n20.0 -0.8\n100.0 0.0\n1000.0 0.2\n20000.0 -0.5\n";
        let cal = parse_mic_cal("UMIK-1", raw).expect("cal parse");
        assert_eq!(cal.points.len(), 5);
        assert!((cal.interpolate_db(100.0) - 0.0).abs() < 1e-6);
        assert!((cal.interpolate_db(500.0) - 0.14).abs() < 0.1);
    }
}

