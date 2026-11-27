use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::api::ApiClient;
use crate::models::{LyricLine, Lyrics, Track};

impl Lyrics {
    /// Parses LRC (`[mm:ss.xx] text`, multiple timestamps per line allowed).
    pub fn parse(raw: &str) -> Self {
        static STAMP_RE: OnceLock<Regex> = OnceLock::new();
        let stamp = STAMP_RE
            .get_or_init(|| Regex::new(r"\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]").expect("regex"));

        let mut items: Vec<(Option<f64>, String)> = Vec::new();
        for line in raw.lines() {
            let trimmed_line = line.trim();
            let caps: Vec<_> = stamp.captures_iter(trimmed_line).collect();
            let text = stamp.replace_all(trimmed_line, "").trim().to_string();

            if caps.is_empty() {
                if trimmed_line.starts_with('[')
                    && trimmed_line.contains(':')
                    && trimmed_line.ends_with(']')
                {
                    continue;
                }
                items.push((None, text));
            } else {
                for cap in caps {
                    let mins = cap[1].parse::<f64>().unwrap_or(0.0);
                    let secs_str = cap[2].replace(':', ".");
                    let secs = secs_str.parse::<f64>().unwrap_or(0.0);
                    items.push((Some(mins * 60.0 + secs), text.clone()));
                }
            }
        }

        let is_synced = items.iter().any(|(t, _)| t.is_some());
        if is_synced {
            items.retain(|(t, _)| t.is_some());
            items.sort_by(|a, b| {
                a.0.unwrap_or(0.0)
                    .partial_cmp(&b.0.unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }

        let lines = items
            .into_iter()
            .enumerate()
            .map(|(id, (time, text))| LyricLine { id, time, text })
            .collect();

        Self { lines }
    }

    pub fn is_synced(&self) -> bool {
        self.lines.iter().any(|l| l.time.is_some())
    }

    pub fn active_index(&self, current_time: f64) -> Option<usize> {
        if !self.is_synced() {
            return None;
        }
        self.lines
            .iter()
            .rposition(|l| l.time.unwrap_or(f64::INFINITY) <= current_time + 0.25)
    }

    pub fn has_cjk(&self) -> bool {
        self.lines.iter().any(|l| contains_cjk(&l.text))
    }
}

pub fn contains_cjk(text: &str) -> bool {
    text.chars().any(|c| {
        matches!(
            c as u32,
            0x3040..=0x30FF
                | 0x3400..=0x4DBF
                | 0x4E00..=0x9FFF
                | 0xF900..=0xFAFF
                | 0xAC00..=0xD7AF
        )
    })
}

pub struct LyricsService;

impl LyricsService {
    /// Custom admin-edited lyrics first, then LRCLIB exact/search (`lib/lrclib.ts` & `Lyrics.swift`).
    pub async fn fetch(api: &ApiClient, track: &Track) -> Option<Lyrics> {
        #[derive(Deserialize)]
        struct CustomReply {
            found: Option<bool>,
            #[serde(rename = "rawLyrics")]
            raw_lyrics: Option<String>,
        }

        let dur_str = track
            .duration
            .filter(|d| *d > 0.0)
            .map(|d| (d.round() as i64).to_string());
        let mut query: Vec<(&str, &str)> = vec![("title", &track.title)];
        if let Some(a) = track.artist.as_deref().filter(|s| !s.is_empty()) {
            query.push(("artist", a));
        }
        if let Some(al) = track.album.as_deref().filter(|s| !s.is_empty()) {
            query.push(("album", al));
        }
        if let Some(ref d) = dur_str {
            query.push(("duration", d));
        }
        if track.is_persisted() {
            query.push(("id", &track.id));
        }
        if let Some(s) = track.spotify_id.as_deref().filter(|s| !s.is_empty()) {
            query.push(("spotify_id", s));
        }
        if let Some(y) = track.youtube_id.as_deref().filter(|s| !s.is_empty()) {
            query.push(("youtube_id", y));
        }

        if let Ok(custom) = api.get_json::<CustomReply>("api/lyrics/custom", &query).await {
            if custom.found == Some(true) {
                if let Some(raw) = custom.raw_lyrics.filter(|s| !s.trim().is_empty()) {
                    let parsed = Lyrics::parse(&raw);
                    if !parsed.lines.is_empty() {
                        return Some(parsed);
                    }
                }
            }
        }

        let lrc = Self::fetch_lrclib(api.http(), track).await?;
        let text = [lrc.synced_lyrics, lrc.plain_lyrics]
            .into_iter()
            .flatten()
            .find(|s| !s.trim().is_empty())?;
        let parsed = Lyrics::parse(&text);
        if parsed.lines.is_empty() {
            None
        } else {
            Some(parsed)
        }
    }

    pub async fn fetch_romaji(api: &ApiClient, lines: &[String]) -> Vec<String> {
        if lines.is_empty() {
            return Vec::new();
        }
        if !lines.iter().any(|l| contains_cjk(l)) {
            return vec![String::new(); lines.len()];
        }

        #[derive(Serialize)]
        struct Body<'a> {
            lines: &'a [String],
        }
        #[derive(Deserialize)]
        struct Reply {
            #[serde(default)]
            romaji: Vec<String>,
        }

        if let Ok(r) = api
            .post_json::<Reply, _>("api/lyrics/romaji", &Body { lines })
            .await
        {
            if r.romaji.len() == lines.len() {
                return r.romaji;
            }
        }

        lines.iter().map(|l| kana_to_romaji_offline(l)).collect()
    }

    async fn fetch_lrclib(http: &reqwest::Client, track: &Track) -> Option<LrclibItem> {
        static CLEAN_RE: OnceLock<Regex> = OnceLock::new();
        let re =
            CLEAN_RE.get_or_init(|| Regex::new(r"[\(\[].*?[\)\]]").expect("valid clean regex"));

        let clean_title = re.replace_all(&track.title, "").trim().to_string();
        let primary_artist = track.primary_artist().unwrap_or_default();

        let mut get_params = vec![
            ("track_name", clean_title.as_str()),
            ("artist_name", primary_artist.as_str()),
        ];
        if let Some(al) = track.album.as_deref().filter(|s| !s.is_empty()) {
            get_params.push(("album_name", al));
        }
        let dur_str = track
            .duration
            .filter(|d| *d > 0.0)
            .map(|d| (d.round() as i64).to_string());
        if let Some(ref d) = dur_str {
            get_params.push(("duration", d));
        }

        let exact = lrclib_get::<LrclibItem>(http, "get", &get_params).await;
        if exact
            .as_ref()
            .and_then(|x| x.synced_lyrics.as_deref())
            .is_some_and(|s| !s.trim().is_empty())
        {
            return exact;
        }

        let search_params = vec![
            ("track_name", clean_title.as_str()),
            ("artist_name", primary_artist.as_str()),
        ];
        let hits = lrclib_get::<Vec<LrclibItem>>(http, "search", &search_params)
            .await
            .unwrap_or_default();

        hits.iter()
            .find(|h| {
                h.synced_lyrics
                    .as_deref()
                    .is_some_and(|s| !s.trim().is_empty())
            })
            .cloned()
            .or(exact)
            .or_else(|| hits.into_iter().next())
    }
}

#[derive(Debug, Clone, Deserialize)]
struct LrclibItem {
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
}

async fn lrclib_get<T: serde::de::DeserializeOwned>(
    http: &reqwest::Client,
    path: &str,
    params: &[(&str, &str)],
) -> Option<T> {
    let mut url = url::Url::parse(&format!("https://lrclib.net/api/{path}")).ok()?;
    {
        let mut pairs = url.query_pairs_mut();
        for (k, v) in params {
            pairs.append_pair(k, v);
        }
    }
    let res = http
        .get(url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    res.json::<T>().await.ok()
}

pub fn kana_to_romaji_offline(text: &str) -> String {
    static MAP: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    let map = MAP.get_or_init(|| {
        HashMap::from([
            ("あ", "a"), ("い", "i"), ("う", "u"), ("え", "e"), ("お", "o"),
            ("か", "ka"), ("き", "ki"), ("く", "ku"), ("け", "ke"), ("こ", "ko"),
            ("さ", "sa"), ("し", "shi"), ("す", "su"), ("せ", "se"), ("そ", "so"),
            ("た", "ta"), ("ち", "chi"), ("つ", "tsu"), ("て", "te"), ("と", "to"),
            ("な", "na"), ("に", "ni"), ("ぬ", "nu"), ("ね", "ne"), ("の", "no"),
            ("は", "ha"), ("ひ", "hi"), ("ふ", "fu"), ("へ", "he"), ("ほ", "ho"),
            ("ま", "ma"), ("み", "mi"), ("む", "mu"), ("め", "me"), ("も", "mo"),
            ("や", "ya"), ("ゆ", "yu"), ("よ", "yo"),
            ("ら", "ra"), ("り", "ri"), ("る", "ru"), ("れ", "re"), ("ろ", "ro"),
            ("わ", "wa"), ("を", "o"), ("ん", "n"),
            ("が", "ga"), ("ぎ", "gi"), ("ぐ", "gu"), ("げ", "ge"), ("ご", "go"),
            ("ざ", "za"), ("じ", "ji"), ("ず", "zu"), ("ぜ", "ze"), ("ぞ", "zo"),
            ("だ", "da"), ("ぢ", "ji"), ("づ", "zu"), ("で", "de"), ("ど", "do"),
            ("ば", "ba"), ("び", "bi"), ("ぶ", "bu"), ("べ", "be"), ("ぼ", "bo"),
            ("ぱ", "pa"), ("ぴ", "pi"), ("ぷ", "pu"), ("ぺ", "pe"), ("ぽ", "po"),
            ("きゃ", "kya"), ("きゅ", "kyu"), ("きょ", "kyo"),
            ("しゃ", "sha"), ("しゅ", "shu"), ("しょ", "sho"),
            ("ちゃ", "cha"), ("ちゅ", "chu"), ("ちょ", "cho"),
            ("にゃ", "nya"), ("にゅ", "nyu"), ("にょ", "nyo"),
            ("ひゃ", "hya"), ("ひゅ", "hyu"), ("ひょ", "hyo"),
            ("みゃ", "mya"), ("みゅ", "myu"), ("みょ", "myo"),
            ("りゃ", "rya"), ("りゅ", "ryu"), ("りょ", "ryo"),
            ("ぎゃ", "gya"), ("ぎゅ", "gyu"), ("ぎょ", "gyo"),
            ("じゃ", "ja"), ("じゅ", "ju"), ("じょ", "jo"),
            ("ア", "a"), ("イ", "i"), ("ウ", "u"), ("エ", "e"), ("オ", "o"),
            ("カ", "ka"), ("キ", "ki"), ("ク", "ku"), ("ケ", "ke"), ("コ", "ko"),
            ("サ", "sa"), ("シ", "shi"), ("ス", "su"), ("セ", "se"), ("ソ", "so"),
            ("タ", "ta"), ("チ", "chi"), ("ツ", "tsu"), ("テ", "te"), ("ト", "to"),
            ("ナ", "na"), ("ニ", "ni"), ("ヌ", "nu"), ("ネ", "ne"), ("ノ", "no"),
            ("ハ", "ha"), ("ヒ", "hi"), ("フ", "fu"), ("ヘ", "he"), ("ホ", "ho"),
            ("マ", "ma"), ("ミ", "mi"), ("ム", "mu"), ("メ", "me"), ("モ", "mo"),
            ("ヤ", "ya"), ("ユ", "yu"), ("ヨ", "yo"),
            ("ラ", "ra"), ("リ", "ri"), ("ル", "ru"), ("レ", "re"), ("ロ", "ro"),
            ("ワ", "wa"), ("ヲ", "o"), ("ン", "n"),
        ])
    });

    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        if i + 1 < chars.len() {
            let pair: String = [chars[i], chars[i + 1]].iter().collect();
            if let Some(rom) = map.get(pair.as_str()) {
                out.push_str(rom);
                i += 2;
                continue;
            }
        }
        let single: String = [chars[i]].iter().collect();
        if let Some(rom) = map.get(single.as_str()) {
            out.push_str(rom);
        } else {
            out.push(chars[i]);
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lrc_parser_handles_multi_stamps_metadata_and_active_index() {
        let raw = "\
[ar:Sơn Tùng M-TP]
[ti:Test]
[00:10.50][00:30.00]Chorus line
[00:05.00]First line
";
        let lyrics = Lyrics::parse(raw);
        assert!(lyrics.is_synced());
        assert_eq!(lyrics.lines.len(), 3);
        assert_eq!(lyrics.lines[0].text, "First line");
        assert_eq!(lyrics.lines[0].time, Some(5.0));
        assert_eq!(lyrics.lines[1].text, "Chorus line");
        assert_eq!(lyrics.lines[1].time, Some(10.5));
        assert_eq!(lyrics.lines[2].time, Some(30.0));

        assert_eq!(lyrics.active_index(4.5), None);
        assert_eq!(lyrics.active_index(4.8), Some(0)); // +0.25s offset
        assert_eq!(lyrics.active_index(12.0), Some(1));
        assert_eq!(lyrics.active_index(31.0), Some(2));
    }

    #[test]
    fn plain_lyrics_fallback_works() {
        let lyrics = Lyrics::parse("Line A\nLine B");
        assert!(!lyrics.is_synced());
        assert_eq!(lyrics.lines.len(), 2);
        assert_eq!(lyrics.active_index(5.0), None);
    }
}

