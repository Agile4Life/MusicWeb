use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use iced::futures::sink::SinkExt;
use iced::keyboard::{self, Key, Modifiers, key::Named};
use iced::widget::operation;
use iced::widget::{Id, scrollable::AbsoluteOffset};
use iced::window::raw_window_handle::RawWindowHandle;
use iced::{Color, Element, Point, Size, Subscription, Task, Theme, stream, time, window};
use tokio::sync::mpsc;

use bs_audio::{
    AudioCommand, DspUiEvent, PlaybackCoordinator, PlayerAction, PlayerSnapshot,
    spawn_hybrid_audio_backend,
};
use bs_core::api::ApiClient;
use bs_core::config::AppConfig;
use bs_core::library::{LibraryApi, TopTimeframe};
use bs_core::lyrics::LyricsService;
use bs_core::models::{Album, Track};
use bs_core::nct::NctClient;
use bs_core::playlists::PlaylistApi;
use bs_core::resolver::StreamResolver;
use bs_core::session::SessionStore;
use bs_dsp::{
    AutoEqOptions, DspProfile, EqBand, SweepChannel, analyze_mmm_pink_noise,
    analyze_synced_sweep_rir, average_responses, default_10_band_peq, export_equalizer_apo,
    generate_synced_farina_ess, optimize_autoeq, parse_equalizer_apo, parse_mic_cal,
};
use bs_win::dwm::{BackdropKind, apply_rounded_corners, apply_titlebar_color, apply_window_style};
use bs_win::hotkeys::{GlobalHotkeyAction, GlobalHotkeyManager};
use bs_win::taskbar::{TaskbarAction, TaskbarToolbar};
use bs_win::tray::{TrayCommand, TrayController};

use crate::companion::{CompanionEvent, CompanionPhase, spawn_companion_server};
use crate::image_cache::ImageCache;
use crate::router::{Route, Router};
use crate::settings::AppSettings;
use crate::state::{
    AppState, AudioLabTab, AuthModalMode, AuthModalState, CalMicSource, CalibrationState,
    ContextMenuState, HEADER_SEARCH_INPUT_ID, IPhoneCalMode, LYRICS_SCROLL_ID, Message,
    PlaylistEditorMode, PlaylistEditorState, SEARCH_PAGE_INPUT_ID, ScShelf, SearchScope,
    SweepChannelMode, ToastState,
};
use crate::theme::{AppThemeKind, iced_theme};
use crate::views;
use crate::widgets::motion::Spring;

pub(crate) static APP_ICON_PNG: &[u8] = include_bytes!("../../../assets/icon-1024.png");

fn titlebar_rgb(theme: AppThemeKind) -> (u8, u8, u8) {
    match theme {
        AppThemeKind::AppleDark => (31, 31, 31),
        AppThemeKind::AuroraGlass => (13, 18, 32),
        AppThemeKind::MidnightDark => (15, 16, 22),
        AppThemeKind::VinylEditorial => (21, 17, 15),
    }
}

const SC_HOME_TAGS: &[(&str, &str)] = &[
    ("v-pop", "V-Pop trên SoundCloud"),
    ("rap viet", "Rap Việt"),
    ("lofi viet", "Lofi Việt"),
    ("remix viet", "Remix Việt"),
];

struct SubHandle(u64, Arc<Mutex<Option<mpsc::UnboundedReceiver<PlayerSnapshot>>>>);

impl Hash for SubHandle {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.0.hash(state);
    }
}

struct DspSubHandle(u64, Arc<Mutex<Option<mpsc::UnboundedReceiver<DspUiEvent>>>>);

impl Hash for DspSubHandle {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.0.hash(state);
    }
}

struct CompanionSubHandle(u64, Arc<Mutex<Option<mpsc::UnboundedReceiver<CompanionEvent>>>>);

impl Hash for CompanionSubHandle {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.0.hash(state);
    }
}

impl AppState {
    pub fn boot() -> (Self, Task<Message>) {
        let config = AppConfig::load();
        let settings = AppSettings::load(&config.settings_path());
        let mut dsp_store = AppSettings::load_dsp_store(&config.dsp_profiles_path());
        let mut upgraded = false;
        for prof in &mut dsp_store.profiles {
            if let Some(ref meas) = prof.measured_curve {
                let is_empty_dummy = prof
                    .left
                    .bands
                    .iter()
                    .all(|b| !b.enabled || b.gain_db.abs() < 0.01);
                if is_empty_dummy {
                    let res = optimize_autoeq(
                        meas,
                        &AutoEqOptions {
                            target: prof.target_curve,
                            max_bands: 12,
                            max_boost_db: 3.0,
                            max_cut_db: 12.0,
                            schroeder_hz: meas.schroeder_hz as f64,
                            uncalibrated_mic_safe_mode: true,
                            ..Default::default()
                        },
                    );
                    if !res.bands.is_empty() {
                        prof.left = bs_dsp::ChannelEq {
                            bands: res.bands,
                            preamp_db: res.preamp_db,
                        };
                        prof.auto_preamp = true;
                        upgraded = true;
                    }
                }
            }
        }
        if upgraded {
            AppSettings::save_dsp_store(&dsp_store, &config.dsp_profiles_path());
        }

        let api = ApiClient::new(&config).expect("HTTP client");
        let nct = NctClient::new(api.http().clone());
        let resolver = StreamResolver::new(api.clone(), nct.clone());
        let session = SessionStore::new(api.clone(), config.clone());

        let (audio_handle, audio_rx, dsp_rx) = spawn_hybrid_audio_backend(
            api.http().clone(),
            dsp_store.clone(),
            settings.volume,
        );
        let (companion_tx, companion_rx) = mpsc::unbounded_channel();
        let (player_tx, snap_rx) = PlaybackCoordinator::spawn(
            session.clone(),
            resolver.clone(),
            audio_handle.clone(),
            audio_rx,
            settings.volume,
            settings.muted,
        );

        let image_cache = ImageCache::new(config.image_cache_dir());
        let cache_size_bytes = image_cache.disk_usage_bytes();

        let (main_id, open_main) = window::open(main_window_settings(&settings));

        let player_init = PlayerSnapshot {
            volume: settings.volume,
            muted: settings.muted,
            ..Default::default()
        };

        let default_aurora = [
            Color::from_rgb8(56, 189, 248),
            Color::from_rgb8(139, 92, 246),
            Color::from_rgb8(236, 72, 153),
        ];

        let state = Self {
            main_window: Some(main_id),
            main_hwnd: None,
            mini_window: None,
            config,
            api: api.clone(),
            nct,
            resolver,
            session: session.clone(),
            player_tx,
            audio_handle,
            snap_rx: Arc::new(Mutex::new(Some(snap_rx))),
            dsp_rx: Arc::new(Mutex::new(Some(dsp_rx))),
            companion_tx,
            companion_rx: Arc::new(Mutex::new(Some(companion_rx))),
            companion_handle: None,
            tray: None,
            hotkeys: None,
            taskbar: None,
            session_snap: Default::default(),
            known_db_ids: Default::default(),
            player: player_init,
            aurora_time: 0.0,
            aurora_current: default_aurora,
            aurora_target: default_aurora,
            image_cache,
            settings,
            cache_size_bytes,
            router: Router::default(),
            sidebar_collapsed: false,
            show_now_playing: false,
            show_lyrics: true,
            show_queue: false,
            header_search: String::new(),
            search_query: String::new(),
            search_scope: SearchScope::Nct,
            search_seq: 0,
            search_tracks: Vec::new(),
            search_albums: Vec::new(),
            search_loading: false,
            search_failed: false,
            nct_title: "Top 50 NhacCuaTui".to_string(),
            nct_tracks: Vec::new(),
            trending_tracks: Vec::new(),
            new_releases: Vec::new(),
            sc_shelves: Vec::new(),
            recent_tracks: Vec::new(),
            favorite_tracks: Vec::new(),
            home_loading: true,
            home_failed: false,
            sc_hub_tag: "v-pop".to_string(),
            sc_hub_tracks: Vec::new(),
            sc_hub_playlists: Vec::new(),
            sc_hub_loading: false,
            sc_playlist_detail: None,
            sc_playlist_loading: false,
            sc_playlist_error: None,
            album_detail: None,
            album_loading: false,
            album_error: None,
            artist_info: None,
            artist_tracks: Vec::new(),
            artist_loading: false,
            artist_error: None,
            playlists: Vec::new(),
            playlists_loading: false,
            playlist_detail: None,
            playlist_detail_loading: false,
            favorites_list: Vec::new(),
            favorites_loading: false,
            history_items: Vec::new(),
            history_loading: false,
            confirm_clear_history: false,
            top_items: Vec::new(),
            top_total_plays: 0,
            top_timeframe: TopTimeframe::Days7,
            top_loading: false,
            web_login_in_progress: false,
            auth_modal: None,
            playlist_editor: None,
            playlist_picker_track: None,
            context_menu: None,
            cursor_pos: Point::ORIGIN,
            toast: None,
            toast_seq: 0,
            lyrics_track_id: None,
            lyrics: None,
            lyrics_romaji: Vec::new(),
            lyrics_loading: false,
            last_scrolled_lyric: None,
            now_playing_spring: Spring::settled(0.0),
            queue_spring: Spring::settled(0.0),
            sidebar_spring: Spring::settled(0.0),
            route_spring: Spring::settled(1.0),
            toast_spring: Spring::settled(0.0),
            overlay_spring: Spring::settled(1.0),
            artwork_scale_spring: Spring::settled(0.88),
            heart_spring: Spring::settled(1.0),
            play_btn_spring: Spring::settled(1.0),
            lyrics_active_spring: Spring::settled(0.0),
            lyrics_scroll_spring: Spring::settled(0.0),
            lyrics_scroll_target_y: 0.0,
            lyrics_user_scrolled_until: None,
            lyrics_last_programmatic_y: 0.0,
            lyrics_flash_idx: None,
            last_anim_instant: Instant::now(),
            dsp_store,
            spectrum_bars: [0.0; 24],
            dsp_active_backend: true,
            signal_path: None,
            audio_lab_tab: AudioLabTab::Eq,
            editing_right_ch: false,
            selected_eq_band: None,
            current_output_device: None,
            available_outputs: Vec::new(),
            available_inputs: Vec::new(),
            cal: CalibrationState::default(),
            adaptive_status: Default::default(),
        };

        let boot_tasks = Task::batch([
            open_main.map(Message::MainWindowOpened),
            refresh_session_task(session),
            load_home_public_task(state.api.clone(), state.nct.clone()),
        ]);

        (state, boot_tasks)
    }

    pub fn title(&self, win: window::Id) -> String {
        if Some(win) == self.mini_window {
            if let Some(t) = self.player.current() {
                return format!("{} — BlueSymphony", t.title);
            }
            return "BlueSymphony Mini".to_string();
        }
        if let Some(t) = self.player.current() {
            if self.player.is_playing {
                return format!("{} · {} — BlueSymphony", t.title, t.artist_name());
            }
        }
        "BlueSymphony".to_string()
    }

    pub fn theme(&self, _win: window::Id) -> Theme {
        iced_theme(self.settings.theme, self.settings.gaming_mode)
    }

    pub fn style(&self, theme: &Theme) -> iced::theme::Style {
        iced::theme::Style {
            background_color: Color::TRANSPARENT,
            text_color: theme.palette().text,
        }
    }

