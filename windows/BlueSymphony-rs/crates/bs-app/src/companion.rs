use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{Datelike, Duration as ChronoDuration, Utc};
use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair,
    KeyUsagePurpose, SanType, SerialNumber, date_time_ymd,
};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio_rustls::TlsAcceptor;

use crate::state::IPhoneCalMode;

const MAX_UPLOAD_BODY_BYTES: usize = 12 * 1024 * 1024;
const CA_KEY_FILE: &str = "companion_ca.key";
const CA_CRT_FILE: &str = "companion_ca.crt";
const CA_DER_FILE: &str = "companion_ca.der";

#[derive(Debug, Clone)]
pub enum CompanionPhase {
    Idle,
    Monitoring,
    Recording {
        seq: u64,
        mode: IPhoneCalMode,
        duration_ms: u32,
        channel_label: String,
    },
    Analyzing,
    Done {
        message: String,
    },
    Error {
        message: String,
    },
}

impl CompanionPhase {
    fn as_wire_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Monitoring => "monitoring",
            Self::Recording { .. } => "recording",
            Self::Analyzing => "analyzing",
            Self::Done { .. } => "done",
            Self::Error { .. } => "error",
        }
    }
}

#[derive(Debug, Clone)]
pub enum CompanionEvent {
    Started {
        url: String,
        ca_url: String,
    },
    StartFailed(String),
    ClientConnected {
        label: String,
    },
    MicLevel {
        rms_dbfs: f32,
        peak_dbfs: f32,
        clipping: bool,
        sample_rate: u32,
    },
    RemoteStartRequested,
    AudioUploaded {
        seq: u64,
        sample_rate: u32,
        mode: IPhoneCalMode,
        samples: Vec<f32>,
    },
}

struct CompanionShared {
    token: String,
    phase: CompanionPhase,
    mode: IPhoneCalMode,
    step: u8,
    ca_pem: Vec<u8>,
    client_announced: bool,
    last_ping: Option<Instant>,
}

#[derive(Clone)]
pub struct CompanionHandle {
    shared: Arc<Mutex<CompanionShared>>,
    shutdown_tx: watch::Sender<bool>,
}

impl CompanionHandle {
    pub fn set_phase(&self, phase: CompanionPhase) {
        if let Ok(mut g) = self.shared.lock() {
            g.phase = phase;
        }
    }

    pub fn set_mode(&self, mode: IPhoneCalMode) {
        if let Ok(mut g) = self.shared.lock() {
            g.mode = mode;
        }
    }

    pub fn set_step(&self, step: u8) {
        if let Ok(mut g) = self.shared.lock() {
            g.step = step;
        }
    }

    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.send(true);
    }
}

#[derive(Serialize)]
struct WireStateResponse {
    phase: &'static str,
    mode: &'static str,
    seq: u64,
    duration_ms: u32,
    channel: String,
    message: String,
    step: u8,
}

#[derive(Deserialize)]
struct LevelPayload {
    rms: f32,
    peak: f32,
    clip: bool,
    sr: Option<u32>,
}

