use std::collections::HashSet;

use crate::models::Track;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepeatMode {
    Off,
    All,
    One,
}

impl RepeatMode {
    pub fn cycle(self) -> Self {
        match self {
            Self::Off => Self::All,
            Self::All => Self::One,
            Self::One => Self::Off,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PlaybackQueue {
    pub queue: Vec<Track>,
    pub original_order: Vec<Track>,
    pub index: usize,
    pub shuffle: bool,
    pub repeat: RepeatMode,
}

impl Default for PlaybackQueue {
    fn default() -> Self {
        Self {
            queue: Vec::new(),
            original_order: Vec::new(),
            index: 0,
            shuffle: false,
            repeat: RepeatMode::Off,
        }
    }
}

impl PlaybackQueue {
    pub fn current(&self) -> Option<&Track> {
        self.queue.get(self.index)
    }

    pub fn upcoming_next(&self) -> Option<&Track> {
        self.queue.get(self.index + 1)
    }

    pub fn play(&mut self, tracks: Vec<Track>, start_at: usize) {
        self.original_order = tracks.clone();
        self.queue = tracks;
        self.index = if self.queue.is_empty() {
            0
        } else {
            start_at.min(self.queue.len() - 1)
        };
        if self.shuffle {
            self.shuffle_upcoming();
        }
    }

    pub fn jump(&mut self, i: usize) -> bool {
        if i < self.queue.len() {
            self.index = i;
            true
        } else {
            false
        }
    }

    pub fn play_next(&mut self, track: Track) -> bool {
        if self.current().is_none() {
            self.play(vec![track], 0);
            return true;
        }
        let insert_idx = self.index + 1;
        self.queue.insert(insert_idx, track.clone());

        let orig_idx = self
            .current()
            .and_then(|c| self.original_order.iter().position(|t| t.id == c.id))
            .map(|p| p + 1)
            .unwrap_or(self.original_order.len());
        self.original_order
            .insert(orig_idx.min(self.original_order.len()), track);
        false
    }

    pub fn enqueue(&mut self, track: Track) -> bool {
        if self.current().is_none() {
            self.play(vec![track], 0);
            return true;
        }
        self.queue.push(track.clone());
        self.original_order.push(track);
        false
    }

    pub fn remove(&mut self, i: usize) -> bool {
        if i >= self.queue.len() || i == self.index {
            return false;
        }
        let removed_id = self.queue[i].id.clone();
        if let Some(pos) = self.original_order.iter().position(|t| t.id == removed_id) {
            self.original_order.remove(pos);
        }
        self.queue.remove(i);
        if i < self.index {
            self.index -= 1;
        }
        true
    }

    pub fn move_item(&mut self, from: usize, to: usize) -> bool {
        if from >= self.queue.len() || to >= self.queue.len() || from == to {
            return false;
        }
        let current_id = self.current().map(|t| t.id.clone());
        let item = self.queue.remove(from);
        self.queue.insert(to, item);
        if let Some(cid) = current_id {
            if let Some(new_idx) = self.queue.iter().position(|t| t.id == cid) {
                self.index = new_idx;
            }
        }
        if !self.shuffle {
            self.original_order = self.queue.clone();
        }
        true
    }

    pub fn toggle_shuffle(&mut self) {
        self.shuffle = !self.shuffle;
        if self.shuffle {
            self.original_order = self.queue.clone();
            self.shuffle_upcoming();
        } else if let Some(cur_id) = self.current().map(|t| t.id.clone()) {
            let queue_ids: HashSet<String> = self.queue.iter().map(|t| t.id.clone()).collect();
            let orig_ids: HashSet<String> =
                self.original_order.iter().map(|t| t.id.clone()).collect();
            let mut restored: Vec<Track> = self
                .original_order
                .iter()
                .filter(|t| queue_ids.contains(&t.id))
                .cloned()
                .collect();
            for t in &self.queue {
                if !orig_ids.contains(&t.id) {
                    restored.push(t.clone());
                }
            }
            self.queue = restored;
            self.index = self
                .queue
                .iter()
                .position(|t| t.id == cur_id)
                .unwrap_or(0);
        }
    }

    pub fn cycle_repeat(&mut self) -> RepeatMode {
        self.repeat = self.repeat.cycle();
        self.repeat
    }

    /// Returns `Some(AdvanceAction)` describing how playback should advance.
    pub fn advance_step(&mut self, natural: bool) -> AdvanceOutcome {
        if natural && self.repeat == RepeatMode::One && self.current().is_some() {
            return AdvanceOutcome::ReplayCurrent;
        }
        if self.index + 1 < self.queue.len() {
            self.index += 1;
            AdvanceOutcome::LoadCurrent
        } else if self.repeat == RepeatMode::All && !self.queue.is_empty() {
            self.index = 0;
            AdvanceOutcome::LoadCurrent
        } else {
            AdvanceOutcome::NeedAutoplay
        }
    }

    pub fn previous_step(&mut self, current_time: f64) -> PreviousOutcome {
        if current_time > 3.0 || self.index == 0 {
            PreviousOutcome::SeekZero
        } else {
            self.index -= 1;
            PreviousOutcome::LoadCurrent
        }
    }

    pub fn append_autoplay(&mut self, tracks: Vec<Track>) -> usize {
        let existing: HashSet<String> = self.queue.iter().map(|t| t.id.clone()).collect();
        let fresh: Vec<Track> = tracks
            .into_iter()
            .filter(|t| !existing.contains(&t.id))
            .collect();
        let added = fresh.len();
        if added > 0 {
            self.queue.extend(fresh.clone());
            self.original_order.extend(fresh);
        }
        added
    }

    fn shuffle_upcoming(&mut self) {
        if self.index + 1 >= self.queue.len() {
            return;
        }
        let tail = &mut self.queue[self.index + 1..];
        // Simple deterministic-free Fisher-Yates using system nanos
        let mut seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9e37_79b9_7f4a_7c15);
        for i in (1..tail.len()).rev() {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let j = (seed >> 32) as usize % (i + 1);
            tail.swap(i, j);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdvanceOutcome {
    ReplayCurrent,
    LoadCurrent,
    NeedAutoplay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviousOutcome {
    SeekZero,
    LoadCurrent,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_tracks(n: usize) -> Vec<Track> {
        (0..n).map(|i| Track::new(format!("t{i}"), format!("Track {i}"))).collect()
    }

    #[test]
    fn queue_shuffle_preserves_current_and_restores_original() {
        let mut q = PlaybackQueue::default();
        q.play(mk_tracks(6), 2);
        assert_eq!(q.current().unwrap().id, "t2");

        q.toggle_shuffle();
        assert!(q.shuffle);
        assert_eq!(q.current().unwrap().id, "t2");
        assert_eq!(q.queue[..=2].iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["t0", "t1", "t2"]);

        q.toggle_shuffle();
        assert!(!q.shuffle);
        assert_eq!(
            q.queue.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            vec!["t0", "t1", "t2", "t3", "t4", "t5"]
        );
        assert_eq!(q.index, 2);
    }

    #[test]
    fn queue_remove_and_move_adjust_index() {
        let mut q = PlaybackQueue::default();
        q.play(mk_tracks(4), 2);
        assert!(!q.remove(2)); // cannot remove playing track
        assert!(q.remove(0));
        assert_eq!(q.index, 1);
        assert_eq!(q.current().unwrap().id, "t2");

        assert!(q.move_item(1, 0));
        assert_eq!(q.index, 0);
        assert_eq!(q.current().unwrap().id, "t2");
    }

    #[test]
    fn repeat_modes_advance_correctly() {
        let mut q = PlaybackQueue::default();
        q.play(mk_tracks(2), 1);
        assert_eq!(q.advance_step(true), AdvanceOutcome::NeedAutoplay);

        q.repeat = RepeatMode::All;
        assert_eq!(q.advance_step(true), AdvanceOutcome::LoadCurrent);
        assert_eq!(q.index, 0);

        q.repeat = RepeatMode::One;
        assert_eq!(q.advance_step(true), AdvanceOutcome::ReplayCurrent);
        assert_eq!(q.advance_step(false), AdvanceOutcome::LoadCurrent);
        assert_eq!(q.index, 1);
    }
}