    pub fn view(&self, win: window::Id) -> Element<'_, Message> {
        if Some(win) == self.mini_window {
            return views::mini_player::view(self);
        }
        views::shell::main_view(self)
    }

    pub fn subscription(&self) -> Subscription<Message> {
        let mut subs = vec![
            window::close_requests().map(Message::WindowCloseRequested),
            window::close_events().map(Message::WindowClosed),
            window::resize_events().map(|(id, size)| Message::WindowResized(id, size)),
            keyboard::listen().filter_map(|evt| match evt {
                keyboard::Event::KeyPressed { key, modifiers, .. } => {
                    Some(Message::KeyPressed(key, modifiers))
                }
                _ => None,
            }),
            Subscription::run_with(
                SubHandle(1, Arc::clone(&self.snap_rx)),
                |handle| {
                    let rx_arc = Arc::clone(&handle.1);
                    stream::channel(64, async move |mut output| {
                        let rx = rx_arc.lock().ok().and_then(|mut g| g.take());
                        let Some(mut rx) = rx else {
                            std::future::pending::<()>().await;
                            return;
                        };
                        while let Some(snap) = rx.recv().await {
                            if output.send(Message::PlayerSnap(snap)).await.is_err() {
                                break;
                            }
                        }
                    })
                },
            ),
            Subscription::run_with(
                DspSubHandle(2, Arc::clone(&self.dsp_rx)),
                |handle| {
                    let rx_arc = Arc::clone(&handle.1);
                    stream::channel(128, async move |mut output| {
                        let rx = rx_arc.lock().ok().and_then(|mut g| g.take());
                        let Some(mut rx) = rx else {
                            std::future::pending::<()>().await;
                            return;
                        };
                        while let Some(evt) = rx.recv().await {
                            if output.send(Message::DspEvent(evt)).await.is_err() {
                                break;
                            }
                        }
                    })
                },
            ),
            Subscription::run_with(
                CompanionSubHandle(3, Arc::clone(&self.companion_rx)),
                |handle| {
                    let rx_arc = Arc::clone(&handle.1);
                    stream::channel(128, async move |mut output| {
                        let rx = rx_arc.lock().ok().and_then(|mut g| g.take());
                        let Some(mut rx) = rx else {
                            std::future::pending::<()>().await;
                            return;
                        };
                        while let Some(evt) = rx.recv().await {
                            if output.send(Message::Companion(evt)).await.is_err() {
                                break;
                            }
                        }
                    })
                },
            ),
            time::every(Duration::from_millis(120)).map(|_| Message::SystemTick),
        ];

        let has_window = self.main_window.is_some() || self.mini_window.is_some();
        let needs_ui_anim = self.player.is_playing
            || self.player.is_loading
            || self.home_loading
            || self.search_loading
            || self.album_loading
            || self.artist_loading
            || self.playlist_detail_loading
            || self.sc_hub_loading
            || self.sc_playlist_loading
            || self.playlists_loading;
        if has_window {
            let active_motion = self.has_active_motion()
                || (self.now_playing_spring.value > 0.01 && self.player.is_playing);
            if active_motion {
                subs.push(time::every(Duration::from_millis(16)).map(|_| Message::AuroraTick));
            } else if !self.settings.gaming_mode {
                subs.push(time::every(Duration::from_millis(33)).map(|_| Message::AuroraTick));
            } else if needs_ui_anim {
                subs.push(time::every(Duration::from_millis(45)).map(|_| Message::AuroraTick));
            }
        }

        Subscription::batch(subs)
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::MainWindowOpened(id) => {
                self.main_window = Some(id);
                self.init_os_integrations();
                return window::run(id, extract_hwnd).map(Message::MainWindowHwnd);
            }
            Message::MiniWindowOpened(id) => {
                self.mini_window = Some(id);
                return window::run(id, extract_hwnd).map(Message::MiniWindowHwnd);
            }
            Message::MainWindowHwnd(hwnd) => {
                self.main_hwnd = Some(hwnd);
                apply_window_style(hwnd, true, BackdropKind::Mica);
                apply_titlebar_color(hwnd, titlebar_rgb(self.settings.theme));
                if self.taskbar.is_none() {
                    self.taskbar = TaskbarToolbar::attach(hwnd);
                    if let Some(ref tb) = self.taskbar {
                        tb.update_playing(self.player.is_playing);
                    }
                }
                return Task::none();
            }
            Message::MiniWindowHwnd(hwnd) => {
                apply_window_style(hwnd, true, BackdropKind::None);
                apply_rounded_corners(hwnd);
                return Task::none();
            }
            Message::WindowCloseRequested(id) => {
                if Some(id) == self.mini_window {
                    self.mini_window = None;
                    return window::close(id);
                }
                if Some(id) == self.main_window {
                    if self.settings.close_to_tray && self.tray.is_some() {
                        self.main_window = None;
                        self.taskbar = None;
                        return window::close(id);
                    }
                    self.stop_companion_server();
                    let _ = self.player_tx.send(PlayerAction::Shutdown);
                    self.save_settings();
                    return iced::exit();
                }
            }
            Message::WindowClosed(id) => {
                if Some(id) == self.main_window {
                    self.main_window = None;
                    self.taskbar = None;
                } else if Some(id) == self.mini_window {
                    self.mini_window = None;
                }
            }
            Message::WindowResized(id, size) => {
                if Some(id) == self.main_window {
                    self.settings.window_width = size.width.max(900.0);
                    self.settings.window_height = size.height.max(600.0);
                    self.save_settings();
                }
            }
            Message::ToggleMiniPlayer => {
                if let Some(id) = self.mini_window.take() {
                    return window::close(id);
                }
                let (id, task) = window::open(mini_window_settings());
                self.mini_window = Some(id);
                return task.map(Message::MiniWindowOpened);
            }
            Message::DragMiniWindow => {
                if let Some(id) = self.mini_window {
                    return window::drag(id);
                }
            }
            Message::FocusMainWindow => {
                if let Some(id) = self.main_window {
                    return Task::batch([
                        window::minimize(id, false),
                        window::gain_focus(id),
                    ]);
                }
                let (id, task) = window::open(main_window_settings(&self.settings));
                self.main_window = Some(id);
                return task.map(Message::MainWindowOpened);
            }
            Message::SystemTick => {
                let mut tasks = Vec::new();
                while let Some(cmd) = self.tray.as_ref().and_then(TrayController::poll) {
                    match cmd {
                        TrayCommand::ShowMain => tasks.push(self.update(Message::FocusMainWindow)),
                        TrayCommand::TogglePlay => tasks.push(self.update(Message::TogglePlay)),
                        TrayCommand::NextTrack => tasks.push(self.update(Message::NextTrack)),
                        TrayCommand::PrevTrack => tasks.push(self.update(Message::PrevTrack)),
                        TrayCommand::ToggleMiniPlayer => {
                            tasks.push(self.update(Message::ToggleMiniPlayer));
                        }
                        TrayCommand::Quit => {
                            let _ = self.player_tx.send(PlayerAction::Shutdown);
                            self.save_settings();
                            return iced::exit();
                        }
                    }
                }
                if self.settings.global_hotkeys {
                    while let Some(act) = self.hotkeys.as_ref().and_then(GlobalHotkeyManager::poll)
                    {
                        match act {
                            GlobalHotkeyAction::PlayPause => {
                                tasks.push(self.update(Message::TogglePlay));
                            }
                            GlobalHotkeyAction::NextTrack => {
                                tasks.push(self.update(Message::NextTrack));
                            }
                            GlobalHotkeyAction::PrevTrack => {
                                tasks.push(self.update(Message::PrevTrack));
                            }
                            GlobalHotkeyAction::ToggleMiniPlayer => {
                                tasks.push(self.update(Message::ToggleMiniPlayer));
                            }
                        }
                    }
                }
                while let Some(act) = self.taskbar.as_ref().and_then(TaskbarToolbar::poll) {
                    match act {
                        TaskbarAction::Previous => tasks.push(self.update(Message::PrevTrack)),
                        TaskbarAction::PlayPause => tasks.push(self.update(Message::TogglePlay)),
                        TaskbarAction::Next => tasks.push(self.update(Message::NextTrack)),
                    }
                }
                if !tasks.is_empty() {
                    return Task::batch(tasks);
                }
            }
            Message::AuroraTick => {
                let now = Instant::now();
                let dt = now
                    .duration_since(self.last_anim_instant)
                    .as_secs_f32()
                    .clamp(0.004, 0.05);
                self.last_anim_instant = now;

                self.aurora_time = (self.aurora_time + dt) % 10000.0;
                for idx in 0..3 {
                    self.aurora_current[idx] =
                        lerp_color(self.aurora_current[idx], self.aurora_target[idx], 0.08);
                }

                // Step all 60 FPS GPU UI & Lyrics springs
                self.now_playing_spring.step(dt, 260.0, 32.0);
                self.queue_spring.step(dt, 230.0, 28.0);
                self.sidebar_spring.step(dt, 240.0, 29.0);
                self.route_spring.step(dt, 260.0, 30.0);
                self.toast_spring.step(dt, 260.0, 27.0);
                if self.toast_spring.target <= 0.01 && self.toast_spring.value < 0.02 {
                    self.toast = None;
                }
                self.overlay_spring.step(dt, 280.0, 28.0);

                self.artwork_scale_spring
                    .set_target(if self.player.is_playing { 1.0 } else { 0.88 });
                self.artwork_scale_spring.step(dt, 180.0, 18.0);
                self.heart_spring.step(dt, 360.0, 16.0);
                self.play_btn_spring.step(dt, 380.0, 18.0);

                if let Some((idx, mut flash)) = self.lyrics_flash_idx {
                    flash -= dt * 3.4;
                    if flash <= 0.0 {
                        self.lyrics_flash_idx = None;
                    } else {
                        self.lyrics_flash_idx = Some((idx, flash));
                    }
                }

                if let Some(until) = self.lyrics_user_scrolled_until {
                    if now >= until {
                        self.lyrics_user_scrolled_until = None;
                    }
                }

                // Continuous synced lyric focus & inertial smooth scrolling
                if let Some(ref lyr) = self.lyrics {
                    if lyr.is_synced() {
                        if let Some(active_idx) = lyr.active_index(self.player.current_time) {
                            self.lyrics_active_spring.set_target(active_idx as f32);
                            if self.last_scrolled_lyric != Some(active_idx) {
                                self.last_scrolled_lyric = Some(active_idx);
                            }
                            if self.lyrics_user_scrolled_until.is_none()
                                && self.now_playing_spring.value > 0.05
                            {
                                let target_y = self.compute_lyric_target_y(lyr, active_idx);
                                self.lyrics_scroll_target_y = target_y;
                                self.lyrics_scroll_spring.set_target(target_y);
                            }
                        }
                    }
                }
                self.lyrics_active_spring.step(dt, 150.0, 22.0);
                let scroll_moved = self.lyrics_scroll_spring.step(dt, 115.0, 20.0);
                if scroll_moved
                    && self.now_playing_spring.value > 0.05
                    && self.lyrics_user_scrolled_until.is_none()
                {
                    let y = self.lyrics_scroll_spring.value.max(0.0);
                    self.lyrics_last_programmatic_y = y;
                    return operation::scroll_to(
                        Id::new(LYRICS_SCROLL_ID),
                        AbsoluteOffset {
                            x: None,
                            y: Some(y),
                        },
                    );
                }
            }

            // Navigation
            Message::Navigate(route) => {
                self.context_menu = None;
                self.show_now_playing = false;
                self.now_playing_spring.set_target(0.0);
                self.route_spring = Spring::from_to(0.0, 1.0);
                self.router.navigate(route.clone());
                return self.on_route_entered(&route);
            }
            Message::GoBack => {
                if self.router.go_back() {
                    self.route_spring = Spring::from_to(0.0, 1.0);
                    let route = self.router.current.clone();
                    return self.on_route_entered(&route);
                }
            }
            Message::GoForward => {
                if self.router.go_forward() {
                    self.route_spring = Spring::from_to(0.0, 1.0);
                    let route = self.router.current.clone();
                    return self.on_route_entered(&route);
                }
            }
            Message::ToggleSidebar => {
                self.sidebar_collapsed = !self.sidebar_collapsed;
                self.sidebar_spring
                    .set_target(if self.sidebar_collapsed { 1.0 } else { 0.0 });
            }
            Message::ToggleNowPlaying => {
                self.show_now_playing = !self.show_now_playing;
                self.now_playing_spring
                    .set_target(if self.show_now_playing { 1.0 } else { 0.0 });
                self.context_menu = None;
                if self.show_now_playing {
                    self.lyrics_user_scrolled_until = None;
                }
            }
            Message::ToggleNowPlayingLyrics => {
                let has_lyrics = self.lyrics.as_ref().is_some_and(|l| !l.lines.is_empty());
                if !self.lyrics_loading && !has_lyrics {
                    return self.show_toast("Bài hát này chưa có lời bài hát.", false);
                }
                self.show_lyrics = !self.show_lyrics;
            }
            Message::ToggleQueueDrawer => {
                self.show_queue = !self.show_queue;
                self.queue_spring
                    .set_target(if self.show_queue { 1.0 } else { 0.0 });
            }
            Message::OpenArtist(name) => {
                self.show_now_playing = false;
                self.now_playing_spring.set_target(0.0);
                self.context_menu = None;
                let route = Route::Artist(name);
                self.router.navigate(route.clone());
                return self.on_route_entered(&route);
            }
            Message::ResolveAndOpenAlbum(track) => {
                self.context_menu = None;
                if let Some(id) = track.spotify_album_id.clone() {
                    self.show_now_playing = false;
                    self.now_playing_spring.set_target(0.0);
                    let mut stub = Album {
                        id,
                        name: track.album.clone().unwrap_or_else(|| "Album".to_string()),
                        artist: track.artist.clone(),
                        cover_url: track.cover_url.clone(),
                        release_date: None,
                        album_type: None,
                        total_tracks: None,
                        tracks: None,
                    };
                    stub.cover_url = track.cover_url.clone();
                    let route = Route::Album(stub);
                    self.router.navigate(route.clone());
                    return self.on_route_entered(&route);
                }
                let api = self.api.clone();
                return Task::perform(
                    async move {
                        let res = api
                            .resolve_album(
                                &track.title,
                                track.artist.as_deref(),
                                track.album.as_deref(),
                                Some(&track.id),
                            )
                            .await
                            .map_err(|e| e.to_string())?;
                        Ok(res.album_id.map(|id| Album {
                            id,
                            name: res.album_name.unwrap_or_else(|| "Album".to_string()),
                            artist: track.artist,
                            cover_url: res.cover_url.or(track.cover_url),
                            release_date: None,
                            album_type: None,
                            total_tracks: None,
                            tracks: None,
                        }))
                    },
                    Message::AlbumResolvedForTrack,
                );
            }
            Message::AlbumResolvedForTrack(res) => match res {
                Ok(Some(album)) => {
                    self.show_now_playing = false;
                    self.now_playing_spring.set_target(0.0);
                    let route = Route::Album(album);
                    self.router.navigate(route.clone());
                    return self.on_route_entered(&route);
                }
                Ok(None) => return self.show_toast("Không tìm thấy thông tin album.", true),
                Err(e) => {
                    tracing::warn!("resolve album failed: {e}");
                    return self.show_toast("Không tìm thấy thông tin album.", true);
                }
            },

            // Keyboard & Cursor
            Message::CursorMoved(pos) => self.cursor_pos = pos,
            Message::ScrollHorizontal(id, dx) => {
                return operation::scroll_by(id, AbsoluteOffset { x: dx, y: 0.0 });
            }
            Message::CloseOverlays => {
                self.context_menu = None;
                self.auth_modal = None;
                self.playlist_editor = None;
                self.playlist_picker_track = None;
                self.show_now_playing = false;
                self.now_playing_spring.set_target(0.0);
            }
            Message::KeyPressed(key, modifiers) => {
                return self.handle_key(key, modifiers);
            }
            Message::SpaceKeyChecked(any_focused) => {
                if !any_focused
                    && self.auth_modal.is_none()
                    && self.playlist_editor.is_none()
                    && self.playlist_picker_track.is_none()
                {
                    return self.update(Message::TogglePlay);
                }
            }

            // Player
            Message::PlayerSnap(snap) => {
                let prev_id = self.player.current().map(|t| t.id.clone());
                let prev_playing = self.player.is_playing;
                let err_changed = snap.error_message.is_some()
                    && snap.error_message != self.player.error_message;
                let err_text = snap.error_message.clone();

                self.player = snap;

                if self.player.is_playing != prev_playing {
                    if let Some(ref tray) = self.tray {
                        tray.set_playing(self.player.is_playing);
                    }
                    if let Some(ref tb) = self.taskbar {
                        tb.update_playing(self.player.is_playing);
                    }
                }

                let mut tasks = Vec::new();
                if err_changed {
                    if let Some(msg) = err_text {
                        tasks.push(self.show_toast(msg, true));
                        let _ = self.player_tx.send(PlayerAction::ClearError);
                    }
                }

                let new_track = self.player.current().cloned();
                let new_id = new_track.as_ref().map(|t| t.id.clone());

                if new_id != prev_id {
                    self.last_scrolled_lyric = None;
                    self.lyrics_active_spring.snap(0.0);
                    self.lyrics_scroll_spring.snap(0.0);
                    self.lyrics_scroll_target_y = 0.0;
                    self.lyrics_user_scrolled_until = None;
                    self.lyrics_last_programmatic_y = 0.0;
                    self.lyrics_flash_idx = None;
                    if let Some(ref tr) = new_track {
                        if let Some(url) = tr.cover_url.as_deref() {
                            if let Some(cached) = self.image_cache.get(url) {
                                self.aurora_target = cached.palette;
                            } else if let Some(t) = self.prefetch_url_task(url) {
                                tasks.push(t);
                            }
                        }
                        if self.lyrics_track_id.as_deref() != Some(&tr.id) {
                            self.lyrics_track_id = Some(tr.id.clone());
                            self.lyrics = None;
                            self.lyrics_romaji.clear();
                            self.lyrics_loading = true;
                            let api = self.api.clone();
                            let track_clone = tr.clone();
                            tasks.push(Task::perform(
                                async move {
                                    let lyrics = LyricsService::fetch(&api, &track_clone).await;
                                    (track_clone.id, lyrics)
                                },
                                |(track_id, lyrics)| Message::LyricsLoaded { track_id, lyrics },
                            ));
                        }
                    } else {
                        self.lyrics_track_id = None;
                        self.lyrics = None;
                        self.lyrics_romaji.clear();
                        self.lyrics_loading = false;
                    }
                }

                // Update continuous lyric active target (smooth 60 FPS scrolling handled in AuroraTick)
                if let Some(ref lyr) = self.lyrics {
                    if lyr.is_synced() {
                        if let Some(idx) = lyr.active_index(self.player.current_time) {
                            self.lyrics_active_spring.set_target(idx as f32);
                        }
                    }
                }

                if !tasks.is_empty() {
                    return Task::batch(tasks);
                }
            }
            Message::PlayTracks { tracks, start_at } => {
                let _ = self
                    .player_tx
                    .send(PlayerAction::PlayTracks { tracks, start_at });
            }
            Message::PlayTracksShuffled(tracks) => {
                if !tracks.is_empty() {
                    let start_at = (self.aurora_time.to_bits() as usize) % tracks.len();
                    let _ = self
                        .player_tx
                        .send(PlayerAction::PlayTracks { tracks, start_at });
                    if !self.player.shuffle {
                        let _ = self.player_tx.send(PlayerAction::ToggleShuffle);
                    }
                }
            }
            Message::JumpQueue(i) => {
                let _ = self.player_tx.send(PlayerAction::Jump(i));
            }
            Message::TogglePlay => {
                self.play_btn_spring.impulse(-2.8);
                let _ = self.player_tx.send(PlayerAction::TogglePlay);
            }
            Message::NextTrack => {
                let _ = self.player_tx.send(PlayerAction::Next);
            }
            Message::PrevTrack => {
                let _ = self.player_tx.send(PlayerAction::Previous);
            }
            Message::SeekTo(secs) => {
                let _ = self.player_tx.send(PlayerAction::Seek(secs));
            }
            Message::SetVolume(vol) => {
                let clamped = vol.clamp(0.0, 1.0);
                self.settings.volume = clamped;
                self.settings.muted = false;
                self.save_settings();
                let _ = self.player_tx.send(PlayerAction::SetVolume(clamped));
                if self.dsp_store.adaptive.ambient_enabled {
                    self.audio_handle
                        .send(AudioCommand::RecordVolumePreference(clamped as f32));
                    let room_db = self.adaptive_status.room_dbfs;
                    self.dsp_store
                        .adaptive
                        .learned_points
                        .push((room_db, clamped as f32));
                    if self.dsp_store.adaptive.learned_points.len() > 32 {
                        self.dsp_store.adaptive.learned_points.remove(0);
                    }
                    self.save_dsp_profiles();
                }
            }
            Message::ToggleMute => {
                self.settings.muted = !self.settings.muted;
                self.save_settings();
                let _ = self.player_tx.send(PlayerAction::ToggleMute);
            }
            Message::ToggleShuffle => {
                let _ = self.player_tx.send(PlayerAction::ToggleShuffle);
            }
            Message::CycleRepeat => {
                let _ = self.player_tx.send(PlayerAction::CycleRepeat);
            }
            Message::PlayNext(track) => {
                self.context_menu = None;
                let title = track.title.clone();
                let _ = self.player_tx.send(PlayerAction::PlayNext(track));
                return self.show_toast(format!("Sẽ phát tiếp theo: {title}"), false);
            }
            Message::EnqueueTrack(track) => {
                self.context_menu = None;
                let title = track.title.clone();
                let _ = self.player_tx.send(PlayerAction::Enqueue(track));
                return self.show_toast(format!("Đã thêm vào hàng chờ: {title}"), false);
            }
            Message::RemoveFromQueue(i) => {
                let _ = self.player_tx.send(PlayerAction::RemoveFromQueue(i));
            }
            Message::MoveQueueItem { from, to } => {
                let _ = self
                    .player_tx
                    .send(PlayerAction::MoveInQueue { from, to });
            }

            // Artwork cache
            Message::ArtworkLoaded(url, art) => {
                if let Some(ref cached) = art {
                    if self
                        .player
                        .current()
                        .and_then(|t| t.cover_url.as_deref())
                        == Some(url.as_str())
                    {
                        self.aurora_target = cached.palette;
                    }
                }
                self.image_cache.insert(url, art);
                self.cache_size_bytes = self.image_cache.disk_usage_bytes();
            }

            // Home & Discovery
            Message::RefreshHome => {
                self.home_loading = true;
                self.home_failed = false;
                self.image_cache.reset_failures();
                let mut tasks = vec![load_home_public_task(self.api.clone(), self.nct.clone())];
                if self.session_snap.is_signed_in() {
                    tasks.push(load_home_private_task(self.session.clone()));
                }
                return Task::batch(tasks);
            }
            Message::HomePublicLoaded {
                nct_title,
                nct,
                trending,
                albums,
                sc_shelves,
                failed,
            } => {
                self.home_loading = false;
                self.home_failed = failed;
                if !nct.is_empty() {
                    self.nct_title = nct_title;
                    self.nct_tracks = nct;
                }
                if !trending.is_empty() {
                    self.trending_tracks = trending;
                }
                if !albums.is_empty() {
                    self.new_releases = albums;
                }
                if !sc_shelves.is_empty() {
                    self.sc_shelves = sc_shelves;
                }
                return self.prefetch_visible_artwork();
            }
            Message::HomePrivateLoaded { recent, favorites } => {
                self.recent_tracks = recent;
                self.favorite_tracks = favorites;
                return self.prefetch_visible_artwork();
            }
            Message::SelectSoundCloudHubTag(tag) => {
                self.sc_hub_tag = tag.clone();
                return self.load_soundcloud_hub(tag);
            }
            Message::SoundCloudHubLoaded {
                tag,
                tracks,
                playlists,
            } => {
                if self.sc_hub_tag == tag {
                    self.sc_hub_loading = false;
                    self.sc_hub_tracks = tracks;
                    self.sc_hub_playlists = playlists;
                    return self.prefetch_visible_artwork();
                }
            }
            Message::OpenSoundCloudPlaylist(pl) => {
                self.context_menu = None;
                self.show_now_playing = false;
                self.now_playing_spring.set_target(0.0);
                let route = Route::SoundCloudPlaylist(pl);
                self.router.navigate(route.clone());
                return self.on_route_entered(&route);
            }
            Message::SoundCloudPlaylistLoaded(res) => {
                self.sc_playlist_loading = false;
                match res {
                    Ok((maybe_pl, tracks)) => {
                        self.sc_playlist_error = None;
                        if let Some((ref existing, _)) = self.sc_playlist_detail {
                            let mut merged = maybe_pl.unwrap_or_else(|| existing.clone());
                            if merged.cover_url.is_none() {
                                merged.cover_url = existing.cover_url.clone();
                            }
                            if merged.artist.is_none() {
                                merged.artist = existing.artist.clone();
                            }
                            if merged.user.is_none() {
                                merged.user = existing.user.clone();
                            }
                            self.sc_playlist_detail = Some((merged, tracks));
                        } else if let Some(pl) = maybe_pl {
                            self.sc_playlist_detail = Some((pl, tracks));
                        }
                        return self.prefetch_visible_artwork();
                    }
                    Err(e) => {
                        self.sc_playlist_error = Some(e);
                    }
                }
            }
            Message::AlbumLoaded(res) => {
                self.album_loading = false;
                match res {
                    Ok(alb) => {
                        self.album_error = None;
                        self.album_detail = Some(alb);
                        return self.prefetch_visible_artwork();
                    }
                    Err(e) => self.album_error = Some(e),
                }
            }
            Message::ArtistLoaded(res) => {
                self.artist_loading = false;
                match res {
                    Ok((info, tracks)) => {
                        self.artist_error = None;
                        self.artist_info = Some(info);
                        self.artist_tracks = tracks;
                        return self.prefetch_visible_artwork();
                    }
                    Err(e) => self.artist_error = Some(e),
                }
            }

            // Search
            Message::HeaderSearchChanged(val) => {
                self.header_search = val;
            }
            Message::HeaderSearchSubmit => {
                let q = self.header_search.trim().to_string();
                if !q.is_empty() {
                    self.search_query = q;
                    self.router.navigate(Route::Search);
                    return self.schedule_search();
                }
            }
            Message::SearchQueryChanged(q) => {
                self.search_query = q;
                if self.search_query.trim().is_empty() {
                    self.search_tracks.clear();
                    self.search_albums.clear();
                    self.search_loading = false;
                    self.search_failed = false;
                    return Task::none();
                }
                return self.schedule_search();
            }
            Message::SearchScopeChanged(scope) => {
                self.search_scope = scope;
                if !self.search_query.trim().is_empty() {
                    return self.schedule_search();
                }
            }
            Message::RunSearchDebounced(seq) => {
                if seq != self.search_seq {
                    return Task::none();
                }
                let q = self.search_query.trim().to_string();
                if q.is_empty() {
                    return Task::none();
                }
                self.settings.push_recent_search(&q);
                self.save_settings();
                self.search_loading = true;
                self.search_failed = false;

                let scope = self.search_scope;
                let api = self.api.clone();
                let nct = self.nct.clone();
                return Task::perform(
                    async move {
                        match scope {
                            SearchScope::Nct => match nct.search(&q).await {
                                Ok(tracks) => (seq, tracks, Vec::new(), false),
                                Err(_) => (seq, Vec::new(), Vec::new(), true),
                            },
                            SearchScope::SoundCloud => match api.search_soundcloud(&q).await {
                                Ok(tracks) => (seq, tracks, Vec::new(), false),
                                Err(_) => (seq, Vec::new(), Vec::new(), true),
                            },
                            SearchScope::Songs => match api.search_spotify(&q).await {
                                Ok(tracks) => (seq, tracks, Vec::new(), false),
                                Err(_) => (seq, Vec::new(), Vec::new(), true),
                            },
                            SearchScope::Albums => match api.search_albums(&q).await {
                                Ok(albums) => (seq, Vec::new(), albums, false),
                                Err(_) => (seq, Vec::new(), Vec::new(), true),
                            },
                        }
                    },
                    |(seq, tracks, albums, failed)| Message::SearchCompleted {
                        seq,
                        tracks,
                        albums,
                        failed,
                    },
                );
            }
            Message::SearchCompleted {
                seq,
                tracks,
                albums,
                failed,
            } => {
                if seq == self.search_seq {
                    self.search_loading = false;
                    self.search_failed = failed;
                    self.search_tracks = tracks;
                    self.search_albums = albums;
                    return self.prefetch_visible_artwork();
                }
            }
            Message::PickRecentSearch(term) => {
                self.search_query = term;
                return self.schedule_search();
            }
            Message::ClearRecentSearches => {
                self.settings.recent_searches.clear();
                self.save_settings();
            }

            // Auth & Session
            Message::SessionRefreshed(snap, known) => {
                let signed_in = snap.is_signed_in();
                self.session_snap = snap;
                self.known_db_ids = known;
                if signed_in {
                    return Task::batch([
                        load_home_private_task(self.session.clone()),
                        load_playlists_task(self.session.clone()),
                    ]);
                } else {
                    self.recent_tracks.clear();
                    self.favorite_tracks.clear();
                    self.playlists.clear();
                }
            }
            Message::OpenAuthModal(mode) => {
                self.overlay_spring = Spring::from_to(0.0, 1.0);
                self.auth_modal = Some(AuthModalState {
                    mode,
                    ..Default::default()
                });
            }
            Message::StartWebLogin => {
                if self.web_login_in_progress {
                    return Task::none();
                }
                self.web_login_in_progress = true;
                self.auth_modal = None;
                let session = self.session.clone();
                let user_data_dir = self
                    .config
                    .image_cache_dir()
                    .parent()
                    .unwrap_or(&self.config.image_cache_dir())
                    .join("webview2_auth");

                return Task::perform(
                    async move {
                        let cookies = tokio::task::spawn_blocking(move || {
                            bs_win::web_login::open_web_login(
                                "https://www.bluesymphony.site/login".to_string(),
                                "https://www.bluesymphony.site".to_string(),
                                user_data_dir,
                            )
                        })
                        .await
                        .map_err(|e| format!("Lỗi cửa sổ đăng nhập: {e}"))?
                        .map_err(|e| e.to_string())?;

                        if cookies.is_empty() {
                            return Ok(None);
                        }

                        session
                            .complete_web_login(&cookies)
                            .await
                            .map_err(|e| e.0)?;
                        let snap = session.snapshot().await;
                        let known = session.known_db_ids_clone().await;
                        Ok(Some((snap, known)))
                    },
                    Message::WebLoginFinished,
                );
            }
            Message::WebLoginFinished(res) => {
                self.web_login_in_progress = false;
                match res {
                    Ok(Some((snap, known))) => {
                        self.session_snap = snap;
                        self.known_db_ids = known;
                        let route = self.router.current.clone();
                        let route_task = self.on_route_entered(&route);
                        return Task::batch([
                            load_home_private_task(self.session.clone()),
                            load_playlists_task(self.session.clone()),
                            route_task,
                            self.show_toast("Đăng nhập thành công!", false),
                        ]);
                    }
                    Ok(None) => {}
                    Err(e) => {
                        return self.show_toast(e, true);
                    }
                }
            }
            Message::CloseAuthModal => self.auth_modal = None,
            Message::AuthModeChanged(mode) => {
                if let Some(ref mut m) = self.auth_modal {
                    m.mode = mode;
                    m.error = None;
                }
            }
            Message::AuthAccountChanged(v) => {
                if let Some(ref mut m) = self.auth_modal {
                    m.account = v;
                }
            }
            Message::AuthPasswordChanged(v) => {
                if let Some(ref mut m) = self.auth_modal {
                    m.password = v;
                }
            }
            Message::AuthRealEmailChanged(v) => {
                if let Some(ref mut m) = self.auth_modal {
                    m.real_email = v;
                }
            }
            Message::SubmitAuth => {
                let Some(ref mut modal) = self.auth_modal else {
                    return Task::none();
                };
                if modal.loading || modal.account.trim().is_empty() || modal.password.is_empty() {
                    return Task::none();
                }
                modal.loading = true;
                modal.error = None;

                let mode = modal.mode;
                let account = modal.account.clone();
                let password = modal.password.clone();
                let real_email = modal.real_email.clone();
                let session = self.session.clone();

                return Task::perform(
                    async move {
                        let snap = match mode {
                            AuthModalMode::SignIn => session
                                .sign_in(&account, &password)
                                .await
                                .map_err(|e| e.to_string())?,
                            AuthModalMode::Register => session
                                .register(&account, &password, &real_email)
                                .await
                                .map_err(|e| e.to_string())?,
                        };
                        let known = session.known_db_ids_clone().await;
                        Ok((snap, known))
                    },
                    Message::AuthCompleted,
                );
            }
            Message::AuthCompleted(res) => match res {
                Ok((snap, known)) => {
                    self.auth_modal = None;
                    self.session_snap = snap;
                    self.known_db_ids = known;
                    let cur = self.router.current.clone();
                    return Task::batch([
                        load_home_private_task(self.session.clone()),
                        load_playlists_task(self.session.clone()),
                        self.on_route_entered(&cur),
                        self.show_toast("Đăng nhập thành công!", false),
                    ]);
                }
                Err(err) => {
                    if let Some(ref mut m) = self.auth_modal {
                        m.loading = false;
                        m.error = Some(err);
                    }
                }
            },
            Message::SignOut => {
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        session.sign_out().await;
                    },
                    |_| Message::SignedOut,
                );
            }
            Message::SignedOut => {
                self.session_snap = Default::default();
                self.recent_tracks.clear();
                self.favorite_tracks.clear();
                self.favorites_list.clear();
                self.history_items.clear();
                self.top_items.clear();
                self.playlists.clear();
                self.playlist_detail = None;
                return self.show_toast("Đã đăng xuất.", false);
            }

            // Favorites
            Message::ToggleFavorite(track) => {
                self.heart_spring.impulse(5.2);
                self.context_menu = None;
                if !self.session_snap.is_signed_in() {
                    return self.update(Message::StartWebLogin);
                }
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        let added = session
                            .toggle_favorite(&track)
                            .await
                            .map_err(|e| e.to_string())?;
                        let snap = session.snapshot().await;
                        let known = session.known_db_ids_clone().await;
                        Ok((snap, known, added, track.title))
                    },
                    Message::FavoriteToggled,
                );
            }
            Message::FavoriteToggled(res) => match res {
                Ok((snap, known, added, title)) => {
                    self.session_snap = snap;
                    self.known_db_ids = known;
                    let msg = if added {
                        format!("Đã thêm “{title}” vào Yêu thích")
                    } else {
                        format!("Đã bỏ “{title}” khỏi Yêu thích")
                    };
                    let mut tasks = vec![self.show_toast(msg, false)];
                    if matches!(self.router.current, Route::Favorites) {
                        tasks.push(self.update(Message::LoadFavorites));
                    }
                    return Task::batch(tasks);
                }
                Err(e) => return self.show_toast(e, true),
            },
            Message::LoadFavorites => {
                if !self.session_snap.is_signed_in() {
                    return Task::none();
                }
                self.favorites_loading = true;
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        LibraryApi::favorites_list(&session, 200)
                            .await
                            .map_err(|e| e.to_string())
                    },
                    Message::FavoritesLoaded,
                );
            }
            Message::FavoritesLoaded(res) => {
                self.favorites_loading = false;
                match res {
                    Ok(tracks) => {
                        self.favorites_list = tracks;
                        return self.prefetch_visible_artwork();
                    }
                    Err(e) => return self.show_toast(e, true),
                }
            }

            // History & Top
            Message::LoadHistory => {
                if !self.session_snap.is_signed_in() {
                    return Task::none();
                }
                self.history_loading = true;
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        LibraryApi::history_list(&session, 100)
                            .await
                            .map_err(|e| e.to_string())
                    },
                    Message::HistoryLoaded,
                );
            }
            Message::HistoryLoaded(res) => {
                self.history_loading = false;
                match res {
                    Ok(items) => {
                        self.history_items = items;
                        return self.prefetch_visible_artwork();
                    }
                    Err(e) => return self.show_toast(e, true),
                }
            }
            Message::DeleteHistoryItem(id) => {
                self.history_items.retain(|i| i.id != id);
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        LibraryApi::history_delete_one(&session, &id)
                            .await
                            .map_err(|e| e.to_string())
                    },
                    Message::HistoryDeleted,
                );
            }
            Message::AskClearHistory(ask) => self.confirm_clear_history = ask,
            Message::ClearAllHistory => {
                self.confirm_clear_history = false;
                self.history_items.clear();
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        LibraryApi::history_clear_all(&session)
                            .await
                            .map_err(|e| e.to_string())
                    },
                    Message::HistoryDeleted,
                );
            }
            Message::HistoryDeleted(res) => {
                if let Err(e) = res {
                    return self.show_toast(e, true);
                }
            }
            Message::LoadTopTracks(tf) => {
                self.top_timeframe = tf;
                if !self.session_snap.is_signed_in() {
                    return Task::none();
                }
                self.top_loading = true;
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        LibraryApi::history_top(&session, tf, 50)
                            .await
                            .map_err(|e| e.to_string())
                    },
                    Message::TopTracksLoaded,
                );
            }
            Message::TopTracksLoaded(res) => {
                self.top_loading = false;
                match res {
                    Ok((items, total)) => {
                        self.top_items = items;
                        self.top_total_plays = total;
                        return self.prefetch_visible_artwork();
                    }
                    Err(e) => return self.show_toast(e, true),
                }
            }

            // Playlists
            Message::LoadPlaylists => {
                if !self.session_snap.is_signed_in() {
                    return Task::none();
                }
                self.playlists_loading = true;
                return load_playlists_task(self.session.clone());
            }
            Message::PlaylistsLoaded(res) => {
                self.playlists_loading = false;
                if let Ok(list) = res {
                    self.playlists = list;
                    return self.prefetch_visible_artwork();
                }
            }
            Message::LoadPlaylistDetail(id) => {
                self.playlist_detail_loading = true;
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        PlaylistApi::detail(&session, &id)
                            .await
                            .map_err(|e| e.to_string())
                    },
                    Message::PlaylistDetailLoaded,
                );
            }
            Message::PlaylistDetailLoaded(res) => {
                self.playlist_detail_loading = false;
                match res {
                    Ok((Some(pl), tracks)) => {
                        self.playlist_detail = Some((pl, tracks));
                        return self.prefetch_visible_artwork();
                    }
                    Ok((None, _)) => self.playlist_detail = None,
                    Err(e) => return self.show_toast(e, true),
                }
            }
            Message::OpenCreatePlaylist => {
                if !self.session_snap.is_signed_in() {
                    return self.update(Message::StartWebLogin);
                }
                self.overlay_spring = Spring::from_to(0.0, 1.0);
                self.playlist_picker_track = None;
                self.playlist_editor = Some(PlaylistEditorState {
                    mode: PlaylistEditorMode::Create,
                    name: String::new(),
                    description: String::new(),
                    is_public: false,
                    loading: false,
                    error: None,
                });
            }
            Message::OpenEditPlaylist(pl) => {
                self.overlay_spring = Spring::from_to(0.0, 1.0);
                self.playlist_editor = Some(PlaylistEditorState {
                    mode: PlaylistEditorMode::Edit { id: pl.id },
                    name: pl.name,
                    description: pl.description.unwrap_or_default(),
                    is_public: pl.is_public.unwrap_or(false),
                    loading: false,
                    error: None,
                });
            }
            Message::ClosePlaylistEditor => self.playlist_editor = None,
            Message::PlaylistEditorNameChanged(v) => {
                if let Some(ref mut e) = self.playlist_editor {
                    e.name = v;
                }
            }
            Message::PlaylistEditorDescChanged(v) => {
                if let Some(ref mut e) = self.playlist_editor {
                    e.description = v;
                }
            }
            Message::PlaylistEditorPublicToggled(v) => {
                if let Some(ref mut e) = self.playlist_editor {
                    e.is_public = v;
                }
            }
            Message::SavePlaylistEditor => {
                let Some(ref mut editor) = self.playlist_editor else {
                    return Task::none();
                };
                if editor.loading || editor.name.trim().is_empty() {
                    return Task::none();
                }
                editor.loading = true;
                editor.error = None;
                let mode = editor.mode.clone();
                let name = editor.name.clone();
                let desc = editor.description.clone();
                let is_pub = editor.is_public;
                let session = self.session.clone();

                return Task::perform(
                    async move {
                        match mode {
                            PlaylistEditorMode::Create => {
                                PlaylistApi::create(&session, &name, &desc, is_pub)
                                    .await
                                    .map_err(|e| e.to_string())
                            }
                            PlaylistEditorMode::Edit { id } => {
                                PlaylistApi::update(&session, &id, &name, &desc, is_pub)
                                    .await
                                    .map_err(|e| e.to_string())
                            }
                        }
                    },
                    Message::PlaylistSaved,
                );
            }
            Message::PlaylistSaved(res) => match res {
                Ok(pl) => {
                    self.playlist_editor = None;
                    let mut tasks = vec![
                        load_playlists_task(self.session.clone()),
                        self.show_toast(format!("Đã lưu playlist “{}”", pl.name), false),
                    ];
                    if matches!(&self.router.current, Route::PlaylistDetail(id) if id == &pl.id) {
                        tasks.push(self.update(Message::LoadPlaylistDetail(pl.id)));
                    }
                    return Task::batch(tasks);
                }
                Err(err) => {
                    if let Some(ref mut e) = self.playlist_editor {
                        e.loading = false;
                        e.error = Some(err);
                    }
                }
            },
            Message::DeletePlaylist(id) => {
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        PlaylistApi::delete(&session, &id)
                            .await
                            .map(|_| id)
                            .map_err(|e| e.to_string())
                    },
                    Message::PlaylistDeleted,
                );
            }
            Message::PlaylistDeleted(res) => match res {
                Ok(id) => {
                    self.playlists.retain(|p| p.id != id);
                    if matches!(&self.router.current, Route::PlaylistDetail(cur) if cur == &id) {
                        self.playlist_detail = None;
                        self.router.navigate(Route::Playlists);
                    }
                    return self.show_toast("Đã xoá playlist.", false);
                }
                Err(e) => return self.show_toast(e, true),
            },
            Message::OpenPlaylistPicker(track) => {
                self.context_menu = None;
                self.overlay_spring = Spring::from_to(0.0, 1.0);
                self.playlist_picker_track = Some(track);
                if self.session_snap.is_signed_in() && self.playlists.is_empty() {
                    return load_playlists_task(self.session.clone());
                }
            }
            Message::ClosePlaylistPicker => self.playlist_picker_track = None,
            Message::AddTrackToPlaylist { playlist_id, track } => {
                self.playlist_picker_track = None;
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        PlaylistApi::add_track(&session, &playlist_id, &track)
                            .await
                            .map_err(|e| e.to_string())
                    },
                    Message::TrackAddedToPlaylist,
                );
            }
            Message::TrackAddedToPlaylist(res) => match res {
                Ok(msg) => {
                    let mut tasks = vec![self.show_toast(msg, false)];
                    if let Route::PlaylistDetail(ref id) = self.router.current {
                        let id = id.clone();
                        tasks.push(self.update(Message::LoadPlaylistDetail(id)));
                    }
                    return Task::batch(tasks);
                }
                Err(e) => return self.show_toast(e, true),
            },
            Message::RemoveTrackFromPlaylist {
                playlist_id,
                track_id,
            } => {
                self.context_menu = None;
                if let Some((ref pl, ref mut tracks)) = self.playlist_detail {
                    if pl.id == playlist_id {
                        tracks.retain(|t| t.id != track_id);
                    }
                }
                let session = self.session.clone();
                return Task::perform(
                    async move {
                        PlaylistApi::remove_track(&session, &playlist_id, &track_id)
                            .await
                            .map(|_| "Đã xoá bài hát khỏi playlist.".to_string())
                            .map_err(|e| e.to_string())
                    },
                    Message::TrackRemovedFromPlaylist,
                );
            }
            Message::TrackRemovedFromPlaylist(res) => match res {
                Ok(msg) => return self.show_toast(msg, false),
                Err(e) => return self.show_toast(e, true),
            },

            // Lyrics
            Message::LyricsLoaded { track_id, lyrics } => {
                if self.lyrics_track_id.as_deref() == Some(track_id.as_str()) {
                    self.lyrics_loading = false;
                    let should_romaji = self.settings.romaji_enabled
                        && lyrics.as_ref().is_some_and(|l| l.has_cjk());
                    self.lyrics = lyrics.clone();
                    if should_romaji {
                        if let Some(lyr) = lyrics {
                            return self.fetch_romaji_task(track_id, &lyr);
                        }
                    }
                }
            }
            Message::ToggleRomaji => {
                self.settings.romaji_enabled = !self.settings.romaji_enabled;
                self.save_settings();
                if self.settings.romaji_enabled && self.lyrics_romaji.is_empty() {
                    if let (Some(tid), Some(lyr)) =
                        (self.lyrics_track_id.clone(), self.lyrics.clone())
                    {
                        if lyr.has_cjk() {
                            return self.fetch_romaji_task(tid, &lyr);
                        }
                    }
                }
            }
            Message::RomajiLoaded { track_id, romaji } => {
                if self.lyrics_track_id.as_deref() == Some(track_id.as_str()) {
                    self.lyrics_romaji = romaji;
                }
            }
            Message::LyricsScrolled(y) => {
                if (y - self.lyrics_last_programmatic_y).abs() > 14.0 {
                    self.lyrics_user_scrolled_until =
                        Some(Instant::now() + Duration::from_secs_f32(3.5));
                    self.lyrics_scroll_spring.snap(y.max(0.0));
                }
            }
            Message::RecenterLyrics => {
                self.lyrics_user_scrolled_until = None;
                if let Some(ref lyr) = self.lyrics {
                    if let Some(idx) = lyr.active_index(self.player.current_time) {
                        let target_y = self.compute_lyric_target_y(lyr, idx);
                        self.lyrics_scroll_spring.set_target(target_y);
                    }
                }
            }
            Message::ClickLyricLine { index, time } => {
                self.lyrics_user_scrolled_until = None;
                self.lyrics_active_spring.set_target(index as f32);
                self.lyrics_flash_idx = Some((index, 1.0));
                let _ = self.player_tx.send(PlayerAction::Seek(time));
            }

            // Context Menu & Toasts
            Message::OpenContextMenu { track, playlist_id } => {
                self.overlay_spring = Spring::from_to(0.0, 1.0);
                self.context_menu = Some(ContextMenuState {
                    track,
                    position: self.cursor_pos,
                    playlist_id_context: playlist_id,
                });
            }
            Message::CloseContextMenu => self.context_menu = None,
            Message::DismissToast(seq) => {
                if self.toast.as_ref().is_some_and(|t| t.seq == seq) {
                    self.toast_spring.set_target(0.0);
                }
            }

            // Settings
            Message::SelectTheme(kind) => {
                self.settings.theme = kind;
                self.save_settings();
                if let Some(hwnd) = self.main_hwnd {
                    apply_titlebar_color(hwnd, titlebar_rgb(kind));
                }
            }
            Message::ToggleGamingMode => {
                self.settings.gaming_mode = !self.settings.gaming_mode;
                self.save_settings();
                return self.show_toast(
                    if self.settings.gaming_mode {
                        "Đã bật Gaming Mode (tắt shader GPU)"
                    } else {
                        "Đã tắt Gaming Mode"
                    },
                    false,
                );
            }
            Message::ToggleCloseToTray(v) => {
                self.settings.close_to_tray = v;
                self.save_settings();
            }
            Message::ToggleGlobalHotkeys(v) => {
                self.settings.global_hotkeys = v;
                self.save_settings();
                if v && self.hotkeys.is_none() {
                    self.hotkeys = GlobalHotkeyManager::new().ok();
                } else if !v {
                    self.hotkeys = None;
                }
            }
            Message::ClearCaches => {
                self.image_cache.clear_all();
                self.cache_size_bytes = 0;
                let resolver = self.resolver.clone();
                return Task::perform(
                    async move {
                        resolver.clear_cache().await;
                    },
                    |_| Message::CachesCleared,
                );
            }
            Message::CachesCleared => {
                return self.show_toast("Đã xoá bộ nhớ đệm.", false);
            }

            // Acoustic Suite: DSP, Auto-EQ, Room Calibration & Adaptive Audio
            Message::DspEvent(evt) => match evt {
                DspUiEvent::Spectrum(bars) => {
                    self.spectrum_bars = bars;
                }
                DspUiEvent::OutputDeviceChanged(dev) => {
                    let prev = self.current_output_device.replace(dev.clone());
                    if prev.as_deref() != Some(dev.as_str()) {
                        if let Some(mapped_id) = self.dsp_store.device_map.get(&dev).cloned() {
                            if self.dsp_store.active_profile_id != mapped_id
                                && self.dsp_store.profiles.iter().any(|p| p.id == mapped_id)
                            {
                                self.dsp_store.active_profile_id = mapped_id;
                                self.sync_dsp_and_save();
                                let prof_name = self
                                    .dsp_store
                                    .active_profile()
                                    .map(|p| p.name.clone())
                                    .unwrap_or_default();
                                return self.show_toast(
                                    format!("Tự động chuyển EQ “{prof_name}” cho {dev}"),
                                    false,
                                );
                            }
                        }
                    }
                }
                DspUiEvent::DevicesListed {
                    outputs,
                    inputs,
                    default_output,
                    default_input,
                } => {
                    self.available_outputs = outputs;
                    self.available_inputs = inputs;
                    if self.cal.selected_output.is_none() {
                        self.cal.selected_output = default_output.clone();
                    }
                    if self.cal.selected_mic.is_none() {
                        self.cal.selected_mic = default_input;
                    }
                    if self.current_output_device.is_none() {
                        self.current_output_device = default_output;
                    }
                }
                DspUiEvent::BackendMode { using_dsp, .. } => {
                    self.dsp_active_backend = using_dsp;
                }
                DspUiEvent::SignalPath(info) => {
                    let prev_note = self
                        .signal_path
                        .as_ref()
                        .and_then(|s| s.fallback_note.as_ref())
                        .cloned();
                    let new_note = info.fallback_note.clone();
                    self.signal_path = Some(info);
                    if self.dsp_store.bit_perfect_enabled {
                        if let Some(reason) = new_note {
                            if prev_note.as_deref() != Some(reason.as_str()) {
                                return self.show_toast(
                                    format!("Bit-Perfect tạm chuyển sang Shared: {reason}"),
                                    true,
                                );
                            }
                        }
                    }
                }
                DspUiEvent::MicLevel {
                    rms_dbfs,
                    peak_dbfs,
                    clipping,
                } => {
                    self.cal.mic_rms_dbfs = rms_dbfs;
                    self.cal.mic_peak_dbfs = peak_dbfs;
                    self.cal.mic_clipping = clipping;
                }
                DspUiEvent::SweepProgress { progress, stage } => {
                    self.cal.sweep_progress = progress;
                    self.cal.sweep_stage = stage;
                }
                DspUiEvent::SweepCompleted(res) => {
                    self.cal.sweep_running = false;
                    self.cal.sweep_progress = 1.0;
                    match res {
                        Ok(meas) => {
                            if self.cal.channel_mode == SweepChannelMode::IndependentLR
                                && self.cal.pending_right_next
                            {
                                self.cal.pending_right_next = false;
                                self.cal.collected_r.push(meas);
                            } else {
                                self.cal.collected_l.push(meas);
                                if self.cal.channel_mode == SweepChannelMode::IndependentLR {
                                    // Immediately run Right channel at same position
                                    self.cal.pending_right_next = true;
                                    self.cal.sweep_stage = "Đang đo kênh Phải (R)…".to_string();
                                    return self.launch_sweep_command(SweepChannel::Right);
                                }
                            }
                            if (self.cal.collected_l.len() as u8) >= self.cal.target_points
                                && (self.cal.channel_mode == SweepChannelMode::Stereo
                                    || self.cal.collected_r.len() >= self.cal.collected_l.len())
                            {
                                self.recompute_cal_autoeq();
                                self.cal.step = 4;
                                if let Some(ref h) = self.companion_handle {
                                    h.set_step(4);
                                    h.set_phase(CompanionPhase::Done {
                                        message: "Đã đo xong & tạo bộ lọc Auto-EQ! Xem kết quả trên PC."
                                            .to_string(),
                                    });
                                }
                            } else if let Some(ref h) = self.companion_handle {
                                h.set_phase(CompanionPhase::Monitoring);
                            }
                        }
                        Err(e) => {
                            self.cal.pending_right_next = false;
                            self.cal.error = Some(e.clone());
                            if let Some(ref h) = self.companion_handle {
                                h.set_phase(CompanionPhase::Error { message: e });
                            }
                        }
                    }
                }
                DspUiEvent::SpeakerPlaybackStarted { out_sample_rate, .. } => {
                    self.cal.companion_speaker_sr = out_sample_rate;
                }
                DspUiEvent::SpeakerPlaybackDone(res) => match res {
                    Ok(()) => {
                        if self.cal.sweep_running {
                            self.cal.sweep_progress = 0.92;
                            self.cal.sweep_stage =
                                "Đã phát xong — đang chờ iPhone gửi bản thu âm…".to_string();
                        }
                    }
                    Err(e) => {
                        self.cal.sweep_running = false;
                        self.cal.pending_right_next = false;
                        self.cal.error = Some(e.clone());
                        if let Some(ref h) = self.companion_handle {
                            h.set_phase(CompanionPhase::Error { message: e });
                        }
                    }
                },
                DspUiEvent::AdaptiveStatus(tel) => {
                    self.adaptive_status = tel;
                }
            },
            Message::SelectAudioLabTab(tab) => {
                if self.audio_lab_tab != tab {
                    self.route_spring = Spring::from_to(0.0, 1.0);
                }
                if self.audio_lab_tab == AudioLabTab::RoomCal && tab != AudioLabTab::RoomCal {
                    self.stop_calibration_tones();
                    self.stop_companion_server();
                }
                self.audio_lab_tab = tab;
                if tab == AudioLabTab::RoomCal {
                    self.audio_handle.send(AudioCommand::RefreshDevices);
                    if self.cal.mic_source == CalMicSource::IPhoneCompanion {
                        self.start_companion_server();
                    } else if self.cal.step == 1 || self.cal.step == 2 {
                        self.audio_handle.send(AudioCommand::StartNoiseCheck {
                            mic_name: self.cal.selected_mic.clone(),
                        });
                    }
                } else if tab == AudioLabTab::Adaptive {
                    self.audio_handle.send(AudioCommand::RefreshDevices);
                }
            }
            Message::ToggleDspBypass => {
                self.dsp_store.bypass = !self.dsp_store.bypass;
                self.sync_dsp_and_save();
            }
            Message::ToggleLevelMatchBypass => {
                self.dsp_store.level_match_bypass = !self.dsp_store.level_match_bypass;
                self.sync_dsp_and_save();
            }
            Message::ToggleDspEngine(v) => {
                self.dsp_store.dsp_engine_enabled = v;
                self.sync_dsp_and_save();
                return self.show_toast(
                    if v {
                        "Đã bật PCM DSP Engine (áp dụng từ bài tiếp theo / đang phát)"
                    } else {
                        "Đã chuyển sang WinRT thuần cho bài tiếp theo"
                    },
                    false,
                );
            }
            Message::ToggleBitPerfect(v) => {
                self.dsp_store.bit_perfect_enabled = v;
                self.sync_dsp_and_save();
                return self.show_toast(
                    if v {
                        "Đã bật chế độ Bit-Perfect (WASAPI Exclusive · bỏ qua DSP & mixer)"
                    } else {
                        "Đã tắt Bit-Perfect — quay lại PCM DSP 64-bit"
                    },
                    false,
                );
            }
            Message::SelectBitPerfectDevice(dev) => {
                self.dsp_store.bit_perfect_device = dev;
                self.sync_dsp_and_save();
            }
            Message::ToggleBitPerfectLockVolume(v) => {
                self.dsp_store.bit_perfect_lock_volume = v;
                self.sync_dsp_and_save();
            }
            Message::SelectDspProfile(id) => {
                if self.dsp_store.profiles.iter().any(|p| p.id == id) {
                    self.dsp_store.active_profile_id = id;
                    self.selected_eq_band = None;
                    self.sync_dsp_and_save();
                }
            }
            Message::CreateDspProfile => {
                let n = self.dsp_store.profiles.len() + 1;
                let id = format!("profile-{n}-{}", chrono::Utc::now().timestamp_millis());
                self.dsp_store.profiles.push(DspProfile {
                    id: id.clone(),
                    name: format!("Hồ sơ tuỳ chỉnh #{n}"),
                    ..DspProfile::default()
                });
                self.dsp_store.active_profile_id = id;
                self.selected_eq_band = None;
                self.sync_dsp_and_save();
            }
            Message::DuplicateDspProfile => {
                if let Some(mut clone) = self.dsp_store.active_profile().cloned() {
                    let id = format!("copy-{}", chrono::Utc::now().timestamp_millis());
                    clone.id = id.clone();
                    clone.name = format!("{} (Bản sao)", clone.name);
                    self.dsp_store.profiles.push(clone);
                    self.dsp_store.active_profile_id = id;
                    self.sync_dsp_and_save();
                }
            }
            Message::DeleteDspProfile(id) => {
                if self.dsp_store.profiles.len() > 1 {
                    self.dsp_store.profiles.retain(|p| p.id != id);
                    self.dsp_store.device_map.retain(|_, v| v != &id);
                    if self.dsp_store.active_profile_id == id {
                        if let Some(first) = self.dsp_store.profiles.first() {
                            self.dsp_store.active_profile_id = first.id.clone();
                        }
                    }
                    self.selected_eq_band = None;
                    self.sync_dsp_and_save();
                }
            }
            Message::RenameDspProfile(name) => {
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    p.name = name;
                    self.save_dsp_profiles();
                }
            }
            Message::ToggleAutoPreamp(v) => {
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    p.auto_preamp = v;
                    self.sync_dsp_and_save();
                }
            }
            Message::SetManualPreamp(db) => {
                let right = self.editing_right_ch;
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    if p.dual_mono && right {
                        p.right.preamp_db = db.clamp(-24.0, 12.0);
                    } else {
                        p.left.preamp_db = db.clamp(-24.0, 12.0);
                    }
                    self.sync_dsp_and_save();
                }
            }
            Message::ToggleDualMono(v) => {
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    p.dual_mono = v;
                    if v && p.right.bands.is_empty() {
                        p.right = p.left.clone();
                    }
                    if !v {
                        self.editing_right_ch = false;
                    }
                    self.sync_dsp_and_save();
                }
            }
            Message::SelectEqChannel(is_right) => {
                self.editing_right_ch = is_right;
                self.selected_eq_band = None;
            }
            Message::SelectEqBand(idx) => {
                self.selected_eq_band = Some(idx);
            }
            Message::EqBandUpdated {
                index,
                freq_hz,
                gain_db,
                q,
            } => {
                self.selected_eq_band = Some(index);
                let right = self.editing_right_ch;
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    let ch = if p.dual_mono && right {
                        &mut p.right
                    } else {
                        &mut p.left
                    };
                    if let Some(b) = ch.bands.get_mut(index) {
                        b.freq_hz = freq_hz.clamp(16.0, 22_000.0);
                        b.gain_db = gain_db.clamp(-18.0, 18.0);
                        b.q = q.clamp(0.2, 16.0);
                    }
                    self.audio_handle
                        .send(AudioCommand::SetDspStore(self.dsp_store.clone()));
                }
            }
            Message::ToggleEqBandEnabled(idx) => {
                let right = self.editing_right_ch;
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    let ch = if p.dual_mono && right {
                        &mut p.right
                    } else {
                        &mut p.left
                    };
                    if let Some(b) = ch.bands.get_mut(idx) {
                        b.enabled = !b.enabled;
                    }
                    self.sync_dsp_and_save();
                }
            }
            Message::CycleEqBandKind(idx) => {
                let right = self.editing_right_ch;
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    let ch = if p.dual_mono && right {
                        &mut p.right
                    } else {
                        &mut p.left
                    };
                    if let Some(b) = ch.bands.get_mut(idx) {
                        b.kind = b.kind.next();
                    }
                    self.sync_dsp_and_save();
                }
            }
            Message::AddEqBand => {
                let right = self.editing_right_ch;
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    let ch = if p.dual_mono && right {
                        &mut p.right
                    } else {
                        &mut p.left
                    };
                    if ch.bands.len() < 16 {
                        ch.bands.push(EqBand::peaking(1000.0, 0.0, 1.41));
                        self.selected_eq_band = Some(ch.bands.len() - 1);
                        self.sync_dsp_and_save();
                    }
                }
            }
            Message::RemoveEqBand(idx) => {
                let right = self.editing_right_ch;
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    let ch = if p.dual_mono && right {
                        &mut p.right
                    } else {
                        &mut p.left
                    };
                    if ch.bands.len() > 1 && idx < ch.bands.len() {
                        ch.bands.remove(idx);
                        self.selected_eq_band = None;
                        self.sync_dsp_and_save();
                    }
                }
            }
            Message::ResetEqBands => {
                let right = self.editing_right_ch;
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    let ch = if p.dual_mono && right {
                        &mut p.right
                    } else {
                        &mut p.left
                    };
                    ch.bands = default_10_band_peq();
                    ch.preamp_db = 0.0;
                    self.selected_eq_band = None;
                    self.sync_dsp_and_save();
                }
            }
            Message::SelectBoundaryPreset(bp) => {
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    p.boundary = bp;
                    self.sync_dsp_and_save();
                }
            }
            Message::ToggleAblLoudness(v) => {
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    p.abl_enabled = v;
                    self.sync_dsp_and_save();
                }
            }
            Message::SetAblStrength(s) => {
                if let Some(p) = self.dsp_store.active_profile_mut() {
                    p.abl_strength = s.clamp(0.0, 1.0);
                    self.sync_dsp_and_save();
                }
            }
            Message::BindProfileToCurrentOutput => {
                let dev = self
                    .current_output_device
                    .clone()
                    .unwrap_or_else(|| "Default".to_string());
                let active_id = self.dsp_store.active_profile_id.clone();
                if self.dsp_store.device_map.get(&dev) == Some(&active_id) {
                    self.dsp_store.device_map.remove(&dev);
                    self.save_dsp_profiles();
                    return self.show_toast(format!("Đã gỡ gắn tự động khỏi {dev}"), false);
                } else {
                    self.dsp_store.device_map.insert(dev.clone(), active_id);
                    self.save_dsp_profiles();
                    return self.show_toast(format!("Sẽ tự bật hồ sơ này khi dùng {dev}"), false);
                }
            }
            Message::ImportAutoEqFile => {
                return Task::perform(
                    async move {
                        let file = rfd::AsyncFileDialog::new()
                            .set_title("Chọn file AutoEQ / REW / Oratory1990 (.txt)")
                            .add_filter("EQ Preset", &["txt", "apo"])
                            .pick_file()
                            .await
                            .ok_or_else(|| "Đã huỷ chọn file".to_string())?;
                        let raw = std::fs::read_to_string(file.path())
                            .map_err(|e| format!("Không đọc được file: {e}"))?;
                        let ch = parse_equalizer_apo(&raw).map_err(|e| e.to_string())?;
                        let title = file
                            .path()
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Imported AutoEQ")
                            .to_string();
                        Ok((title, ch))
                    },
                    Message::AutoEqFileImported,
                );
            }
            Message::AutoEqFileImported(res) => match res {
                Ok((title, ch)) => {
                    let count = ch.bands.len();
                    let id = format!("autoeq-{}", chrono::Utc::now().timestamp_millis());
                    let new_prof = DspProfile {
                        id: id.clone(),
                        name: format!("AutoEQ: {title}"),
                        enabled: true,
                        dual_mono: false,
                        left: ch,
                        right: Default::default(),
                        auto_preamp: true,
                        boundary: Default::default(),
                        abl_enabled: false,
                        abl_strength: 0.5,
                        target_curve: Default::default(),
                        measured_curve: None,
                    };
                    self.dsp_store.profiles.push(new_prof);
                    self.dsp_store.active_profile_id = id;
                    self.sync_dsp_and_save();
                    return self.show_toast(
                        format!("Đã nhập {count} band EQ từ “{title}”"),
                        false,
                    );
                }
                Err(e) if e != "Đã huỷ chọn file" => {
                    return self.show_toast(e, true);
                }
                Err(_) => {}
            },
            Message::ExportEqualizerApo => {
                if let Some(prof) = self.dsp_store.active_profile().cloned() {
                    let content = export_equalizer_apo(&prof, 48_000.0);
                    return Task::perform(
                        async move {
                            let file = rfd::AsyncFileDialog::new()
                                .set_title("Xuất Equalizer APO config.txt")
                                .set_file_name("bluesymphony_eq.txt")
                                .add_filter("Equalizer APO", &["txt"])
                                .save_file()
                                .await
                                .ok_or_else(|| "Đã huỷ lưu file".to_string())?;
                            std::fs::write(file.path(), content)
                                .map_err(|e| format!("Lỗi ghi file: {e}"))?;
                            Ok(file.path().display().to_string())
                        },
                        Message::EqualizerApoExported,
                    );
                }
            }
            Message::EqualizerApoExported(res) => match res {
                Ok(path) => {
                    return self.show_toast(format!("Đã xuất Equalizer APO: {path}"), false);
                }
                Err(e) if e != "Đã huỷ lưu file" => return self.show_toast(e, true),
                Err(_) => {}
            },
            Message::SaveDspProfiles => {
                self.save_dsp_profiles();
            }

            // Room Calibration Wizard
            Message::CalSetStep(step) => {
                self.cal.error = None;
                self.cal.step = step.clamp(1, 4);
                if self.cal.mic_source == CalMicSource::IPhoneCompanion {
                    if let Some(ref h) = self.companion_handle {
                        h.set_step(self.cal.step);
                        if !self.cal.sweep_running {
                            h.set_phase(if self.cal.step <= 2 {
                                CompanionPhase::Monitoring
                            } else {
                                CompanionPhase::Idle
                            });
                        }
                    }
                    if self.cal.step > 2 {
                        self.cal.pink_noise_playing = false;
                        self.audio_handle.send(AudioCommand::StopTestTone);
                    }
                } else if self.cal.step == 1 || self.cal.step == 2 {
                    self.audio_handle.send(AudioCommand::StartNoiseCheck {
                        mic_name: self.cal.selected_mic.clone(),
                    });
                } else {
                    self.cal.pink_noise_playing = false;
                    self.audio_handle.send(AudioCommand::StopTestTone);
                }
            }
            Message::CalRefreshDevices => {
                self.audio_handle.send(AudioCommand::RefreshDevices);
                if self.cal.step <= 2 && self.cal.mic_source == CalMicSource::WindowsMic {
                    self.audio_handle.send(AudioCommand::StartNoiseCheck {
                        mic_name: self.cal.selected_mic.clone(),
                    });
                }
            }
            Message::CalSelectMic(name) => {
                self.cal.selected_mic = Some(name.clone());
                if self.cal.step <= 2 && self.cal.mic_source == CalMicSource::WindowsMic {
                    self.audio_handle
                        .send(AudioCommand::StartNoiseCheck { mic_name: Some(name) });
                }
            }
            Message::CalSelectOutput(name) => {
                self.cal.selected_output = Some(name.clone());
                if self.cal.pink_noise_playing {
                    self.audio_handle.send(AudioCommand::StartPinkNoise {
                        output_name: Some(name),
                        channel: SweepChannel::Stereo,
                        volume: self.cal.test_volume,
                    });
                }
            }
            Message::CalSelectMicSource(src) => {
                if self.cal.mic_source != src {
                    self.cal.mic_source = src;
                    self.cal.error = None;
                    match src {
                        CalMicSource::IPhoneCompanion => {
                            if !self.cal.pink_noise_playing {
                                self.audio_handle.send(AudioCommand::StopTestTone);
                            }
                            if self.cal.iphone_mode == IPhoneCalMode::MmmPinkNoise {
                                self.cal.target_points = 1;
                            }
                            self.start_companion_server();
                        }
                        CalMicSource::WindowsMic => {
                            self.stop_companion_server();
                            if self.cal.step <= 2 && !self.cal.pink_noise_playing {
                                self.audio_handle.send(AudioCommand::StartNoiseCheck {
                                    mic_name: self.cal.selected_mic.clone(),
                                });
                            }
                        }
                    }
                }
            }
            Message::CalSelectIPhoneMode(mode) => {
                self.cal.iphone_mode = mode;
                if mode == IPhoneCalMode::MmmPinkNoise {
                    self.cal.target_points = 1;
                }
                if let Some(ref h) = self.companion_handle {
                    h.set_mode(mode);
                }
            }
            Message::CalRestartCompanion => {
                self.stop_companion_server();
                if self.cal.mic_source == CalMicSource::IPhoneCompanion {
                    self.start_companion_server();
                }
            }
            Message::CalCopyCompanionUrl => {
                if let Some(ref url) = self.cal.companion_url {
                    let url_clone = url.clone();
                    return Task::batch([
                        iced::clipboard::write(url_clone),
                        self.show_toast("Đã sao chép đường dẫn đo phòng HTTPS", false),
                    ]);
                }
            }
            Message::Companion(evt) => match evt {
                CompanionEvent::Started { url, ca_url, .. } => {
                    self.cal.companion_url = Some(url);
                    self.cal.companion_ca_url = Some(ca_url);
                    self.cal.companion_error = None;
                }
                CompanionEvent::StartFailed(err) => {
                    self.cal.companion_error = Some(err);
                }
                CompanionEvent::ClientConnected { label } => {
                    self.cal.companion_connected = true;
                    self.cal.companion_device_label = Some(label);
                }
                CompanionEvent::MicLevel {
                    rms_dbfs,
                    peak_dbfs,
                    clipping,
                    sample_rate,
                } => {
                    if self.cal.mic_source == CalMicSource::IPhoneCompanion {
                        self.cal.mic_rms_dbfs = rms_dbfs;
                        self.cal.mic_peak_dbfs = peak_dbfs;
                        self.cal.mic_clipping = clipping;
                        self.cal.companion_sample_rate = sample_rate;
                        self.cal.companion_connected = true;
                    }
                }
                CompanionEvent::RemoteStartRequested => {
                    if self.router.current == Route::AudioLab
                        && self.audio_lab_tab == AudioLabTab::RoomCal
                        && self.cal.mic_source == CalMicSource::IPhoneCompanion
                        && !self.cal.sweep_running
                    {
                        if self.cal.step != 3 {
                            self.cal.step = 3;
                        }
                        return self.update(Message::CalStartSweep);
                    }
                }
                CompanionEvent::AudioUploaded {
                    seq,
                    sample_rate,
                    mode,
                    samples,
                } => {
                    if !self.cal.sweep_running || seq != self.cal.companion_seq {
                        return Task::none();
                    }
                    if let Some(ref h) = self.companion_handle {
                        h.set_phase(CompanionPhase::Analyzing);
                    }
                    self.cal.sweep_progress = 0.96;
                    self.cal.sweep_stage = "Đang giải chập & phân tích tín hiệu từ iPhone…".to_string();

                    let mic_cal = self.cal.mic_cal.clone();
                    let speaker_sr = self.cal.companion_speaker_sr.max(8000);
                    let volume = self.cal.test_volume;
                    let ch_label = self.cal.companion_active_channel.to_string();

                    return Task::perform(
                        async move {
                            tokio::task::spawn_blocking(move || match mode {
                                IPhoneCalMode::MmmPinkNoise => analyze_mmm_pink_noise(
                                    &samples,
                                    sample_rate,
                                    mic_cal.as_ref(),
                                    &ch_label,
                                )
                                .map_err(|e| e.to_string()),
                                IPhoneCalMode::SyncedFarinaEss => {
                                    let sig = generate_synced_farina_ess(
                                        speaker_sr,
                                        4.5,
                                        20.0,
                                        20_000.0,
                                        volume.clamp(0.05, 0.85),
                                    );
                                    analyze_synced_sweep_rir(
                                        &samples,
                                        sample_rate,
                                        &sig,
                                        speaker_sr,
                                        mic_cal.as_ref(),
                                        &ch_label,
                                    )
                                    .map_err(|e| e.to_string())
                                }
                            })
                            .await
                            .map_err(|e| format!("Lỗi tác vụ phân tích: {e}"))?
                        },
                        |res| Message::DspEvent(DspUiEvent::SweepCompleted(res)),
                    );
                }
            },
            Message::CompanionBeginSpeakerPlayback { seq, mode, channel } => {
                if self.cal.sweep_running && self.cal.companion_seq == seq {
                    let output_name = self.cal.selected_output.clone();
                    let volume = self.cal.test_volume;
                    match mode {
                        IPhoneCalMode::MmmPinkNoise => {
                            self.audio_handle.send(AudioCommand::PlaySpeakerPinkNoise {
                                output_name,
                                channel,
                                duration_sec: 12.0,
                                volume,
                            });
                        }
                        IPhoneCalMode::SyncedFarinaEss => {
                            self.audio_handle.send(AudioCommand::PlaySpeakerSyncedSweep {
                                output_name,
                                channel,
                                duration_sec: 4.5,
                                volume,
                            });
                        }
                    }
                }
            }
            Message::CompanionUploadTimeout(seq) => {
                if self.cal.sweep_running && self.cal.companion_seq == seq {
                    self.cal.sweep_running = false;
                    self.cal.pending_right_next = false;
                    let msg = "Hết thời gian chờ dữ liệu thu âm từ iPhone — kiểm tra kết nối Wi-Fi và màn hình Safari trên iPhone.".to_string();
                    self.cal.error = Some(msg.clone());
                    if let Some(ref h) = self.companion_handle {
                        h.set_phase(CompanionPhase::Error { message: msg });
                    }
                }
            }
            Message::CalToggleSafeMode(v) => {
                self.cal.uncalibrated_safe_mode = v;
                self.recompute_cal_autoeq();
            }
            Message::CalLoadMicFile => {
                return Task::perform(
                    async move {
                        let file = rfd::AsyncFileDialog::new()
                            .set_title("Chọn file hiệu chuẩn micro (.cal / .txt)")
                            .add_filter("Mic Calibration", &["cal", "txt"])
                            .pick_file()
                            .await
                            .ok_or_else(|| "Đã huỷ".to_string())?;
                        let raw = std::fs::read_to_string(file.path())
                            .map_err(|e| format!("Không đọc được file: {e}"))?;
                        let name = file
                            .path()
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Mic Cal");
                        parse_mic_cal(name, &raw).map_err(|e| e.to_string())
                    },
                    Message::CalMicFileLoaded,
                );
            }
            Message::CalMicFileLoaded(res) => match res {
                Ok(cal) => {
                    self.cal.mic_cal = Some(cal);
                    self.cal.uncalibrated_safe_mode = false;
                    self.recompute_cal_autoeq();
                    return self.show_toast(
                        "Đã nạp file hiệu chuẩn micro — mở khóa toàn dải 20 Hz – 20 kHz",
                        false,
                    );
                }
                Err(e) if e != "Đã huỷ" => return self.show_toast(e, true),
                Err(_) => {}
            },
            Message::CalClearMicFile => {
                self.cal.mic_cal = None;
                self.cal.uncalibrated_safe_mode = true;
                self.recompute_cal_autoeq();
            }
            Message::CalTogglePinkNoise => {
                self.cal.pink_noise_playing = !self.cal.pink_noise_playing;
                if self.cal.pink_noise_playing {
                    self.audio_handle.send(AudioCommand::StartPinkNoise {
                        output_name: self.cal.selected_output.clone(),
                        channel: SweepChannel::Stereo,
                        volume: self.cal.test_volume,
                    });
                } else {
                    self.audio_handle.send(AudioCommand::StopTestTone);
                    if self.cal.mic_source == CalMicSource::WindowsMic {
                        self.audio_handle.send(AudioCommand::StartNoiseCheck {
                            mic_name: self.cal.selected_mic.clone(),
                        });
                    }
                }
            }
            Message::CalSetTestVolume(v) => {
                self.cal.test_volume = v.clamp(0.05, 0.85);
                if self.cal.pink_noise_playing {
                    self.audio_handle.send(AudioCommand::StartPinkNoise {
                        output_name: self.cal.selected_output.clone(),
                        channel: SweepChannel::Stereo,
                        volume: self.cal.test_volume,
                    });
                }
            }
            Message::CalSetTargetPoints(pts) => {
                self.cal.target_points = pts;
            }
            Message::CalSetChannelMode(mode) => {
                self.cal.channel_mode = mode;
            }
            Message::CalResetSweeps => {
                self.cal.collected_l.clear();
                self.cal.collected_r.clear();
                self.cal.averaged_l = None;
                self.cal.averaged_r = None;
                self.cal.autoeq_l = None;
                self.cal.autoeq_r = None;
                self.cal.pending_right_next = false;
                self.cal.sweep_progress = 0.0;
                self.cal.sweep_stage.clear();
                self.cal.error = None;
            }
            Message::CalStartSweep => {
                if !self.cal.sweep_running {
                    self.cal.error = None;
                    self.cal.pink_noise_playing = false;
                    self.audio_handle.send(AudioCommand::StopTestTone);
                    self.cal.pending_right_next = false;
                    let ch = match self.cal.channel_mode {
                        SweepChannelMode::Stereo => SweepChannel::Stereo,
                        SweepChannelMode::IndependentLR => SweepChannel::Left,
                    };
                    return self.launch_sweep_command(ch);
                }
            }
            Message::CalSetTargetCurve(tc) => {
                self.cal.target_curve = tc;
                self.recompute_cal_autoeq();
            }
            Message::CalSetMaxBoost(db) => {
                self.cal.max_boost_db = db.clamp(0.0, 6.0);
                self.recompute_cal_autoeq();
            }
            Message::CalSaveAsProfile => {
                if let (Some(meas_l), Some(auto_l)) =
                    (self.cal.averaged_l.clone(), self.cal.autoeq_l.clone())
                {
                    let dual = self.cal.channel_mode == SweepChannelMode::IndependentLR
                        && self.cal.autoeq_r.is_some();
                    let right_ch = self
                        .cal
                        .autoeq_r
                        .as_ref()
                        .map(|r| bs_dsp::ChannelEq {
                            bands: r.bands.clone(),
                            preamp_db: r.preamp_db,
                        })
                        .unwrap_or_default();

                    let filter_count = auto_l.bands.len();
                    let rms_before = auto_l.rms_before_db;
                    let rms_after = auto_l.rms_after_db;
                    let id = format!("room-cal-{}", chrono::Utc::now().timestamp_millis());
                    let dev_hint = self
                        .cal
                        .selected_output
                        .as_deref()
                        .or(self.current_output_device.as_deref())
                        .unwrap_or("Phòng");
                    let name = format!("Đo phòng · {}", crate::theme::truncate_str(dev_hint, 18));

                    let new_prof = DspProfile {
                        id: id.clone(),
                        name: name.clone(),
                        enabled: true,
                        dual_mono: dual,
                        left: bs_dsp::ChannelEq {
                            bands: auto_l.bands,
                            preamp_db: auto_l.preamp_db,
                        },
                        right: right_ch,
                        auto_preamp: true,
                        boundary: Default::default(),
                        abl_enabled: true,
                        abl_strength: 0.6,
                        target_curve: self.cal.target_curve,
                        measured_curve: Some(meas_l),
                    };

                    self.dsp_store.profiles.push(new_prof);
                    self.dsp_store.active_profile_id = id.clone();
                    self.dsp_store.bypass = false;
                    if let Some(ref out_name) = self.cal.selected_output {
                        self.dsp_store.device_map.insert(out_name.clone(), id);
                    }
                    self.sync_dsp_and_save();
                    self.audio_lab_tab = AudioLabTab::Eq;
                    return self.show_toast(
                        format!(
                            "Đã bật Auto-EQ “{name}” ({filter_count} band · RMS {rms_before:.1} → {rms_after:.1} dB)"
                        ),
                        false,
                    );
                }
            }
            Message::CalPreviewToggle => {
                if let Some(ref auto_l) = self.cal.autoeq_l {
                    let preview_id = "room-cal-preview".to_string();
                    let already_preview = self.dsp_store.active_profile_id == preview_id;
                    if already_preview {
                        self.dsp_store.bypass = !self.dsp_store.bypass;
                    } else {
                        self.dsp_store.profiles.retain(|p| p.id != preview_id);
                        self.dsp_store.profiles.push(DspProfile {
                            id: preview_id.clone(),
                            name: "Nghe thử Auto-EQ".to_string(),
                            enabled: true,
                            dual_mono: self.cal.autoeq_r.is_some(),
                            left: bs_dsp::ChannelEq {
                                bands: auto_l.bands.clone(),
                                preamp_db: auto_l.preamp_db,
                            },
                            right: self
                                .cal
                                .autoeq_r
                                .as_ref()
                                .map(|r| bs_dsp::ChannelEq {
                                    bands: r.bands.clone(),
                                    preamp_db: r.preamp_db,
                                })
                                .unwrap_or_default(),
                            auto_preamp: true,
                            boundary: Default::default(),
                            abl_enabled: true,
                            abl_strength: 0.6,
                            target_curve: self.cal.target_curve,
                            measured_curve: self.cal.averaged_l.clone(),
                        });
                        self.dsp_store.active_profile_id = preview_id;
                        self.dsp_store.bypass = false;
                    }
                    self.audio_handle
                        .send(AudioCommand::SetDspStore(self.dsp_store.clone()));
                }
            }
            Message::RecomputeActiveProfileAutoEq => {
                if let Some(prof) = self.dsp_store.active_profile_mut() {
                    if let Some(ref meas) = prof.measured_curve {
                        let opts = AutoEqOptions {
                            target: prof.target_curve,
                            max_bands: 12,
                            max_boost_db: 3.0,
                            max_cut_db: 12.0,
                            schroeder_hz: meas.schroeder_hz as f64,
                            uncalibrated_mic_safe_mode: true,
                            ..Default::default()
                        };
                        let res = optimize_autoeq(meas, &opts);
                        let n = res.bands.len();
                        let before = res.rms_before_db;
                        let after = res.rms_after_db;
                        prof.left = bs_dsp::ChannelEq {
                            bands: res.bands,
                            preamp_db: res.preamp_db,
                        };
                        prof.auto_preamp = true;
                        self.dsp_store.bypass = false;
                        self.sync_dsp_and_save();
                        return self.show_toast(
                            format!(
                                "Đã tối ưu lại {n} bộ lọc Auto-EQ (sai số {before:.1} → {after:.1} dB)"
                            ),
                            false,
                        );
                    }
                }
            }

            // Adaptive Audio (Apple-inspired)
            Message::AdaptiveSelectMic(mic) => {
                self.dsp_store.adaptive.mic_name = mic;
                self.sync_adaptive_and_save();
            }
            Message::AdaptiveToggleHeadphoneMode(v) => {
                self.dsp_store.adaptive.headphone_mode = v;
                self.sync_adaptive_and_save();
            }
            Message::AdaptiveToggleAmbient(v) => {
                self.dsp_store.adaptive.ambient_enabled = v;
                self.sync_adaptive_and_save();
            }
            Message::AdaptiveSetAmbientStrength(v) => {
                self.dsp_store.adaptive.ambient_strength = v.clamp(0.0, 1.0);
                self.sync_adaptive_and_save();
            }
            Message::AdaptiveSetAmbientMaxBoost(v) => {
                self.dsp_store.adaptive.ambient_max_boost_db = v.clamp(1.0, 9.0);
                self.sync_adaptive_and_save();
            }
            Message::AdaptiveResetLearned => {
                self.dsp_store.adaptive.learned_points.clear();
                self.sync_adaptive_and_save();
                return self.show_toast("Đã đặt lại dữ liệu học âm lượng phòng.", false);
            }
            Message::AdaptiveToggleDucking(v) => {
                self.dsp_store.adaptive.ducking_enabled = v;
                self.sync_adaptive_and_save();
            }
            Message::AdaptiveSetDuckSensitivity(v) => {
                self.dsp_store.adaptive.ducking_sensitivity = v.clamp(0.1, 1.0);
                self.sync_adaptive_and_save();
            }
            Message::AdaptiveSetDuckDepth(v) => {
                self.dsp_store.adaptive.ducking_depth_db = v.clamp(3.0, 28.0);
                self.sync_adaptive_and_save();
            }
            Message::AdaptiveSetDuckRelease(v) => {
                self.dsp_store.adaptive.ducking_release_sec = v.clamp(1.0, 8.0);
                self.sync_adaptive_and_save();
            }
        }

        Task::none()
    }

    fn init_os_integrations(&mut self) {
        if self.tray.is_none() {
            if let Ok(img) = image::load_from_memory(APP_ICON_PNG) {
                let small = img.thumbnail(64, 64).to_rgba8();
                let (w, h) = small.dimensions();
                match TrayController::new(small.into_raw(), w, h) {
                    Ok(tray) => {
                        tray.set_playing(self.player.is_playing);
                        self.tray = Some(tray);
                    }
                    Err(e) => tracing::warn!("Tray unavailable: {e}"),
                }
            }
        }
        if self.settings.global_hotkeys && self.hotkeys.is_none() {
            match GlobalHotkeyManager::new() {
                Ok(hk) => self.hotkeys = Some(hk),
                Err(e) => tracing::warn!("Global hotkeys unavailable: {e}"),
            }
        }
    }

    fn on_route_entered(&mut self, route: &Route) -> Task<Message> {
        if !matches!(route, Route::AudioLab) {
            self.stop_calibration_tones();
            self.stop_companion_server();
        }
        match route {
            Route::AudioLab => {
                self.audio_handle.send(AudioCommand::RefreshDevices);
                if self.audio_lab_tab == AudioLabTab::RoomCal {
                    if self.cal.mic_source == CalMicSource::IPhoneCompanion {
                        self.start_companion_server();
                    } else if self.cal.step <= 2 {
                        self.audio_handle.send(AudioCommand::StartNoiseCheck {
                            mic_name: self.cal.selected_mic.clone(),
                        });
                    }
                }
            }
            Route::SoundCloud => {
                if self.sc_hub_tracks.is_empty() {
                    return self.load_soundcloud_hub(self.sc_hub_tag.clone());
                }
                return self.prefetch_visible_artwork();
            }
            Route::SoundCloudPlaylist(pl) => {
                if let Some(ref tr) = pl.tracks {
                    if !tr.is_empty() {
                        self.sc_playlist_loading = false;
                        self.sc_playlist_error = None;
                        self.sc_playlist_detail = Some((pl.clone(), tr.clone()));
                        return self.prefetch_visible_artwork();
                    }
                }
                self.sc_playlist_loading = true;
                self.sc_playlist_error = None;
                self.sc_playlist_detail = Some((pl.clone(), Vec::new()));
                let api = self.api.clone();
                let id = pl.id.clone();
                return Task::perform(
                    async move {
                        api.soundcloud_playlist_detail(&id)
                            .await
                            .map_err(|e| e.to_string())
                    },
                    Message::SoundCloudPlaylistLoaded,
                );
            }
            Route::Favorites => return self.update(Message::LoadFavorites),
            Route::History => return self.update(Message::LoadHistory),
            Route::TopTracks => return self.update(Message::LoadTopTracks(self.top_timeframe)),
            Route::Playlists => return self.update(Message::LoadPlaylists),
            Route::PlaylistDetail(id) => return self.update(Message::LoadPlaylistDetail(id.clone())),
            Route::Album(alb) => {
                self.album_loading = true;
                self.album_error = None;
                self.album_detail = None;
                let api = self.api.clone();
                let id = alb.id.clone();
                return Task::perform(
                    async move { api.album(&id).await.map_err(|e| e.to_string()) },
                    Message::AlbumLoaded,
                );
            }
            Route::Artist(name) => {
                self.artist_loading = true;
                self.artist_error = None;
                self.artist_info = None;
                self.artist_tracks.clear();
                let api = self.api.clone();
                let n = name.clone();
                return Task::perform(
                    async move { api.artist(&n).await.map_err(|e| e.to_string()) },
                    Message::ArtistLoaded,
                );
            }
            Route::Home | Route::NewReleases | Route::Search | Route::Library => {
                self.image_cache.reset_failures();
                return self.prefetch_visible_artwork();
            }
            _ => {}
        }
        Task::none()
    }

    fn load_soundcloud_hub(&mut self, tag: String) -> Task<Message> {
        self.sc_hub_loading = true;
        let api = self.api.clone();
        Task::perform(
            async move {
                let (tr_res, pl_res) = tokio::join!(
                    api.soundcloud_explore(&tag, 30),
                    api.soundcloud_playlists(&tag, 8),
                );
                (
                    tag,
                    tr_res.unwrap_or_default(),
                    pl_res.unwrap_or_default(),
                )
            },
            |(tag, tracks, playlists)| Message::SoundCloudHubLoaded {
                tag,
                tracks,
                playlists,
            },
        )
    }

    fn schedule_search(&mut self) -> Task<Message> {
        self.search_seq += 1;
        let seq = self.search_seq;
        Task::perform(
            async move {
                tokio::time::sleep(Duration::from_millis(350)).await;
                seq
            },
            Message::RunSearchDebounced,
        )
    }

    fn fetch_romaji_task(
        &self,
        track_id: String,
        lyrics: &bs_core::models::Lyrics,
    ) -> Task<Message> {
        let lines: Vec<String> = lyrics.lines.iter().map(|l| l.text.clone()).collect();
        let api = self.api.clone();
        Task::perform(
            async move {
                let romaji = LyricsService::fetch_romaji(&api, &lines).await;
                (track_id, romaji)
            },
            |(track_id, romaji)| Message::RomajiLoaded { track_id, romaji },
        )
    }

    fn handle_key(&mut self, key: Key, modifiers: Modifiers) -> Task<Message> {
        if key == Key::Named(Named::Escape) {
            return self.update(Message::CloseOverlays);
        }

        if modifiers.control() {
            match &key {
                Key::Character(c) if c.eq_ignore_ascii_case("k") || c.eq_ignore_ascii_case("f") => {
                    self.router.navigate(Route::Search);
                    return operation::focus(Id::new(SEARCH_PAGE_INPUT_ID));
                }
                Key::Character(c) if c.eq_ignore_ascii_case("l") => {
                    return self.update(Message::ToggleNowPlaying);
                }
                Key::Character(c) if c.eq_ignore_ascii_case("q") => {
                    return self.update(Message::ToggleQueueDrawer);
                }
                Key::Character(c) if c.eq_ignore_ascii_case("m") && modifiers.shift() => {
                    return self.update(Message::ToggleMiniPlayer);
                }
                Key::Named(Named::ArrowRight) => return self.update(Message::NextTrack),
                Key::Named(Named::ArrowLeft) => return self.update(Message::PrevTrack),
                Key::Named(Named::ArrowUp) => {
                    let v = (self.settings.volume + 0.05).min(1.0);
                    return self.update(Message::SetVolume(v));
                }
                Key::Named(Named::ArrowDown) => {
                    let v = (self.settings.volume - 0.05).max(0.0);
                    return self.update(Message::SetVolume(v));
                }
                _ => {}
            }
        }

        if key == Key::Named(Named::Space) && modifiers.is_empty() {
            return operation::is_focused(Id::new(HEADER_SEARCH_INPUT_ID))
                .map(Message::SpaceKeyChecked);
        }

        Task::none()
    }

    fn show_toast(&mut self, message: impl Into<String>, is_error: bool) -> Task<Message> {
        self.toast_seq += 1;
        let seq = self.toast_seq;
        self.toast_spring = Spring::from_to(0.0, 1.0);
        self.toast = Some(ToastState {
            message: message.into(),
            is_error,
            seq,
        });
        Task::perform(
            async move {
                tokio::time::sleep(Duration::from_secs(4)).await;
                seq
            },
            Message::DismissToast,
        )
    }

    fn prefetch_url_task(&mut self, url: &str) -> Option<Task<Message>> {
        if !self.image_cache.should_fetch(url) {
            return None;
        }
        let owned = url.to_string();
        self.image_cache.mark_in_flight(owned.clone());
        let fut = self.image_cache.spawn_fetch(owned);
        Some(Task::perform(fut, |(u, art)| Message::ArtworkLoaded(u, art)))
    }

    fn prefetch_visible_artwork(&mut self) -> Task<Message> {
        let mut urls: Vec<String> = Vec::new();
        let mut seen = HashSet::new();
        let mut push_url = |opt: Option<&str>| {
            if let Some(u) = opt.filter(|s| !s.is_empty()) {
                if seen.insert(u.to_string()) {
                    urls.push(u.to_string());
                }
            }
        };

        if let Some(cur) = self.player.current() {
            push_url(cur.cover_url.as_deref());
        }
        // Prioritize URLs for the currently active route so visible artwork loads first.
        match self.router.current {
            Route::NewReleases => {
                for a in &self.new_releases {
                    push_url(a.cover_url.as_deref());
                }
            }
            Route::Search => {
                for t in self.search_tracks.iter().take(60) {
                    push_url(t.cover_url.as_deref());
                }
                for a in self.search_albums.iter().take(60) {
                    push_url(a.cover_url.as_deref());
                }
            }
            Route::SoundCloud => {
                for t in self.sc_hub_tracks.iter().take(60) {
                    push_url(t.cover_url.as_deref());
                }
                for pl in self.sc_hub_playlists.iter().take(24) {
                    push_url(pl.display_cover());
                }
            }
            _ => {}
        }
        for t in self.nct_tracks.iter().take(60) {
            push_url(t.cover_url.as_deref());
        }
        for t in self.trending_tracks.iter().take(60) {
            push_url(t.cover_url.as_deref());
        }
        for t in self.recent_tracks.iter().take(40) {
            push_url(t.cover_url.as_deref());
        }
        for t in self.favorite_tracks.iter().take(40) {
            push_url(t.cover_url.as_deref());
        }
        for s in &self.sc_shelves {
            for t in s.tracks.iter().take(24) {
                push_url(t.cover_url.as_deref());
            }
        }
        for a in &self.new_releases {
            push_url(a.cover_url.as_deref());
        }
        for t in self.sc_hub_tracks.iter().take(60) {
            push_url(t.cover_url.as_deref());
        }
        for pl in self.sc_hub_playlists.iter().take(24) {
            push_url(pl.display_cover());
        }
        if let Some((ref pl, ref tracks)) = self.sc_playlist_detail {
            push_url(pl.display_cover());
            for t in tracks.iter().take(100) {
                push_url(t.cover_url.as_deref());
            }
        }
        for t in self.search_tracks.iter().take(60) {
            push_url(t.cover_url.as_deref());
        }
        for a in self.search_albums.iter().take(60) {
            push_url(a.cover_url.as_deref());
        }
        if let Some(ref alb) = self.album_detail {
            push_url(alb.cover_url.as_deref());
            for t in alb.tracks.as_deref().unwrap_or(&[]).iter().take(100) {
                push_url(t.cover_url.as_deref());
            }
        }
        if let Some(ref art) = self.artist_info {
            push_url(art.picture_url());
        }
        for t in self.artist_tracks.iter().take(60) {
            push_url(t.cover_url.as_deref());
        }
        for t in self.favorites_list.iter().take(100) {
            push_url(t.cover_url.as_deref());
        }
        for h in self.history_items.iter().take(100) {
            if let Some(ref t) = h.track {
                push_url(t.cover_url.as_deref());
            }
        }
        for item in self.top_items.iter().take(60) {
            push_url(item.track.cover_url.as_deref());
        }
        for pl in self.playlists.iter().take(60) {
            push_url(pl.cover_url.as_deref());
        }
        if let Some((ref pl, ref tracks)) = self.playlist_detail {
            push_url(pl.cover_url.as_deref());
            for t in tracks.iter().take(100) {
                push_url(t.cover_url.as_deref());
            }
        }

        let tasks: Vec<Task<Message>> = urls
            .into_iter()
            .filter_map(|u| self.prefetch_url_task(&u))
            .collect();
        Task::batch(tasks)
    }

    fn has_active_motion(&self) -> bool {
        self.now_playing_spring.is_moving()
            || self.queue_spring.is_moving()
            || self.sidebar_spring.is_moving()
            || self.route_spring.is_moving()
            || self.toast_spring.is_moving()
            || self.overlay_spring.is_moving()
            || self.artwork_scale_spring.is_moving()
            || self.heart_spring.is_moving()
            || self.play_btn_spring.is_moving()
            || self.lyrics_active_spring.is_moving()
            || self.lyrics_scroll_spring.is_moving()
            || self.lyrics_flash_idx.is_some()
    }

    fn compute_lyric_target_y(&self, lyr: &bs_core::models::Lyrics, active_idx: usize) -> f32 {
        // Matches lyrics_column padding/spacing so active line centers comfortably in upper-middle stage
        let mut y = 84.0_f32;
        for (idx, line) in lyr.lines.iter().enumerate() {
            if idx == active_idx {
                break;
            }
            let char_count = line.text.chars().count();
            let wrapped_lines = ((char_count as f32) / 34.0).ceil().max(1.0);
            let has_romaji = self.settings.romaji_enabled
                && self
                    .lyrics_romaji
                    .get(idx)
                    .is_some_and(|s| !s.trim().is_empty());
            let row_h = 16.0
                + wrapped_lines * 29.0
                + if has_romaji { 22.0 } else { 0.0 }
                + 12.0;
            y += row_h;
        }
        (y - 190.0).max(0.0)
    }

    fn save_settings(&self) {
        self.settings.save(&self.config.settings_path());
    }

    fn save_dsp_profiles(&self) {
        AppSettings::save_dsp_store(&self.dsp_store, &self.config.dsp_profiles_path());
    }

    fn sync_dsp_and_save(&self) {
        self.audio_handle
            .send(AudioCommand::SetDspStore(self.dsp_store.clone()));
        self.save_dsp_profiles();
    }

    fn sync_adaptive_and_save(&self) {
        self.audio_handle
            .send(AudioCommand::SetAdaptiveConfig(self.dsp_store.adaptive.clone()));
        self.save_dsp_profiles();
    }

    fn start_companion_server(&mut self) {
        if self.companion_handle.is_some() {
            return;
        }
        self.cal.companion_error = None;
        let handle = spawn_companion_server(
            &self.config.data_dir,
            self.cal.step,
            self.cal.iphone_mode,
            self.companion_tx.clone(),
        );
        self.companion_handle = Some(handle);
    }

    fn stop_companion_server(&mut self) {
        if let Some(h) = self.companion_handle.take() {
            h.shutdown();
        }
        self.cal.companion_connected = false;
        self.cal.companion_device_label = None;
        self.cal.companion_url = None;
        self.cal.companion_ca_url = None;
    }

    fn stop_calibration_tones(&mut self) {
        self.cal.pink_noise_playing = false;
        self.audio_handle.send(AudioCommand::StopTestTone);
    }

    fn launch_sweep_command(&mut self, ch: SweepChannel) -> Task<Message> {
        match self.cal.mic_source {
            CalMicSource::WindowsMic => {
                self.cal.sweep_running = true;
                self.cal.sweep_progress = 0.0;
                self.cal.sweep_stage = format!("Đang quét {ch}…");
                let (pts, name) = match &self.cal.mic_cal {
                    Some(c) => (Some(c.points.clone()), Some(c.name.clone())),
                    None => (None, None),
                };
                self.audio_handle.send(AudioCommand::RunSweep {
                    mic_name: self.cal.selected_mic.clone(),
                    output_name: self.cal.selected_output.clone(),
                    channel: ch,
                    duration_sec: 4.5,
                    volume: self.cal.test_volume,
                    mic_cal_points: pts,
                    mic_cal_name: name,
                });
                Task::none()
            }
            CalMicSource::IPhoneCompanion => {
                if !self.cal.companion_connected {
                    self.cal.sweep_running = false;
                    self.cal.pending_right_next = false;
                    self.cal.error = Some(
                        "Chưa thấy iPhone kết nối — quét mã QR ở Bước 1 và bấm 'Bật Micro iPhone' trước khi đo."
                            .to_string(),
                    );
                    return Task::none();
                }
                self.cal.sweep_running = true;
                self.cal.sweep_progress = 0.02;
                self.cal.companion_seq = self.cal.companion_seq.saturating_add(1);
                let seq = self.cal.companion_seq;
                self.cal.companion_active_channel = ch;
                let mode = self.cal.iphone_mode;
                let duration_ms: u32 = match mode {
                    IPhoneCalMode::MmmPinkNoise => 13_400,
                    IPhoneCalMode::SyncedFarinaEss => 8_000,
                };
                self.cal.sweep_stage = format!("Đang đồng bộ lệnh thu âm tới iPhone ({ch})…");
                if let Some(ref h) = self.companion_handle {
                    h.set_phase(CompanionPhase::Recording {
                        seq,
                        mode,
                        duration_ms,
                        channel_label: ch.to_string(),
                    });
                }

                let start_speaker = Task::perform(
                    async {
                        tokio::time::sleep(Duration::from_millis(700)).await;
                    },
                    move |_| Message::CompanionBeginSpeakerPlayback {
                        seq,
                        mode,
                        channel: ch,
                    },
                );
                let timeout_guard = Task::perform(
                    async move {
                        tokio::time::sleep(Duration::from_millis(
                            u64::from(duration_ms) + 14_000,
                        ))
                        .await;
                    },
                    move |_| Message::CompanionUploadTimeout(seq),
                );
                Task::batch([start_speaker, timeout_guard])
            }
        }
    }

    fn recompute_cal_autoeq(&mut self) {
        let avg_l = average_responses(&self.cal.collected_l);
        let avg_r = average_responses(&self.cal.collected_r);

        if let Some(ref ml) = avg_l {
            let opts = AutoEqOptions {
                target: self.cal.target_curve,
                max_bands: 12,
                max_boost_db: self.cal.max_boost_db as f64,
                max_cut_db: 12.0,
                schroeder_hz: ml.schroeder_hz as f64,
                uncalibrated_mic_safe_mode: self.cal.uncalibrated_safe_mode,
                ..Default::default()
            };
            self.cal.autoeq_l = Some(optimize_autoeq(ml, &opts));
        } else {
            self.cal.autoeq_l = None;
        }

        if let Some(ref mr) = avg_r {
            let opts = AutoEqOptions {
                target: self.cal.target_curve,
                max_bands: 12,
                max_boost_db: self.cal.max_boost_db as f64,
                max_cut_db: 12.0,
                schroeder_hz: mr.schroeder_hz as f64,
                uncalibrated_mic_safe_mode: self.cal.uncalibrated_safe_mode,
                ..Default::default()
            };
            self.cal.autoeq_r = Some(optimize_autoeq(mr, &opts));
        } else {
            self.cal.autoeq_r = None;
        }

        self.cal.averaged_l = avg_l;
        self.cal.averaged_r = avg_r;
    }
}