pub fn spawn_companion_server(
    data_dir: &Path,
    initial_step: u8,
    initial_mode: IPhoneCalMode,
    tx: mpsc::UnboundedSender<CompanionEvent>,
) -> CompanionHandle {
    let token = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
    let shared = Arc::new(Mutex::new(CompanionShared {
        token: token.clone(),
        phase: if initial_step <= 2 {
            CompanionPhase::Monitoring
        } else {
            CompanionPhase::Idle
        },
        mode: initial_mode,
        step: initial_step,
        ca_pem: Vec::new(),
        client_announced: false,
        last_ping: None,
    }));
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    let data_dir = data_dir.to_path_buf();
    let shared_bg = Arc::clone(&shared);
    std::thread::Builder::new()
        .name("bs-companion-https".to_string())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(CompanionEvent::StartFailed(format!(
                        "Không khởi tạo được async runtime: {e}"
                    )));
                    return;
                }
            };

            rt.block_on(async move {
                let lan_ip = detect_lan_ip();
                let (acceptor, ca_pem) = match load_or_create_tls_config(&data_dir, lan_ip) {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = tx.send(CompanionEvent::StartFailed(format!(
                            "Không tạo được chứng chỉ HTTPS LAN: {e}"
                        )));
                        return;
                    }
                };
                if let Ok(mut g) = shared_bg.lock() {
                    g.ca_pem = ca_pem;
                }

                let listener = match bind_lan_port().await {
                    Ok(l) => l,
                    Err(e) => {
                        let _ = tx.send(CompanionEvent::StartFailed(format!(
                            "Không mở được cổng HTTPS nội mạng: {e}"
                        )));
                        return;
                    }
                };
                let port = listener.local_addr().map(|a| a.port()).unwrap_or(8443);
                let url = format!("https://{lan_ip}:{port}/?t={token}");
                let ca_url = format!("https://{lan_ip}:{port}/ca.crt?t={token}");

                let _ = tx.send(CompanionEvent::Started { url, ca_url });

                loop {
                    tokio::select! {
                        changed = shutdown_rx.changed() => {
                            if changed.is_err() || *shutdown_rx.borrow() {
                                break;
                            }
                        }
                        accept_res = listener.accept() => {
                            match accept_res {
                                Ok((stream, _addr)) => {
                                    let acc = acceptor.clone();
                                    let sh = Arc::clone(&shared_bg);
                                    let evt_tx = tx.clone();
                                    tokio::spawn(async move {
                                        let _ = tokio::time::timeout(
                                            Duration::from_secs(20),
                                            handle_client_connection(stream, acc, sh, evt_tx),
                                        )
                                        .await;
                                    });
                                }
                                Err(e) => {
                                    tracing::warn!("Companion accept error: {e}");
                                    tokio::time::sleep(Duration::from_millis(50)).await;
                                }
                            }
                        }
                    }
                }
            });
        })
        .expect("spawn companion https thread");

    CompanionHandle {
        shared,
        shutdown_tx,
    }
}

async fn bind_lan_port() -> std::io::Result<TcpListener> {
    for port in 8443..=8453 {
        if let Ok(l) = TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await {
            return Ok(l);
        }
    }
    TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], 0))).await
}

pub fn detect_lan_ip() -> IpAddr {
    for probe in ["8.8.8.8:80", "192.168.1.1:80", "10.0.0.1:80", "172.16.0.1:80"] {
        if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(probe).is_ok() {
                if let Ok(addr) = sock.local_addr() {
                    let ip = addr.ip();
                    if ip.is_ipv4() && !ip.is_loopback() && !ip.is_unspecified() {
                        return ip;
                    }
                }
            }
        }
    }
    IpAddr::V4(Ipv4Addr::LOCALHOST)
}

