use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use iced::widget::Id as WidgetId;
use iced::{Color, Point, Size, window};
use tokio::sync::mpsc;

use bs_audio::{AudioHandle, DspUiEvent, PlayerAction, PlayerSnapshot, SignalPathInfo};
use bs_core::api::ApiClient;
use bs_core::config::AppConfig;
use bs_core::library::TopTimeframe;
use bs_core::models::{
    Album, ArtistInfo, HistoryItem, Lyrics, Playlist, SoundCloudPlaylistSummary, TopItem, Track,
};
use bs_core::nct::NctClient;
use bs_core::resolver::StreamResolver;
use bs_core::session::{SessionSnapshot, SessionStore};
use bs_dsp::{
    AdaptiveTelemetry, AutoEqResult, BoundaryPreset, ChannelEq, DspStore, MeasuredResponse,
    MicCalibration, TargetCurveKind,
};
use bs_win::hotkeys::GlobalHotkeyManager;
use bs_win::taskbar::TaskbarToolbar;
use bs_win::tray::TrayController;

use crate::image_cache::{CachedArtwork, ImageCache};
use crate::router::{Route, Router};
use crate::settings::AppSettings;
use crate::theme::AppThemeKind;
use crate::widgets::motion::Spring;

pub const HEADER_SEARCH_INPUT_ID: &str = "bs-header-search";
pub const SEARCH_PAGE_INPUT_ID: &str = "bs-search-input";
pub const LYRICS_SCROLL_ID: &str = "bs-lyrics-scroll";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchScope {
    Nct,
    SoundCloud,
    Songs,
    Albums,
}

impl SearchScope {
    pub const ALL: [Self; 4] = [Self::Nct, Self::SoundCloud, Self::Songs, Self::Albums];