fn app_window_icon() -> Option<window::Icon> {
    window::icon::from_file_data(APP_ICON_PNG, None).ok()
}

fn main_window_settings(settings: &AppSettings) -> window::Settings {
    window::Settings {
        size: Size::new(settings.window_width, settings.window_height),
        min_size: Some(Size::new(940.0, 620.0)),
        position: window::Position::Centered,
        exit_on_close_request: false,
        icon: app_window_icon(),
        ..Default::default()
    }
}

fn mini_window_settings() -> window::Settings {
    window::Settings {
        size: Size::new(408.0, 162.0),
        resizable: false,
        decorations: false,
        transparent: true,
        level: window::Level::AlwaysOnTop,
        exit_on_close_request: false,
        icon: app_window_icon(),
        ..Default::default()
    }
}

fn extract_hwnd(win: &dyn window::Window) -> isize {
    win.window_handle()
        .ok()
        .and_then(|h| match h.as_raw() {
            RawWindowHandle::Win32(w) => Some(w.hwnd.get()),
            _ => None,
        })
        .unwrap_or(0)
}

fn refresh_session_task(session: SessionStore) -> Task<Message> {
    Task::perform(
        async move {
            let snap = session.refresh().await;
            let known = session.known_db_ids_clone().await;
            (snap, known)
        },
        |(snap, known)| Message::SessionRefreshed(snap, known),
    )
}

