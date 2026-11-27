use bs_core::models::{Album, SoundCloudPlaylistSummary};

#[derive(Debug, Clone, PartialEq)]
pub enum Route {
    Home,
    NewReleases,
    SoundCloud,
    SoundCloudPlaylist(SoundCloudPlaylistSummary),
    Search,
    Library,
    Favorites,
    History,
    TopTracks,
    Playlists,
    PlaylistDetail(String),
    Album(Album),
    Artist(String),
    AudioLab,
    Settings,
}

#[derive(Debug, Clone)]
pub struct Router {
    pub current: Route,
    back_stack: Vec<Route>,
    forward_stack: Vec<Route>,
}

impl Default for Router {
    fn default() -> Self {
        Self {
            current: Route::Home,
            back_stack: Vec::new(),
            forward_stack: Vec::new(),
        }
    }
}

impl Router {
    pub fn navigate(&mut self, next: Route) {
        if self.current == next {
            return;
        }
        let prev = std::mem::replace(&mut self.current, next);
        self.back_stack.push(prev);
        self.forward_stack.clear();
        if self.back_stack.len() > 50 {
            self.back_stack.remove(0);
        }
    }

    pub fn can_back(&self) -> bool {
        !self.back_stack.is_empty()
    }

    pub fn can_forward(&self) -> bool {
        !self.forward_stack.is_empty()
    }

    pub fn go_back(&mut self) -> bool {
        let Some(prev) = self.back_stack.pop() else {
            return false;
        };
        let curr = std::mem::replace(&mut self.current, prev);
        self.forward_stack.push(curr);
        true
    }

    pub fn go_forward(&mut self) -> bool {
        let Some(next) = self.forward_stack.pop() else {
            return false;
        };
        let curr = std::mem::replace(&mut self.current, next);
        self.back_stack.push(curr);
        true
    }
}