    pub fn label(self) -> &'static str {
        match self {
            Self::Nct => "NhacCuaTui",
            Self::SoundCloud => "SoundCloud",
            Self::Songs => "Quốc tế",
            Self::Albums => "Album",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ScShelf {
    pub tag: String,
    pub title: String,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthModalMode {
    SignIn,
    Register,
}

#[derive(Debug, Clone)]
pub struct AuthModalState {
    pub mode: AuthModalMode,
    pub account: String,
    pub password: String,
    pub real_email: String,
    pub loading: bool,
    pub error: Option<String>,
}

impl Default for AuthModalState {
    fn default() -> Self {
        Self {
            mode: AuthModalMode::SignIn,
            account: String::new(),
            password: String::new(),
            real_email: String::new(),
            loading: false,
            error: None,
        }
    }
}

#[derive(Debug, Clone)]
pub enum PlaylistEditorMode {
    Create,
    Edit { id: String },
}

#[derive(Debug, Clone)]
pub struct PlaylistEditorState {
    pub mode: PlaylistEditorMode,
    pub name: String,
    pub description: String,
    pub is_public: bool,
    pub loading: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ContextMenuState {
    pub track: Track,
    pub position: Point,
    pub playlist_id_context: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ToastState {
    pub message: String,
    pub is_error: bool,
    pub seq: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AudioLabTab {
    #[default]
    Eq,
    RoomCal,
    Adaptive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SweepChannelMode {
    #[default]
    Stereo,
    IndependentLR,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CalMicSource {
    #[default]
    WindowsMic,
    IPhoneCompanion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum IPhoneCalMode {
    #[default]
    MmmPinkNoise,
    SyncedFarinaEss,
}

#[derive(Debug, Clone)]
pub struct CalibrationState {
    pub step: u8,
    pub selected_mic: Option<String>,
    pub selected_output: Option<String>,
    pub uncalibrated_safe_mode: bool,
    pub mic_cal: Option<MicCalibration>,
    pub mic_rms_dbfs: f32,
    pub mic_peak_dbfs: f32,
    pub mic_clipping: bool,
    pub pink_noise_playing: bool,
    pub test_volume: f32,
    pub target_points: u8,
    pub channel_mode: SweepChannelMode,
    pub collected_l: Vec<MeasuredResponse>,
    pub collected_r: Vec<MeasuredResponse>,
    pub pending_right_next: bool,
    pub sweep_running: bool,
    pub sweep_progress: f32,
    pub sweep_stage: String,
    pub target_curve: TargetCurveKind,
    pub max_boost_db: f32,
    pub averaged_l: Option<MeasuredResponse>,
    pub averaged_r: Option<MeasuredResponse>,
    pub autoeq_l: Option<AutoEqResult>,
    pub autoeq_r: Option<AutoEqResult>,
    pub error: Option<String>,

    // iPhone HTTPS Companion calibration state
    pub mic_source: CalMicSource,
    pub iphone_mode: IPhoneCalMode,
    pub companion_url: Option<String>,
    pub companion_ca_url: Option<String>,
    pub companion_connected: bool,
    pub companion_device_label: Option<String>,
    pub companion_sample_rate: u32,
    pub companion_error: Option<String>,
    pub companion_seq: u64,
    pub companion_speaker_sr: u32,
    pub companion_active_channel: bs_dsp::SweepChannel,
}

impl Default for CalibrationState {
    fn default() -> Self {
        Self {
            step: 1,
            selected_mic: None,
            selected_output: None,
            uncalibrated_safe_mode: true,
            mic_cal: None,
            mic_rms_dbfs: -75.0,
            mic_peak_dbfs: -75.0,
            mic_clipping: false,
            pink_noise_playing: false,
            test_volume: 0.35,
            target_points: 1,
            channel_mode: SweepChannelMode::Stereo,
            collected_l: Vec::new(),
            collected_r: Vec::new(),
            pending_right_next: false,
            sweep_running: false,
            sweep_progress: 0.0,
            sweep_stage: String::new(),
            target_curve: TargetCurveKind::HarmanInRoom,
            max_boost_db: 3.0,
            averaged_l: None,
            averaged_r: None,
            autoeq_l: None,
            autoeq_r: None,
            error: None,
            mic_source: CalMicSource::WindowsMic,
            iphone_mode: IPhoneCalMode::MmmPinkNoise,
            companion_url: None,
            companion_ca_url: None,
            companion_connected: false,
            companion_device_label: None,
            companion_sample_rate: 48_000,
            companion_error: None,
            companion_seq: 0,
            companion_speaker_sr: 48_000,
            companion_active_channel: bs_dsp::SweepChannel::Stereo,
        }
    }
}

pub type WebLoginPayload = Option<(SessionSnapshot, HashMap<String, String>)>;

#[derive(Debug, Clone)]
pub enum Message {
    // Windows lifecycle & OS integration
    MainWindowOpened(window::Id),
    MiniWindowOpened(window::Id),
    MainWindowHwnd(isize),
    MiniWindowHwnd(isize),
    WindowCloseRequested(window::Id),
    WindowClosed(window::Id),
    WindowResized(window::Id, Size),
    ToggleMiniPlayer,
    DragMiniWindow,
    FocusMainWindow,
    SystemTick,
    AuroraTick,

    // Navigation
    Navigate(Route),
    GoBack,
    GoForward,
    ToggleSidebar,
    ToggleNowPlaying,
    ToggleNowPlayingLyrics,
    ToggleQueueDrawer,
    OpenArtist(String),
    ResolveAndOpenAlbum(Track),
    AlbumResolvedForTrack(Result<Option<Album>, String>),

    // Keyboard & cursor
    CursorMoved(Point),
    KeyPressed(iced::keyboard::Key, iced::keyboard::Modifiers),
    SpaceKeyChecked(bool),
    ScrollHorizontal(WidgetId, f32),
    CloseOverlays,

    // Player
    PlayerSnap(PlayerSnapshot),
    PlayTracks { tracks: Vec<Track>, start_at: usize },
    PlayTracksShuffled(Vec<Track>),
    JumpQueue(usize),
    TogglePlay,
    NextTrack,
    PrevTrack,
    SeekTo(f64),
    SetVolume(f64),
    ToggleMute,
    ToggleShuffle,
    CycleRepeat,
    PlayNext(Track),
    EnqueueTrack(Track),
    RemoveFromQueue(usize),
    MoveQueueItem { from: usize, to: usize },

    // Artwork cache
    ArtworkLoaded(String, Option<CachedArtwork>),

    // Home & Discovery
    RefreshHome,
    HomePublicLoaded {
        nct_title: String,
        nct: Vec<Track>,
        trending: Vec<Track>,
        albums: Vec<Album>,
        sc_shelves: Vec<ScShelf>,
        failed: bool,
    },
    HomePrivateLoaded {
        recent: Vec<Track>,
        favorites: Vec<Track>,
    },
    SelectSoundCloudHubTag(String),
    SoundCloudHubLoaded {
        tag: String,
        tracks: Vec<Track>,
        playlists: Vec<SoundCloudPlaylistSummary>,
    },
    OpenSoundCloudPlaylist(SoundCloudPlaylistSummary),
    SoundCloudPlaylistLoaded(Result<(Option<SoundCloudPlaylistSummary>, Vec<Track>), String>),
    AlbumLoaded(Result<Album, String>),
    ArtistLoaded(Result<(ArtistInfo, Vec<Track>), String>),

    // Search
    HeaderSearchChanged(String),
    HeaderSearchSubmit,
    SearchQueryChanged(String),
    SearchScopeChanged(SearchScope),
    RunSearchDebounced(u64),
    SearchCompleted {
        seq: u64,
        tracks: Vec<Track>,
        albums: Vec<Album>,
        failed: bool,
    },
    PickRecentSearch(String),
    ClearRecentSearches,

    // Auth & Session
    SessionRefreshed(SessionSnapshot, HashMap<String, String>),
    StartWebLogin,
    WebLoginFinished(Result<WebLoginPayload, String>),
    OpenAuthModal(AuthModalMode),
    CloseAuthModal,
    AuthModeChanged(AuthModalMode),
    AuthAccountChanged(String),
    AuthPasswordChanged(String),
    AuthRealEmailChanged(String),
    SubmitAuth,
    AuthCompleted(Result<(SessionSnapshot, HashMap<String, String>), String>),
    SignOut,
    SignedOut,

    // Favorites
    ToggleFavorite(Track),
    FavoriteToggled(Result<(SessionSnapshot, HashMap<String, String>, bool, String), String>),
    LoadFavorites,
    FavoritesLoaded(Result<Vec<Track>, String>),

    // History & Top
    LoadHistory,
    HistoryLoaded(Result<Vec<HistoryItem>, String>),
    DeleteHistoryItem(String),
    AskClearHistory(bool),
    ClearAllHistory,
    HistoryDeleted(Result<(), String>),
    LoadTopTracks(TopTimeframe),
    TopTracksLoaded(Result<(Vec<TopItem>, u32), String>),

    // Playlists
    LoadPlaylists,
    PlaylistsLoaded(Result<Vec<Playlist>, String>),
    LoadPlaylistDetail(String),
    PlaylistDetailLoaded(Result<(Option<Playlist>, Vec<Track>), String>),
    OpenCreatePlaylist,
    OpenEditPlaylist(Playlist),
    ClosePlaylistEditor,
    PlaylistEditorNameChanged(String),
    PlaylistEditorDescChanged(String),
    PlaylistEditorPublicToggled(bool),
    SavePlaylistEditor,
    PlaylistSaved(Result<Playlist, String>),
    DeletePlaylist(String),
    PlaylistDeleted(Result<String, String>),
    OpenPlaylistPicker(Track),
    ClosePlaylistPicker,
    AddTrackToPlaylist { playlist_id: String, track: Track },
    TrackAddedToPlaylist(Result<String, String>),
    RemoveTrackFromPlaylist { playlist_id: String, track_id: String },
    TrackRemovedFromPlaylist(Result<String, String>),

    // Lyrics
    LyricsLoaded { track_id: String, lyrics: Option<Lyrics> },
    ToggleRomaji,
    RomajiLoaded { track_id: String, romaji: Vec<String> },
    LyricsScrolled(f32),
    RecenterLyrics,
    ClickLyricLine { index: usize, time: f64 },

    // Context Menu & Toasts
    OpenContextMenu { track: Track, playlist_id: Option<String> },
    CloseContextMenu,
    DismissToast(u64),

    // Settings
    SelectTheme(AppThemeKind),
    ToggleGamingMode,
    ToggleCloseToTray(bool),
    ToggleGlobalHotkeys(bool),
    ClearCaches,
    CachesCleared,

    // Acoustic Suite: DSP, Auto-EQ, Room Calibration & Adaptive Audio
    DspEvent(DspUiEvent),
    SelectAudioLabTab(AudioLabTab),
    ToggleDspBypass,
    ToggleLevelMatchBypass,
    ToggleDspEngine(bool),
    ToggleBitPerfect(bool),
    SelectBitPerfectDevice(Option<String>),
    ToggleBitPerfectLockVolume(bool),
    SelectDspProfile(String),
    CreateDspProfile,
    DuplicateDspProfile,
    DeleteDspProfile(String),
    RenameDspProfile(String),
    ToggleAutoPreamp(bool),
    SetManualPreamp(f64),
    ToggleDualMono(bool),
    SelectEqChannel(bool),
    SelectEqBand(usize),
    EqBandUpdated {
        index: usize,
        freq_hz: f64,
        gain_db: f64,
        q: f64,
    },
    ToggleEqBandEnabled(usize),
    CycleEqBandKind(usize),
    AddEqBand,
    RemoveEqBand(usize),
    ResetEqBands,
    SelectBoundaryPreset(BoundaryPreset),
    ToggleAblLoudness(bool),
    SetAblStrength(f32),
    BindProfileToCurrentOutput,
    ImportAutoEqFile,
    AutoEqFileImported(Result<(String, ChannelEq), String>),
    ExportEqualizerApo,
    EqualizerApoExported(Result<String, String>),
    SaveDspProfiles,

    // Room Calibration Wizard
    CalSetStep(u8),
    CalRefreshDevices,
    CalSelectMic(String),
    CalSelectOutput(String),
    CalToggleSafeMode(bool),
    CalLoadMicFile,
    CalMicFileLoaded(Result<MicCalibration, String>),
    CalClearMicFile,
    CalTogglePinkNoise,
    CalSetTestVolume(f32),
    CalSetTargetPoints(u8),
    CalSetChannelMode(SweepChannelMode),
    CalStartSweep,
    CalResetSweeps,
    CalSetTargetCurve(TargetCurveKind),
    CalSetMaxBoost(f32),
    CalSaveAsProfile,
    CalPreviewToggle,
    CalSelectMicSource(CalMicSource),
    CalSelectIPhoneMode(IPhoneCalMode),
    CalRestartCompanion,
    CalCopyCompanionUrl,
    Companion(crate::companion::CompanionEvent),
    CompanionBeginSpeakerPlayback {
        seq: u64,
        mode: IPhoneCalMode,
        channel: bs_dsp::SweepChannel,
    },
    CompanionUploadTimeout(u64),
    RecomputeActiveProfileAutoEq,

    // Adaptive Audio
    AdaptiveSelectMic(Option<String>),
    AdaptiveToggleHeadphoneMode(bool),
    AdaptiveToggleAmbient(bool),
    AdaptiveSetAmbientStrength(f32),
    AdaptiveSetAmbientMaxBoost(f32),
    AdaptiveResetLearned,
    AdaptiveToggleDucking(bool),
    AdaptiveSetDuckSensitivity(f32),
    AdaptiveSetDuckDepth(f32),
    AdaptiveSetDuckRelease(f32),
}

pub struct AppState {
    pub main_window: Option<window::Id>,
    pub main_hwnd: Option<isize>,
    pub mini_window: Option<window::Id>,

    pub config: AppConfig,
    pub api: ApiClient,
    pub nct: NctClient,
    pub resolver: StreamResolver,
    pub session: SessionStore,
    pub player_tx: mpsc::UnboundedSender<PlayerAction>,
    pub audio_handle: AudioHandle,
    pub snap_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<PlayerSnapshot>>>>,
    pub dsp_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<DspUiEvent>>>>,
    pub companion_tx: mpsc::UnboundedSender<crate::companion::CompanionEvent>,
    pub companion_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<crate::companion::CompanionEvent>>>>,
    pub companion_handle: Option<crate::companion::CompanionHandle>,

    pub tray: Option<TrayController>,
    pub hotkeys: Option<GlobalHotkeyManager>,
    pub taskbar: Option<TaskbarToolbar>,

    pub session_snap: SessionSnapshot,
    pub known_db_ids: HashMap<String, String>,
    pub player: PlayerSnapshot,

    pub aurora_time: f32,
    pub aurora_current: [Color; 3],
    pub aurora_target: [Color; 3],

    pub image_cache: ImageCache,
    pub settings: AppSettings,
    pub cache_size_bytes: u64,

    pub router: Router,
    pub sidebar_collapsed: bool,
    pub show_now_playing: bool,
    pub show_lyrics: bool,
    pub show_queue: bool,

    // Search
    pub header_search: String,
    pub search_query: String,
    pub search_scope: SearchScope,
    pub search_seq: u64,
    pub search_tracks: Vec<Track>,
    pub search_albums: Vec<Album>,
    pub search_loading: bool,
    pub search_failed: bool,

    // Home & Public discovery
    pub nct_title: String,
    pub nct_tracks: Vec<Track>,
    pub trending_tracks: Vec<Track>,
    pub new_releases: Vec<Album>,
    pub sc_shelves: Vec<ScShelf>,
    pub recent_tracks: Vec<Track>,
    pub favorite_tracks: Vec<Track>,
    pub home_loading: bool,
    pub home_failed: bool,

    // SoundCloud Hub
    pub sc_hub_tag: String,
    pub sc_hub_tracks: Vec<Track>,
    pub sc_hub_playlists: Vec<SoundCloudPlaylistSummary>,
    pub sc_hub_loading: bool,
    pub sc_playlist_detail: Option<(SoundCloudPlaylistSummary, Vec<Track>)>,
    pub sc_playlist_loading: bool,
    pub sc_playlist_error: Option<String>,

    // Album & Artist
    pub album_detail: Option<Album>,
    pub album_loading: bool,
    pub album_error: Option<String>,
    pub artist_info: Option<ArtistInfo>,
    pub artist_tracks: Vec<Track>,
    pub artist_loading: bool,
    pub artist_error: Option<String>,

    // Library
    pub playlists: Vec<Playlist>,
    pub playlists_loading: bool,
    pub playlist_detail: Option<(Playlist, Vec<Track>)>,
    pub playlist_detail_loading: bool,
    pub favorites_list: Vec<Track>,
    pub favorites_loading: bool,
    pub history_items: Vec<HistoryItem>,
    pub history_loading: bool,
    pub confirm_clear_history: bool,
    pub top_items: Vec<TopItem>,
    pub top_total_plays: u32,
    pub top_timeframe: TopTimeframe,
    pub top_loading: bool,

    // Modals & overlays
    pub web_login_in_progress: bool,
    pub auth_modal: Option<AuthModalState>,
    pub playlist_editor: Option<PlaylistEditorState>,
    pub playlist_picker_track: Option<Track>,
    pub context_menu: Option<ContextMenuState>,
    pub cursor_pos: Point,
    pub toast: Option<ToastState>,
    pub toast_seq: u64,

    // Lyrics
    pub lyrics_track_id: Option<String>,
    pub lyrics: Option<Lyrics>,
    pub lyrics_romaji: Vec<String>,
    pub lyrics_loading: bool,
    pub last_scrolled_lyric: Option<usize>,

    // Silky 60 FPS UI & Lyrics Springs
    pub now_playing_spring: Spring,
    pub queue_spring: Spring,
    pub sidebar_spring: Spring,
    pub route_spring: Spring,
    pub toast_spring: Spring,
    pub overlay_spring: Spring,
    pub artwork_scale_spring: Spring,
    pub heart_spring: Spring,
    pub play_btn_spring: Spring,
    pub lyrics_active_spring: Spring,
    pub lyrics_scroll_spring: Spring,
    pub lyrics_scroll_target_y: f32,
    pub lyrics_user_scrolled_until: Option<std::time::Instant>,
    pub lyrics_last_programmatic_y: f32,
    pub lyrics_flash_idx: Option<(usize, f32)>,
    pub last_anim_instant: std::time::Instant,

    // Acoustic Suite (DSP, Room Calibration, Adaptive Audio)
    pub dsp_store: DspStore,
    pub spectrum_bars: [f32; 24],
    pub dsp_active_backend: bool,
    pub signal_path: Option<SignalPathInfo>,
    pub audio_lab_tab: AudioLabTab,
    pub editing_right_ch: bool,
    pub selected_eq_band: Option<usize>,
    pub current_output_device: Option<String>,
    pub available_outputs: Vec<String>,
    pub available_inputs: Vec<String>,
    pub cal: CalibrationState,
    pub adaptive_status: AdaptiveTelemetry,
}

pub fn format_duration(secs: f64) -> String {
    if !secs.is_finite() || secs <= 0.0 {
        return "0:00".to_string();
    }
    let total = secs.round() as u64;
    let mins = total / 60;
    let rem = total % 60;
    format!("{mins}:{rem:02}")
}
