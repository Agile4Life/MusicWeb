use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// Deserializes `Option<String>` tolerating numbers (`123` -> `"123"`) and ignoring bad types.
pub fn lossy_opt_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let val = Option::<Value>::deserialize(deserializer)?;
    Ok(val.and_then(value_to_string))
}

/// Deserializes `String` falling back to `fallback` when missing/invalid.
pub fn lossy_string_or<'de, D>(deserializer: D, fallback: &str) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let opt = lossy_opt_string(deserializer)?;
    Ok(match opt {
        Some(s) if !s.is_empty() => s,
        _ => fallback.to_string(),
    })
}

pub fn lossy_title<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    lossy_string_or(deserializer, "Không có tên")
}

pub fn lossy_playlist_name<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    lossy_string_or(deserializer, "Playlist")
}

/// Deserializes `Option<f64>` tolerating numeric strings (`"180.5"` -> `Some(180.5)`).
pub fn lossy_opt_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    let val = Option::<Value>::deserialize(deserializer)?;
    Ok(val.and_then(|v| match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok().filter(|x| x.is_finite()),
        _ => None,
    }))
}

pub fn lossy_opt_u32<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(lossy_opt_f64(deserializer)?.map(|f| f.max(0.0).round() as u32))
}

pub fn lossy_opt_bool<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    let val = Option::<Value>::deserialize(deserializer)?;
    Ok(val.and_then(|v| match v {
        Value::Bool(b) => Some(b),
        Value::Number(n) => n.as_i64().map(|i| i != 0),
        Value::String(s) => match s.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" => Some(false),
            _ => None,
        },
        _ => None,
    }))
}

/// Deserializes a JSON array while dropping individual elements that fail to decode as `T`.
pub fn lossy_vec<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    let raw = Option::<Vec<Value>>::deserialize(deserializer)?;
    Ok(decode_lossy_values(raw))
}

pub fn lossy_opt_vec<'de, D, T>(deserializer: D) -> Result<Option<Vec<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    let raw = Option::<Vec<Value>>::deserialize(deserializer)?;
    Ok(raw.map(|items| decode_lossy_values(Some(items))))
}

fn decode_lossy_values<T: DeserializeOwned>(raw: Option<Vec<Value>>) -> Vec<T> {
    let Some(items) = raw else {
        return Vec::new();
    };
    items
        .into_iter()
        .filter_map(|v| serde_json::from_value::<T>(v).ok())
        .collect()
}

fn value_to_string(v: Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(i.to_string())
            } else if let Some(u) = n.as_u64() {
                Some(u.to_string())
            } else if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 && f.abs() < 1e15 {
                    Some(format!("{f:.0}"))
                } else {
                    Some(f.to_string())
                }
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Item {
        #[serde(deserialize_with = "lossy_title")]
        title: String,
        #[serde(default, deserialize_with = "lossy_opt_f64")]
        duration: Option<f64>,
    }

    #[derive(Debug, Deserialize)]
    struct Wrapper {
        #[serde(default, deserialize_with = "lossy_vec")]
        items: Vec<Item>,
    }

    #[test]
    fn lossy_vec_drops_invalid_elements_and_parses_mixed_types() {
        let json = r#"{
            "items": [
                { "title": 42, "duration": "215.5" },
                "not-an-object",
                { "title": "Valid Song", "duration": 180 },
                null
            ]
        }"#;
        let parsed: Wrapper = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.items.len(), 2);
        assert_eq!(parsed.items[0].title, "42");
        assert_eq!(parsed.items[0].duration, Some(215.5));
        assert_eq!(parsed.items[1].title, "Valid Song");
        assert_eq!(parsed.items[1].duration, Some(180.0));
    }
}

