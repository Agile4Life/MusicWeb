use tokio::sync::mpsc;

use bs_dsp::{AdaptiveConfig, AdaptiveTelemetry, DspStore, MeasuredResponse, SweepChannel};

#[derive(Debug, Clone)]
pub enum AudioCommand {
    Load {
        generation: u64,
        url: String,
        title: String,
        artist: String,
        album: String,
        cover_url: Option<String>,
    },
    Play,
    Pause,
    Stop,
    Seek(f64),
    SetVolume(f64),
    SetMuted(bool),
    Shutdown,

    // DSP, Room Calibration & Adaptive Audio
    SetDspStore(DspStore),
    SetAdaptiveConfig(AdaptiveConfig),
    RecordVolumePreference(f32),
    RefreshDevices,
    StartNoiseCheck {
        mic_name: Option<String>,
    },
    StartPinkNoise {
        output_name: Option<String>,
        channel: SweepChannel,
        volume: f32,
    },
    StopTestTone,
    RunSweep {
        mic_name: Option<String>,
        output_name: Option<String>,
        channel: SweepChannel,
        duration_sec: f64,
        volume: f32,
        mic_cal_points: Option<Vec<(f64, f64)>>,
        mic_cal_name: Option<String>,
    },
    PlaySpeakerPinkNoise {
        output_name: Option<String>,
        channel: SweepChannel,
        duration_sec: f64,
        volume: f32,
    },
    PlaySpeakerSyncedSweep {
        output_name: Option<String>,
        channel: SweepChannel,
        duration_sec: f64,
        volume: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteCmd {
    Play,
    Pause,
    TogglePlayPause,
    Next,
    Previous,
    Seek(i64),
}

#[derive(Debug, Clone)]
pub enum AudioEvent {
    Opened { generation: u64, duration: f64 },
    StateChanged { generation: u64, playing: bool, buffering: bool },
    Position { generation: u64, current: f64, duration: f64 },
    Ended { generation: u64 },
    Failed { generation: u64, message: String },
    Remote(RemoteCmd),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SignalPathInfo {
    pub codec_label: String,
    pub source_sample_rate: u32,
    pub source_bits: Option<u32>,
    pub output_sample_rate: u32,
    pub output_format: String,
    pub exclusive: bool,
    pub bit_exact: bool,
    pub resampled: bool,
    pub software_volume_locked: bool,
    pub device_name: String,
    pub fallback_note: Option<String>,
}

#[derive(Debug, Clone)]
pub enum DspUiEvent {
    Spectrum([f32; 24]),
    OutputDeviceChanged(String),
    DevicesListed {
        outputs: Vec<String>,
        inputs: Vec<String>,
        default_output: Option<String>,
        default_input: Option<String>,
    },
    BackendMode {
        using_dsp: bool,
        reason: Option<String>,
    },
    SignalPath(SignalPathInfo),
    MicLevel {
        rms_dbfs: f32,
        peak_dbfs: f32,
        clipping: bool,
    },
    SweepProgress {
        progress: f32,
        stage: String,
    },
    SweepCompleted(Result<MeasuredResponse, String>),
    SpeakerPlaybackStarted {
        out_sample_rate: u32,
        duration_sec: f64,
    },
    SpeakerPlaybackDone(Result<(), String>),
    AdaptiveStatus(AdaptiveTelemetry),
}

#[derive(Clone)]
pub struct AudioHandle {
    tx: mpsc::UnboundedSender<AudioCommand>,
}

impl AudioHandle {
    pub fn new(tx: mpsc::UnboundedSender<AudioCommand>) -> Self {
        Self { tx }
    }

    pub fn send(&self, cmd: AudioCommand) {
        let _ = self.tx.send(cmd);
    }
}
