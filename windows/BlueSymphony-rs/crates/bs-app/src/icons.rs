use iced::Color;
use iced::widget::svg::{self, Handle, Svg};

macro_rules! icon_svg {
    ($name:ident, $body:expr) => {
        pub fn $name<'a>(size: f32, color: Color) -> Svg<'a> {
            static BYTES: &[u8] = concat!(
                r##"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">"##,
                $body,
                r"</svg>"
            )
            .as_bytes();
            svg::Svg::new(Handle::from_memory(BYTES))
                .width(size)
                .height(size)
                .style(move |_theme, _status| svg::Style { color: Some(color) })
        }
    };
}

macro_rules! filled_icon_svg {
    ($name:ident, $body:expr) => {
        pub fn $name<'a>(size: f32, color: Color) -> Svg<'a> {
            static BYTES: &[u8] = concat!(
                r##"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#ffffff" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">"##,
                $body,
                r"</svg>"
            )
            .as_bytes();
            svg::Svg::new(Handle::from_memory(BYTES))
                .width(size)
                .height(size)
                .style(move |_theme, _status| svg::Style { color: Some(color) })
        }
    };
}

icon_svg!(home, r#"<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>"#);
icon_svg!(disc, r#"<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>"#);
icon_svg!(cloud, r#"<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>"#);
icon_svg!(search, r#"<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>"#);
icon_svg!(library, r#"<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>"#);
icon_svg!(heart, r#"<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>"#);
filled_icon_svg!(heart_filled, r#"<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>"#);
icon_svg!(history, r#"<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>"#);
icon_svg!(flame, r#"<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>"#);
icon_svg!(list_music, r#"<path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/>"#);
icon_svg!(settings, r#"<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>"#);
icon_svg!(user, r#"<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>"#);
filled_icon_svg!(play, r#"<path d="M7.5 4.8c0-1.1 1.2-1.8 2.15-1.22l10.2 6.2a1.42 1.42 0 0 1 0 2.44l-10.2 6.2A1.42 1.42 0 0 1 7.5 17.2Z"/>"#);
filled_icon_svg!(pause, r#"<rect x="6" y="4.2" width="4.4" height="15.6" rx="1.8"/><rect x="13.6" y="4.2" width="4.4" height="15.6" rx="1.8"/>"#);
filled_icon_svg!(skip_back, r#"<path d="M12.2 6.6c0-.85-.96-1.36-1.66-.86l-7.2 5.2a1.05 1.05 0 0 0 0 1.72l7.2 5.2c.7.5 1.66-.01 1.66-.86V6.6Z"/><path d="M21 6.6c0-.85-.96-1.36-1.66-.86l-7.2 5.2a1.05 1.05 0 0 0 0 1.72l7.2 5.2c.7.5 1.66-.01 1.66-.86V6.6Z"/>"#);
filled_icon_svg!(skip_forward, r#"<path d="M3 6.6c0-.85.96-1.36 1.66-.86l7.2 5.2a1.05 1.05 0 0 1 0 1.72l-7.2 5.2C3.96 18.36 3 17.85 3 17V6.6Z"/><path d="M11.8 6.6c0-.85.96-1.36 1.66-.86l7.2 5.2a1.05 1.05 0 0 1 0 1.72l-7.2 5.2c-.7.5-1.66-.01-1.66-.86V6.6Z"/>"#);
icon_svg!(shuffle, r#"<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>"#);
icon_svg!(repeat, r#"<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>"#);
icon_svg!(repeat_one, r#"<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/>"#);
icon_svg!(volume_1, r#"<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>"#);
icon_svg!(volume_2, r#"<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>"#);
icon_svg!(volume_x, r#"<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>"#);
icon_svg!(lyrics_bubble, r#"<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7.5 8.5h9"/><path d="M7.5 11.5h7"/><path d="M7.5 14.5h4.5"/>"#);
icon_svg!(mic, r#"<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>"#);
icon_svg!(queue, r#"<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>"#);
icon_svg!(mini_player, r#"<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>"#);
icon_svg!(chevron_left, r#"<path d="m15 18-6-6 6-6"/>"#);
icon_svg!(chevron_right, r#"<path d="m9 18 6-6-6-6"/>"#);
icon_svg!(chevron_up, r#"<path d="m18 15-6-6-6 6"/>"#);
icon_svg!(chevron_down, r#"<path d="m6 9 6 6 6-6"/>"#);
icon_svg!(plus, r#"<path d="M5 12h14"/><path d="M12 5v14"/>"#);
icon_svg!(trash, r#"<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>"#);
icon_svg!(edit, r#"<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>"#);
icon_svg!(refresh, r#"<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>"#);
icon_svg!(close, r#"<path d="M18 6 6 18"/><path d="m6 6 12 12"/>"#);
icon_svg!(check, r#"<path d="M20 6 9 17l-5-5"/>"#);
icon_svg!(music_note, r#"<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>"#);
icon_svg!(more, r#"<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>"#);
icon_svg!(maximize, r#"<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>"#);
icon_svg!(sliders, r#"<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>"#);
icon_svg!(activity, r#"<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>"#);