fn load_or_create_tls_config(data_dir: &Path, lan_ip: IpAddr) -> Result<(TlsAcceptor, Vec<u8>), String> {
    let _ = std::fs::create_dir_all(data_dir);
    let key_path = data_dir.join(CA_KEY_FILE);
    let crt_path = data_dir.join(CA_CRT_FILE);
    let der_path = data_dir.join(CA_DER_FILE);

    let mut ca_params = CertificateParams::default();
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params
        .distinguished_name
        .push(DnType::CommonName, "BlueSymphony Local Calibration CA");
    ca_params
        .distinguished_name
        .push(DnType::OrganizationName, "BlueSymphony");
    ca_params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    ca_params.serial_number = Some(SerialNumber::from_slice(&[0x42, 0x53, 0xCA, 0x01, 0x20, 0x26]));
    ca_params.not_before = date_time_ymd(2025, 1, 1);
    ca_params.not_after = date_time_ymd(2035, 1, 1);

    let (ca_key, ca_cert, ca_pem_bytes, ca_der_bytes) =
        if key_path.exists() && crt_path.exists() && der_path.exists() {
            match (
                std::fs::read_to_string(&key_path),
                std::fs::read(&crt_path),
                std::fs::read(&der_path),
            ) {
                (Ok(k_pem), Ok(crt_bytes), Ok(der_bytes)) => {
                    if let Ok(kp) = KeyPair::from_pem(&k_pem) {
                        if let Ok(cert) = ca_params.clone().self_signed(&kp) {
                            (kp, cert, crt_bytes, der_bytes)
                        } else {
                            create_new_ca(&ca_params, &key_path, &crt_path, &der_path)?
                        }
                    } else {
                        create_new_ca(&ca_params, &key_path, &crt_path, &der_path)?
                    }
                }
                _ => create_new_ca(&ca_params, &key_path, &crt_path, &der_path)?,
            }
        } else {
            create_new_ca(&ca_params, &key_path, &crt_path, &der_path)?
        };

    // Apple TLS policy limits leaf certificates to <= 397 days validity
    let today = Utc::now().date_naive();
    let yesterday = today - ChronoDuration::days(1);
    let next_year = today + ChronoDuration::days(365);

    let mut leaf_params = CertificateParams::new(vec!["localhost".to_string()])
        .map_err(|e| format!("SAN localhost: {e}"))?;
    leaf_params.is_ca = IsCa::NoCa;
    leaf_params
        .distinguished_name
        .push(DnType::CommonName, lan_ip.to_string());
    leaf_params.subject_alt_names = vec![
        SanType::IpAddress(lan_ip),
        SanType::DnsName("localhost".try_into().map_err(|e| format!("DNS SAN: {e}"))?),
    ];
    leaf_params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    leaf_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    leaf_params.not_before = date_time_ymd(yesterday.year(), yesterday.month() as u8, yesterday.day() as u8);
    leaf_params.not_after = date_time_ymd(next_year.year(), next_year.month() as u8, next_year.day() as u8);

    let leaf_key = KeyPair::generate().map_err(|e| format!("KeyPair::generate leaf: {e}"))?;
    let leaf_cert = leaf_params
        .signed_by(&leaf_key, &ca_cert, &ca_key)
        .map_err(|e| format!("signed_by: {e}"))?;

    let chain = vec![
        CertificateDer::from(leaf_cert.der().to_vec()),
        CertificateDer::from(ca_der_bytes),
    ];
    let key_der = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(leaf_key.serialize_der()));

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let server_cfg = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("rustls versions: {e}"))?
        .with_no_client_auth()
        .with_single_cert(chain, key_der)
        .map_err(|e| format!("rustls cert: {e}"))?;

    Ok((TlsAcceptor::from(Arc::new(server_cfg)), ca_pem_bytes))
}

fn create_new_ca(
    ca_params: &CertificateParams,
    key_path: &Path,
    crt_path: &Path,
    der_path: &Path,
) -> Result<(KeyPair, rcgen::Certificate, Vec<u8>, Vec<u8>), String> {
    let ca_key = KeyPair::generate().map_err(|e| format!("KeyPair::generate CA: {e}"))?;
    let ca_cert = ca_params
        .clone()
        .self_signed(&ca_key)
        .map_err(|e| format!("CA self_signed: {e}"))?;
    let key_pem = ca_key.serialize_pem();
    let crt_pem = ca_cert.pem();
    let crt_der = ca_cert.der().to_vec();

    let _ = std::fs::write(key_path, key_pem.as_bytes());
    let _ = std::fs::write(crt_path, crt_pem.as_bytes());
    let _ = std::fs::write(der_path, &crt_der);

    Ok((ca_key, ca_cert, crt_pem.into_bytes(), crt_der))
}

