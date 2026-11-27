pub mod backend;
pub mod controller;
pub mod hybrid;
pub mod mic_capture;
pub mod pcm_player;
pub mod ring;
pub mod wasapi_exclusive;
pub mod win_player;

pub use backend::{AudioCommand, AudioEvent, AudioHandle, DspUiEvent, RemoteCmd, SignalPathInfo};
pub use controller::{PlaybackCoordinator, PlayerAction, PlayerSnapshot};
pub use hybrid::spawn_hybrid_audio_backend;
pub use win_player::spawn_win_audio_backend;