fn load_home_public_task(api: ApiClient, nct: NctClient) -> Task<Message> {
    Task::perform(
        async move {
            let (nct_res, trending_res, albums_res) =
                tokio::join!(nct.chart(), api.trending(), api.new_releases());

            let mut sc_futures = Vec::with_capacity(SC_HOME_TAGS.len());
            for (tag, title) in SC_HOME_TAGS {
                let api_c = api.clone();
                sc_futures.push(async move {
                    let tracks = api_c.soundcloud_explore(tag, 12).await.unwrap_or_default();
                    ScShelf {
                        tag: (*tag).to_string(),
                        title: (*title).to_string(),
                        tracks,
                    }
                });
            }
            let sc_all = join_all_shelves(sc_futures).await;
            let sc_shelves: Vec<ScShelf> = sc_all
                .into_iter()
                .filter(|s| !s.tracks.is_empty())
                .collect();

            let failed = nct_res.is_err() && trending_res.is_err() && albums_res.is_err();
            let (nct_title, nct_tracks) =
                nct_res.unwrap_or_else(|_| ("Top 50 NhacCuaTui".to_string(), Vec::new()));

            (
                nct_title,
                nct_tracks,
                trending_res.unwrap_or_default(),
                albums_res.unwrap_or_default(),
                sc_shelves,
                failed,
            )
        },
        |(nct_title, nct, trending, albums, sc_shelves, failed)| Message::HomePublicLoaded {
            nct_title,
            nct,
            trending,
            albums,
            sc_shelves,
            failed,
        },
    )
}