async fn handle_client_connection(
    tcp: tokio::net::TcpStream,
    acceptor: TlsAcceptor,
    shared: Arc<Mutex<CompanionShared>>,
    tx: mpsc::UnboundedSender<CompanionEvent>,
) {
    let Ok(mut tls) = acceptor.accept(tcp).await else {
        return;
    };

    let Some(req) = read_http_request(&mut tls).await else {
        return;
    };

    let (path, query_raw) = match req.target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (req.target.as_str(), ""),
    };
    let query = parse_query(query_raw);

    let (expected_token, ca_pem) = {
        let g = shared.lock().unwrap();
        (g.token.clone(), g.ca_pem.clone())
    };
    let provided_token = query
        .get("t")
        .map(String::as_str)
        .or_else(|| req.headers.get("x-bs-token").map(String::as_str))
        .unwrap_or("");

    if !constant_time_eq(provided_token.as_bytes(), expected_token.as_bytes()) {
        let _ = write_response(
            &mut tls,
            "403 Forbidden",
            "text/plain; charset=utf-8",
            b"Invalid or expired session token",
            &[],
        )
        .await;
        return;
    }

    match (req.method.as_str(), path) {
        ("GET", "/") => {
            let _ = write_response(
                &mut tls,
                "200 OK",
                "text/html; charset=utf-8",
                COMPANION_HTML.as_bytes(),
                &[],
            )
            .await;
        }
        ("GET", "/ca.crt") => {
            let _ = write_response(
                &mut tls,
                "200 OK",
                "application/x-x509-ca-cert",
                &ca_pem,
                &[(
                    "Content-Disposition",
                    "attachment; filename=\"BlueSymphony-LAN-CA.crt\"",
                )],
            )
            .await;
        }
        ("GET", "/api/state") => {
            let ua = req
                .headers
                .get("user-agent")
                .map(String::as_str)
                .unwrap_or("");
            let label = device_label_from_ua(ua);
            let wire = {
                let mut g = shared.lock().unwrap();
                g.last_ping = Some(Instant::now());
                if !g.client_announced {
                    g.client_announced = true;
                    let _ = tx.send(CompanionEvent::ClientConnected { label });
                }
                let (seq, duration_ms, channel, message, mode_wire) = match &g.phase {
                    CompanionPhase::Recording {
                        seq,
                        mode,
                        duration_ms,
                        channel_label,
                    } => (
                        *seq,
                        *duration_ms,
                        channel_label.clone(),
                        String::new(),
                        mode_to_wire(*mode),
                    ),
                    CompanionPhase::Done { message } | CompanionPhase::Error { message } => {
                        (0, 0, String::new(), message.clone(), mode_to_wire(g.mode))
                    }
                    _ => (0, 0, String::new(), String::new(), mode_to_wire(g.mode)),
                };
                WireStateResponse {
                    phase: g.phase.as_wire_str(),
                    mode: mode_wire,
                    seq,
                    duration_ms,
                    channel,
                    message,
                    step: g.step,
                }
            };
            let body = serde_json::to_vec(&wire).unwrap_or_else(|_| b"{}".to_vec());
            let _ = write_response(&mut tls, "200 OK", "application/json", &body, &[]).await;
        }
        ("POST", "/api/level") => {
            if let Ok(lvl) = serde_json::from_slice::<LevelPayload>(&req.body) {
                let _ = tx.send(CompanionEvent::MicLevel {
                    rms_dbfs: lvl.rms.clamp(-90.0, 0.0),
                    peak_dbfs: lvl.peak.clamp(-90.0, 0.0),
                    clipping: lvl.clip,
                    sample_rate: lvl.sr.unwrap_or(48_000).clamp(8_000, 192_000),
                });
            }
            let _ = write_response(&mut tls, "200 OK", "application/json", br#"{"ok":true}"#, &[]).await;
        }
        ("POST", "/api/trigger") => {
            let _ = tx.send(CompanionEvent::RemoteStartRequested);
            let _ = write_response(&mut tls, "200 OK", "application/json", br#"{"ok":true}"#, &[]).await;
        }
        ("POST", "/api/upload") => {
            let seq = query
                .get("seq")
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            let sample_rate = query
                .get("sr")
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(48_000)
                .clamp(8_000, 192_000);
            let mode = match query.get("mode").map(String::as_str) {
                Some("ess") => IPhoneCalMode::SyncedFarinaEss,
                _ => IPhoneCalMode::MmmPinkNoise,
            };

            let mut samples = Vec::with_capacity(req.body.len() / 2);
            for pair in req.body.chunks_exact(2) {
                let s = i16::from_le_bytes([pair[0], pair[1]]);
                samples.push(s as f32 / 32768.0);
            }

            let _ = tx.send(CompanionEvent::AudioUploaded {
                seq,
                sample_rate,
                mode,
                samples,
            });
            let _ = write_response(&mut tls, "200 OK", "application/json", br#"{"ok":true}"#, &[]).await;
        }
        _ => {
            let _ = write_response(
                &mut tls,
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"Not Found",
                &[],
            )
            .await;
        }
    }
}

struct ParsedHttpRequest {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

async fn read_http_request(
    tls: &mut tokio_rustls::server::TlsStream<tokio::net::TcpStream>,
) -> Option<ParsedHttpRequest> {
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];
    let header_end;

    loop {
        let n = tls.read(&mut tmp).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_header_end(&buf) {
            header_end = pos;
            break;
        }
        if buf.len() > 32 * 1024 {
            return None;
        }
    }

    let head_str = std::str::from_utf8(&buf[..header_end]).ok()?;
    let mut lines = head_str.split("\r\n");
    let req_line = lines.next()?;
    let mut parts = req_line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let content_len = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if content_len > MAX_UPLOAD_BODY_BYTES {
        return None;
    }

    let body_start = header_end + 4;
    let mut body = Vec::with_capacity(content_len);
    if buf.len() > body_start {
        let avail = (buf.len() - body_start).min(content_len);
        body.extend_from_slice(&buf[body_start..body_start + avail]);
    }
    while body.len() < content_len {
        let n = tls.read(&mut tmp).await.ok()?;
        if n == 0 {
            break;
        }
        let need = (content_len - body.len()).min(n);
        body.extend_from_slice(&tmp[..need]);
    }

    Some(ParsedHttpRequest {
        method,
        target,
        headers,
        body,
    })
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

async fn write_response(
    tls: &mut tokio_rustls::server::TlsStream<tokio::net::TcpStream>,
    status: &str,
    content_type: &str,
    body: &[u8],
    extra_headers: &[(&str, &str)],
) -> std::io::Result<()> {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        body.len()
    );
    for (k, v) in extra_headers {
        head.push_str(k);
        head.push_str(": ");
        head.push_str(v);
        head.push_str("\r\n");
    }
    head.push_str("\r\n");
    tls.write_all(head.as_bytes()).await?;
    tls.write_all(body).await?;
    tls.flush().await
}

fn parse_query(q: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in q.split('&').filter(|s| !s.is_empty()) {
        if let Some((k, v)) = pair.split_once('=') {
            map.insert(k.to_string(), v.to_string());
        }
    }
    map
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn device_label_from_ua(ua: &str) -> String {
    if ua.contains("iPhone") {
        "iPhone (Safari LAN)".to_string()
    } else if ua.contains("iPad") {
        "iPad (Safari LAN)".to_string()
    } else if ua.contains("Android") {
        "Android (HTTPS LAN)".to_string()
    } else {
        "Thiết bị di động (LAN)".to_string()
    }
}

fn mode_to_wire(mode: IPhoneCalMode) -> &'static str {
    match mode {
        IPhoneCalMode::MmmPinkNoise => "mmm",
        IPhoneCalMode::SyncedFarinaEss => "ess",
    }
}

const COMPANION_HTML: &str = r##"<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>BlueSymphony — Micro đo phòng iPhone</title>
<style>
  :root {
    --bg: #111113;
    --card: #1c1c1f;
    --border: rgba(255,255,255,0.10);
    --text: #f5f5f7;
    --muted: rgba(245,245,247,0.62);
    --accent: #fa2d48;
    --green: #30d158;
    --amber: #ff9f0a;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0;
    min-height: 100dvh;
    background: radial-gradient(circle at 50% -10%, rgba(250,45,72,0.18), transparent 55%), var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    padding: max(18px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 480px;
    margin-inline: auto;
  }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .brand { font-size: 18px; font-weight: 700; letter-spacing: -0.2px; }
  .pill {
    font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 999px;
    background: rgba(255,255,255,0.08); color: var(--muted); border: 1px solid var(--border);
  }
  .pill.ok { color: var(--green); border-color: rgba(48,209,88,0.4); background: rgba(48,209,88,0.12); }
  .pill.rec { color: #fff; background: var(--accent); border-color: var(--accent); }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 18px;
    padding: 18px; display: flex; flex-direction: column; gap: 12px;
  }
  .title { font-size: 15px; font-weight: 650; }
  .sub { font-size: 13px; line-height: 1.45; color: var(--muted); }
  .vu-wrap {
    height: 14px; border-radius: 999px; background: rgba(255,255,255,0.08);
    overflow: hidden; border: 1px solid var(--border);
  }
  .vu-bar {
    height: 100%; width: 2%; border-radius: 999px;
    background: linear-gradient(90deg, #30d158, #ff9f0a 78%, #fa2d48);
    transition: width 90ms linear;
  }
  .db-row { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .prog-wrap { height: 6px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; display: none; }
  .prog-bar { height: 100%; width: 0%; background: var(--accent); transition: width 100ms linear; }
  button.primary {
    appearance: none; border: 0; border-radius: 999px; padding: 15px 18px;
    background: var(--accent); color: #fff; font-size: 15px; font-weight: 650;
    cursor: pointer; width: 100%;
  }
  button.primary:disabled { opacity: 0.45; }
  button.secondary {
    appearance: none; border: 1px solid var(--border); border-radius: 999px; padding: 12px 16px;
    background: rgba(255,255,255,0.06); color: var(--text); font-size: 14px; font-weight: 600;
    cursor: pointer; width: 100%;
  }
  button.secondary:disabled { opacity: 0.35; }
  details { font-size: 12.5px; color: var(--muted); }
  details summary { cursor: pointer; font-weight: 600; color: var(--text); }
  a.ca-link { color: #ff6477; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">BlueSymphony Mic</div>
    <div id="statusPill" class="pill">Chờ bật micro</div>
  </div>

  <div class="card">
    <div id="stageTitle" class="title">Cấp quyền micro iPhone để bắt đầu</div>
    <div id="stageSub" class="sub">
      Tín hiệu âm thanh thô (không chống ồn, không AGC) sẽ được gửi trực tiếp trong mạng Wi-Fi nội bộ về PC.
    </div>
    <div class="vu-wrap"><div id="vuBar" class="vu-bar"></div></div>
    <div class="db-row">
      <span id="rmsTxt">RMS: -- dBFS</span>
      <span id="srTxt">-- kHz</span>
    </div>
    <div id="progWrap" class="prog-wrap"><div id="progBar" class="prog-bar"></div></div>
  </div>

  <button id="enableBtn" class="primary">Bật Micro iPhone</button>
  <button id="startBtn" class="secondary" disabled>Bắt đầu đo phòng (điều khiển PC)</button>

  <div class="card">
    <details>
      <summary>Mẹo bỏ cảnh báo "Không riêng tư" trên Safari lần sau</summary>
      <p style="margin:8px 0 4px;line-height:1.45">
        1. <a id="caLink" class="ca-link" href="#">Tải chứng chỉ BlueSymphony LAN CA (.crt)</a> và cho phép tải hồ sơ.<br>
        2. Vào <b>Cài đặt → Đã tải về hồ sơ</b> để cài đặt, sau đó vào <b>Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng nhận</b> và bật tin cậy.
      </p>
    </details>
  </div>

<script>
const params = new URLSearchParams(location.search);
const TOKEN = params.get("t") || "";
const authQ = "t=" + encodeURIComponent(TOKEN);
document.getElementById("caLink").href = "/ca.crt?" + authQ;

const statusPill = document.getElementById("statusPill");
const stageTitle = document.getElementById("stageTitle");
const stageSub = document.getElementById("stageSub");
const vuBar = document.getElementById("vuBar");
const rmsTxt = document.getElementById("rmsTxt");
const srTxt = document.getElementById("srTxt");
const progWrap = document.getElementById("progWrap");
const progBar = document.getElementById("progBar");
const enableBtn = document.getElementById("enableBtn");
const startBtn = document.getElementById("startBtn");

let audioCtx = null;
let micEnabled = false;
let sampleRate = 48000;
let latestRms = -90, latestPeak = -90, latestClip = false;
let isRecording = false;
let recEndTime = 0;
let recStartTime = 0;
let recMode = "mmm";
let recSeq = 0;
let handledSeq = 0;
let uploadingSeq = 0;
let chunks = [];

enableBtn.addEventListener("click", async () => {
  try {
    enableBtn.disabled = true;
    enableBtn.textContent = "Đang mở micro…";
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: { ideal: 48000 }
      }
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx({ sampleRate: 48000 });
    await audioCtx.resume();
    sampleRate = audioCtx.sampleRate || 48000;
    srTxt.textContent = (sampleRate / 1000).toFixed(1) + " kHz";

    const src = audioCtx.createMediaStreamSource(stream);
    const proc = audioCtx.createScriptProcessor(4096, 1, 1);
    const zeroGain = audioCtx.createGain();
    zeroGain.gain.value = 0;

    proc.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      let sumSq = 0, pk = 0, clips = 0;
      for (let i = 0; i < input.length; i++) {
        const v = input[i];
        const a = v < 0 ? -v : v;
        if (a > pk) pk = a;
        if (a >= 0.985) clips++;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / Math.max(1, input.length));
      latestRms = 20 * Math.log10(Math.max(1e-6, rms));
      latestPeak = 20 * Math.log10(Math.max(1e-6, pk));
      latestClip = clips > 2 || latestPeak > -0.3;

      const frac = Math.min(1, Math.max(0.02, (latestRms + 75) / 70));
      vuBar.style.width = (frac * 100).toFixed(1) + "%";
      rmsTxt.textContent = "RMS: " + latestRms.toFixed(1) + " dBFS" + (latestClip ? " (CLIP)" : "");

      if (isRecording) {
        chunks.push(new Float32Array(input));
        const now = performance.now();
        const total = Math.max(1, recEndTime - recStartTime);
        const pct = Math.min(100, Math.max(0, ((now - recStartTime) / total) * 100));
        progBar.style.width = pct.toFixed(1) + "%";
        if (now >= recEndTime) {
          finishRecordingAndUpload();
        }
      }
    };

    src.connect(proc);
    proc.connect(zeroGain);
    zeroGain.connect(audioCtx.destination);

    if (navigator.wakeLock && navigator.wakeLock.request) {
      try { await navigator.wakeLock.request("screen"); } catch (_) {}
    }

    micEnabled = true;
    enableBtn.style.display = "none";
    startBtn.disabled = false;
    statusPill.textContent = "Micro sẵn sàng";
    statusPill.className = "pill ok";
    stageTitle.textContent = "iPhone đã kết nối với PC";
    stageSub.textContent = "Giữ iPhone hướng lên trên hoặc về phía loa. Bạn có thể bấm Bắt đầu ngay dưới đây hoặc trên PC.";
  } catch (err) {
    enableBtn.disabled = false;
    enableBtn.textContent = "Thử bật lại Micro";
    statusPill.textContent = "Lỗi micro";
    stageTitle.textContent = "Không truy cập được micro iPhone";
    stageSub.textContent = String(err);
  }
});

startBtn.addEventListener("click", async () => {
  if (!micEnabled || isRecording) return;
  try {
    startBtn.disabled = true;
    await fetch("/api/trigger?" + authQ, { method: "POST" });
  } catch (_) {
    startBtn.disabled = false;
  }
});

async function finishRecordingAndUpload() {
  if (!isRecording) return;
  isRecording = false;
  const seq = recSeq;
  const mode = recMode;
  uploadingSeq = seq;
  statusPill.textContent = "Đang gửi…";
  statusPill.className = "pill";
  stageTitle.textContent = "Đang gửi dữ liệu âm thanh sang PC…";
  stageSub.textContent = "Vui lòng giữ màn hình sáng trong giây lát.";

  let total = 0;
  for (const c of chunks) total += c.length;
  const pcm16 = new Int16Array(total);
  let off = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      let s = c[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      pcm16[off++] = s < 0 ? (s * 32768) | 0 : (s * 32767) | 0;
    }
  }
  chunks = [];

  try {
    await fetch(
      "/api/upload?" + authQ + "&seq=" + seq + "&sr=" + Math.round(sampleRate) + "&mode=" + encodeURIComponent(mode),
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: pcm16.buffer
      }
    );
  } catch (err) {
    stageTitle.textContent = "Gửi dữ liệu thất bại";
    stageSub.textContent = String(err);
  } finally {
    progWrap.style.display = "none";
    progBar.style.width = "0%";
    uploadingSeq = 0;
  }
}

setInterval(async () => {
  if (micEnabled && !isRecording && uploadingSeq === 0) {
    try {
      await fetch("/api/level?" + authQ, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rms: latestRms, peak: latestPeak, clip: latestClip, sr: Math.round(sampleRate) })
      });
    } catch (_) {}
  }

  try {
    const res = await fetch("/api/state?" + authQ, { cache: "no-store" });
    if (!res.ok) return;
    const st = await res.json();

    if (st.phase === "recording" && st.seq > 0 && st.seq !== handledSeq) {
      handledSeq = st.seq;
      if (!micEnabled) {
        statusPill.textContent = "Cần bật Micro!";
        stageTitle.textContent = "PC vừa bấm đo nhưng bạn chưa bật Micro iPhone";
        stageSub.textContent = "Hãy bấm nút đỏ 'Bật Micro iPhone' phía dưới rồi bấm Đo lại trên PC.";
        return;
      }
      chunks = [];
      recSeq = st.seq;
      recMode = st.mode || "mmm";
      recStartTime = performance.now();
      recEndTime = recStartTime + (st.duration_ms || 13400);
      isRecording = true;
      startBtn.disabled = true;
      progWrap.style.display = "block";
      progBar.style.width = "0%";
      statusPill.textContent = "Đang thu đo";
      statusPill.className = "pill rec";
      if (recMode === "ess") {
        stageTitle.textContent = "Đang quét Farina ESS (" + (st.channel || "Stereo") + ")";
        stageSub.textContent = "Giữ yên iPhone tại đúng vị trí tai nghe và giữ yên lặng.";
      } else {
        stageTitle.textContent = "Đang đo MMM Pink Noise (" + (st.channel || "Stereo") + ")";
        stageSub.textContent = "Cầm iPhone di chuyển chậm theo vòng tròn nhỏ quanh vị trí đầu nghe.";
      }
    } else if (!isRecording && uploadingSeq === 0) {
      startBtn.disabled = !micEnabled;
      if (st.phase === "analyzing") {
        statusPill.textContent = "Đang tính EQ…";
        statusPill.className = "pill";
        stageTitle.textContent = "PC đang phân tích đáp tuyến phòng…";
      } else if (st.phase === "done") {
        statusPill.textContent = "Hoàn tất";
        statusPill.className = "pill ok";
        stageTitle.textContent = st.message || "Đã đo xong! Xem kết quả Auto-EQ trên PC.";
        stageSub.textContent = "Bạn có thể tinh chỉnh đường mục tiêu và lưu thành profile trên PC.";
      } else if (st.phase === "error") {
        statusPill.textContent = "Có lỗi";
        statusPill.className = "pill";
        stageTitle.textContent = st.message || "Phiên đo gặp lỗi.";
      } else if (micEnabled) {
        statusPill.textContent = "Micro sẵn sàng";
        statusPill.className = "pill ok";
      }
    }
  } catch (_) {}
}, 200);
</script>
</body>
</html>
"##;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tls_pki_builds_valid_server_config_and_reuses_persisted_ca() {
        let dir = std::env::temp_dir().join(format!("bs_companion_test_{}", uuid::Uuid::new_v4()));
        let ip = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 50));

        let (_, ca1) = load_or_create_tls_config(&dir, ip).expect("first PKI build");
        assert!(!ca1.is_empty());
        assert!(dir.join(CA_KEY_FILE).exists());
        assert!(dir.join(CA_CRT_FILE).exists());
        assert!(dir.join(CA_DER_FILE).exists());

        let (_, ca2) = load_or_create_tls_config(&dir, ip).expect("second PKI reuse");
        assert_eq!(ca1, ca2, "persisted CA PEM should be reused cleanly");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_query_and_token_validation() {
        let q = parse_query("t=abc123&seq=7&sr=48000&mode=mmm");
        assert_eq!(q.get("t").map(String::as_str), Some("abc123"));
        assert_eq!(q.get("seq").map(String::as_str), Some("7"));
        assert_eq!(q.get("sr").map(String::as_str), Some("48000"));
        assert_eq!(q.get("mode").map(String::as_str), Some("mmm"));
        assert!(constant_time_eq(b"abc123", b"abc123"));
        assert!(!constant_time_eq(b"abc123", b"abc124"));
    }
}
