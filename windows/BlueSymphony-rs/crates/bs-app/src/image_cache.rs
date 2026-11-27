use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use iced::Color;
use iced::widget::image::Handle;
use image::{DynamicImage, imageops::FilterType};
use tokio::sync::Semaphore;

const MAX_CACHE_BYTES: u64 = 250 * 1024 * 1024;
const TRIM_TARGET_BYTES: u64 = 180 * 1024 * 1024;
const MAX_MEM_ENTRIES: usize = 600;

#[derive(Debug, Clone)]
pub struct CachedArtwork {
    pub handle: Handle,
    pub palette: [Color; 3],
}

pub struct ImageCache {
    dir: PathBuf,
    http: reqwest::Client,
    download_sem: Arc<Semaphore>,
    entries: HashMap<String, CachedArtwork>,
    in_flight: HashSet<String>,
    failed: HashSet<String>,
}

impl ImageCache {
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&cache_dir);
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("BlueSymphony-Windows/0.1.0")
            .build()
            .expect("image http client");

        Self {
            dir: cache_dir,
            http,
            download_sem: Arc::new(Semaphore::new(12)),
            entries: HashMap::new(),
            in_flight: HashSet::new(),
            failed: HashSet::new(),
        }
    }

    pub fn get(&self, url: &str) -> Option<&CachedArtwork> {
        self.entries.get(url)
    }

    pub fn should_fetch(&self, url: &str) -> bool {
        !url.is_empty()
            && url.starts_with("http")
            && !self.entries.contains_key(url)
            && !self.in_flight.contains(url)
            && !self.failed.contains(url)
    }

    pub fn mark_in_flight(&mut self, url: String) {
        self.in_flight.insert(url);
    }

    pub fn insert(&mut self, url: String, result: Option<CachedArtwork>) {
        self.in_flight.remove(&url);
        if let Some(art) = result {
            if self.entries.len() >= MAX_MEM_ENTRIES {
                let keys: Vec<String> = self.entries.keys().take(60).cloned().collect();
                for k in keys {
                    self.entries.remove(&k);
                }
            }
            self.entries.insert(url, art);
        } else {
            self.failed.insert(url);
        }
    }

    pub fn reset_failures(&mut self) {
        self.failed.clear();
    }

    pub fn clear_all(&mut self) {
        self.entries.clear();
        self.in_flight.clear();
        self.failed.clear();
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for entry in rd.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    pub fn disk_usage_bytes(&self) -> u64 {
        dir_size(&self.dir)
    }

    pub fn spawn_fetch(&self, url: String) -> impl std::future::Future<Output = (String, Option<CachedArtwork>)> + Send + 'static {
        let dir = self.dir.clone();
        let http = self.http.clone();
        let sem = Arc::clone(&self.download_sem);
        async move {
            let loaded = fetch_and_decode(&http, &sem, &dir, &url).await;
            (url, loaded)
        }
    }
}

async fn fetch_and_decode(
    http: &reqwest::Client,
    sem: &Semaphore,
    cache_dir: &Path,
    url: &str,
) -> Option<CachedArtwork> {
    let key = fnv1a_hex(url);
    let file_path = cache_dir.join(format!("{key}.img"));

    let raw_bytes = if let Ok(disk) = tokio::fs::read(&file_path).await {
        if !disk.is_empty() {
            disk
        } else {
            let _permit = sem.acquire().await.ok()?;
            match download_and_save(http, cache_dir, &file_path, url).await {
                Some(b) => b,
                None => {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    download_and_save(http, cache_dir, &file_path, url).await?
                }
            }
        }
    } else {
        let _permit = sem.acquire().await.ok()?;
        match download_and_save(http, cache_dir, &file_path, url).await {
            Some(b) => b,
            None => {
                tokio::time::sleep(Duration::from_millis(250)).await;
                download_and_save(http, cache_dir, &file_path, url).await?
            }
        }
    };

    tokio::task::spawn_blocking(move || decode_and_extract(&raw_bytes))
        .await
        .ok()
        .flatten()
}

async fn download_and_save(
    http: &reqwest::Client,
    cache_dir: &Path,
    file_path: &Path,
    url: &str,
) -> Option<Vec<u8>> {
    let res = http.get(url).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    let bytes = res.bytes().await.ok()?.to_vec();
    if bytes.is_empty() {
        return None;
    }

    let dir_clone = cache_dir.to_path_buf();
    let path_clone = file_path.to_path_buf();
    let bytes_clone = bytes.clone();
    tokio::spawn(async move {
        let _ = tokio::fs::write(&path_clone, bytes_clone).await;
        trim_disk_cache(&dir_clone);
    });

    Some(bytes)
}

fn decode_and_extract(bytes: &[u8]) -> Option<CachedArtwork> {
    let img = image::load_from_memory(bytes).ok()?;
    let palette = extract_palette(&img);
    let resized = if img.width() > 512 || img.height() > 512 {
        img.resize(512, 512, FilterType::Triangle)
    } else {
        img
    };
    let rgba = resized.to_rgba8();
    let (w, h) = rgba.dimensions();
    let handle = Handle::from_rgba(w, h, rgba.into_raw());
    Some(CachedArtwork { handle, palette })
}

fn extract_palette(img: &DynamicImage) -> [Color; 3] {
    let tiny = img.resize_exact(24, 24, FilterType::Nearest).to_rgb8();
    let mut candidates: Vec<(f32, Color)> = Vec::new();

    for px in tiny.pixels() {
        let r = px[0] as f32 / 255.0;
        let g = px[1] as f32 / 255.0;
        let b = px[2] as f32 / 255.0;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let sat = if max > 0.0 { (max - min) / max } else { 0.0 };

        if lum > 0.10 && lum < 0.85 && sat > 0.16 {
            let score = sat * (1.0 - (lum - 0.45).abs());
            candidates.push((score, Color::from_rgb(r, g, b)));
        }
    }

    candidates.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut picked: Vec<Color> = Vec::with_capacity(3);
    for (_, col) in candidates {
        let distinct = picked.iter().all(|c| color_distance(*c, col) > 0.26);
        if distinct {
            picked.push(col);
            if picked.len() == 3 {
                break;
            }
        }
    }

    let fallback = [
        Color::from_rgb8(56, 189, 248),
        Color::from_rgb8(168, 85, 247),
        Color::from_rgb8(236, 72, 153),
    ];

    [
        picked.first().copied().unwrap_or(fallback[0]),
        picked.get(1).copied().unwrap_or(picked.first().copied().unwrap_or(fallback[1])),
        picked.get(2).copied().unwrap_or(fallback[2]),
    ]
}

fn color_distance(a: Color, b: Color) -> f32 {
    let dr = a.r - b.r;
    let dg = a.g - b.g;
    let db = a.b - b.b;
    (dr * dr + dg * dg + db * db).sqrt()
}

fn fnv1a_hex(s: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return 0;
    };
    rd.flatten()
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

fn trim_disk_cache(dir: &Path) {
    let total = dir_size(dir);
    if total <= MAX_CACHE_BYTES {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = rd
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            Some((e.path(), meta.len(), mtime))
        })
        .collect();

    files.sort_by_key(|(_, _, t)| *t);
    let mut current = total;
    for (path, len, _) in files {
        if current <= TRIM_TARGET_BYTES {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            current = current.saturating_sub(len);
        }
    }
}