async fn join_all_shelves<F: std::future::Future<Output = ScShelf>>(futs: Vec<F>) -> Vec<ScShelf> {
    let mut out = Vec::with_capacity(futs.len());
    // Run concurrently with tokio::join! for the 4 fixed tags
    let mut iter = futs.into_iter();
    if let (Some(f0), Some(f1), Some(f2), Some(f3)) =
        (iter.next(), iter.next(), iter.next(), iter.next())
    {
        let (r0, r1, r2, r3) = tokio::join!(f0, f1, f2, f3);
        out.extend([r0, r1, r2, r3]);
    }
    out
}

fn load_home_private_task(session: SessionStore) -> Task<Message> {
    Task::perform(
        async move {
            let init_fut = LibraryApi::init_data(&session, 40);
            let fav_fut = LibraryApi::favorites_list(&session, 15);
            let (init_res, fav_res) = tokio::join!(init_fut, fav_fut);

            let mut seen = HashSet::new();
            let recent: Vec<Track> = init_res
                .map(|(_, items)| {
                    items
                        .into_iter()
                        .filter_map(|i| i.track)
                        .filter(|t| seen.insert(t.id.clone()))
                        .take(15)
                        .collect()
                })
                .unwrap_or_default();

            let favorites = fav_res.unwrap_or_default();
            (recent, favorites)
        },
        |(recent, favorites)| Message::HomePrivateLoaded { recent, favorites },
    )
}

fn load_playlists_task(session: SessionStore) -> Task<Message> {
    Task::perform(
        async move { PlaylistApi::list(&session).await.map_err(|e| e.to_string()) },
        Message::PlaylistsLoaded,
    )
}

fn lerp_color(a: Color, b: Color, t: f32) -> Color {
    Color::from_rgba(
        a.r + (b.r - a.r) * t,
        a.g + (b.g - a.g) * t,
        a.b + (b.b - a.b) * t,
        a.a + (b.a - a.a) * t,
    )
}
