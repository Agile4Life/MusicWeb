fn main() {
    println!("cargo:rerun-if-changed=../../assets/app-icon.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../../assets/app-icon.ico");
        res.set("ProductName", "BlueSymphony");
        res.set("FileDescription", "BlueSymphony — Native Windows Music Player");
        res.set("CompanyName", "BlueSymphony");
        res.set("OriginalFilename", "BlueSymphony.exe");
        res.compile().expect("Failed to embed Windows icon resource");
    }
}

