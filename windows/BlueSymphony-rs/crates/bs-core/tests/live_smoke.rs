use bs_core::api::ApiClient;
use bs_core::auth::AuthService;
use bs_core::config::AppConfig;
use bs_core::lyrics::LyricsService;
use bs_core::nct::NctClient;
use bs_core::resolver::StreamResolver;

#[tokio::test]
#[ignore = "hits live www.bluesymphony.site and graph.nhaccuatui.com endpoints"]
async fn live_backend_and_nct_smoke() {
    let config = AppConfig::load();
    let api = ApiClient::new(&config).expect("api client");
    let nct = NctClient::new(api.http().clone());
    let resolver = StreamResolver::new(api.clone(), nct.clone());

    // 1. Auth session (signed out returns empty cleanly, never 500)
    let session = AuthService::session_info(&api).await;
    println!("session email: {:?}", session.email);

    // 2. Trending
    let trending = api.trending().await.expect("GET /api/trending");
    println!("trending count: {}", trending.len());
    assert!(!trending.is_empty(), "expected non-empty trending tracks");

    // 3. New releases
    let releases = api.new_releases().await.expect("GET /api/albums/new-releases");
    println!("new releases count: {}", releases.len());
    assert!(!releases.is_empty(), "expected non-empty new releases");

    // 4. SoundCloud explore
    let sc = api
        .soundcloud_explore("v-pop", 5)
        .await
        .expect("GET /api/soundcloud/explore");
    println!("soundcloud v-pop count: {}", sc.len());
    assert!(!sc.is_empty(), "expected non-empty soundcloud explore tracks");

    // 5. NCT Top 50 + resolve 1 stream URL + fetch lyrics
    let (title, nct_tracks) = nct.chart().await.expect("NCT chart");
    println!("NCT chart '{}' count: {}", title, nct_tracks.len());
    assert!(!nct_tracks.is_empty(), "expected non-empty NCT chart");

    let sample = &nct_tracks[0];
    let stream = resolver.resolve_url(sample, false).await;
    println!(
        "Resolved '{}' ({}) -> {:?}",
        sample.title,
        sample.artist_name(),
        stream.as_deref().map(|u| &u[..u.len().min(64)])
    );
    assert!(stream.is_some(), "expected playable stream URL for NCT #1");

    let lyrics = LyricsService::fetch(&api, sample).await;
    println!(
        "Lyrics lines for '{}': {}",
        sample.title,
        lyrics.as_ref().map(|l| l.lines.len()).unwrap_or(0)
    );
}

